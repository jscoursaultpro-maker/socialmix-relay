/**
 * routes/djbrain-lite.js
 * ★ feat(host-web) — Sélection provisoire de titres pour le cockpit hôte web.
 *
 * PROVISOIRE — sera remplacé par le DJ Brain serveur (scoring complet).
 * Contrat de réponse stable : [{trackId, title, artist, spotifyUri, durationMs}]
 *
 * GET /api/djbrain-lite/next?partyCode=X&count=5&phase=arrival
 *   → jusqu'à `count` titres de la BDD ayant un providers.spotify.trackId,
 *     phase donnée (défaut: arrival), triés par qualityLevel desc puis aléatoire,
 *     en excluant les titres déjà joués dans la soirée (party.trackHistory).
 *
 * ★ fix(host-web) — Résolution ISRC serveur pour les titres sans spotifyId :
 *   Couverture BDD phase=arrival : 1/155 (0.6%) → résolution nécessaire.
 *   GET https://api.spotify.com/v1/search?q=isrc:{isrc}&type=track&market=FR
 *   Client Credentials (SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET en .env).
 *   Écriture en retour : providers.spotify.trackId (jamais écrasement existant).
 *   Cache RAM 1h, max 5 résolutions par appel.
 *
 * ★ SIGNALEMENT : SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET présents dans .env.
 *   Pattern iOS pour sans-URI : GET /v1/search?q={artist} {title}&type=track&limit=1
 *   SpotifyService.swift L824,L877 — recherche par titre+artiste, PAS ISRC.
 *   Pas d'écriture en retour vers la BDD côté iOS (spotifyURIMap en RAM uniquement).
 */

import { Router } from 'express';
import Track from '../models/Track.js';

const router = Router();

// ─── Client Credentials Spotify ───────────────────────────────────────────────

/** Cache token client credentials { token, expiresAt } */
let _ccToken = null;

async function _getClientCredentialsToken() {
  if (_ccToken && Date.now() < _ccToken.expiresAt - 30000) return _ccToken.token;

  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn('[djbrain-lite] SPOTIFY_CLIENT_ID ou CLIENT_SECRET manquant — résolution ISRC désactivée');
    return null;
  }

  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) { console.error(`[djbrain-lite] CC token échec: ${res.status}`); return null; }
    const data = await res.json();
    _ccToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    console.log('[djbrain-lite] ✅ Spotify CC token obtenu');
    return _ccToken.token;
  } catch (e) {
    console.error('[djbrain-lite] CC token erreur:', e.message);
    return null;
  }
}

// ─── Cache ISRC → spotifyTrackId RAM (1h TTL) ─────────────────────────────────
const _isrcCache = new Map(); // isrc → { trackId, expiresAt }
const ISRC_CACHE_TTL = 60 * 60 * 1000; // 1h

// ─── Résolution ISRC via Spotify Search ───────────────────────────────────────

/**
 * Résout un seul ISRC via GET /v1/search?q=isrc:{isrc}&type=track&market=FR
 * Écrit providers.spotify.trackId en BDD (jamais écrasement d'un existant).
 * @param {string} isrc
 * @param {string} mongoId — ObjectId pour le upsert BDD
 * @returns {string|null} trackId Spotify ou null
 */
async function _resolveIsrc(isrc, mongoId) {
  // Cache hit
  const cached = _isrcCache.get(isrc);
  if (cached && Date.now() < cached.expiresAt) return cached.trackId;

  const token = await _getClientCredentialsToken();
  if (!token) return null;

  const url = `https://api.spotify.com/v1/search?q=isrc:${encodeURIComponent(isrc)}&type=track&market=FR&limit=1`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    // 429 — on s'arrête, pas de retry en cascade
    if (res.status === 429) {
      const retry = res.headers.get('Retry-After') || '10';
      console.warn(`[djbrain-lite] 429 ISRC search — Retry-After: ${retry}s`);
      return null;
    }
    if (!res.ok) { console.warn(`[djbrain-lite] ISRC search ${isrc}: HTTP ${res.status}`); return null; }

    const data = await res.json();
    const item = data?.tracks?.items?.[0];
    if (!item?.id) {
      console.log(`[djbrain-lite] ISRC ${isrc}: aucun résultat`);
      _isrcCache.set(isrc, { trackId: null, expiresAt: Date.now() + ISRC_CACHE_TTL });
      return null;
    }

    const trackId = item.id;
    console.log(`[djbrain-lite] ✅ ISRC ${isrc} → spotify:track:${trackId} (${item.name})`);

    // Cache RAM
    _isrcCache.set(isrc, { trackId, expiresAt: Date.now() + ISRC_CACHE_TTL });

    // ★ fix(write-back) — $in:[null,'',undefined] ne matche PAS un champ absent (MongoDB piège).
    // $or couvre les 3 cas : champ absent ($exists:false), valeur null, valeur chaîne vide.
    // Jamais d'écrasement d'un trackId existant (la condition filtre uniquement les "vides").
    Track.findOneAndUpdate(
      { _id: mongoId, $or: [
        { 'providers.spotify.trackId': { $exists: false } },
        { 'providers.spotify.trackId': null },
        { 'providers.spotify.trackId': '' }
      ]},
      { $set: { 'providers.spotify.trackId': trackId } },
      { upsert: false }
    ).then(doc => {
      if (doc) console.log(`[djbrain-lite] 📝 BDD write-back ${mongoId} → spotify.trackId=${trackId}`);
    }).catch(e => console.error('[djbrain-lite] write-back erreur:', e.message));

    return trackId;
  } catch (e) {
    console.error(`[djbrain-lite] ISRC ${isrc} résolution erreur:`, e.message);
    return null;
  }
}

// ─── Résolution batch (max 5 par appel) ───────────────────────────────────────

/**
 * Tente de résoudre les spotifyTrackId manquants via ISRC.
 * Max 5 résolutions par appel (rate limit prudent).
 * @param {Array} tracks — tracks sans providers.spotify.trackId mais avec isrc
 * @returns {Map<string, string>} mongoId → spotifyTrackId
 */
async function _resolveBatch(tracks) {
  const MAX_PER_CALL = 5;
  const candidates   = tracks.filter(t => t.isrc && !t.providers?.spotify?.trackId).slice(0, MAX_PER_CALL);
  const resolved     = new Map();

  for (const t of candidates) {
    const trackId = await _resolveIsrc(t.isrc, t._id);
    if (trackId) resolved.set(t._id.toString(), trackId);
  }

  if (candidates.length > 0) {
    console.log(`[djbrain-lite] Résolution batch: ${resolved.size}/${candidates.length} résolus`);
  }
  return resolved;
}

// ─── Route principale ─────────────────────────────────────────────────────────

router.get('/next', async (req, res) => {
  try {
    const partyCode = (req.query.partyCode || '').toUpperCase();
    const count     = Math.min(parseInt(req.query.count) || 5, 20);
    const phase     = req.query.phase || 'arrival';

    // Récupérer la party depuis le RAM store (accessible via app.get('parties'))
    const parties = req.app.get('parties');
    const party   = partyCode ? parties?.get(partyCode) : null;

    // Titres déjà joués cette soirée (exclure par titre normalisé)
    const playedTitles = new Set(
      (party?.trackHistory || []).map(t => (t.title || '').toLowerCase().trim())
    );

    // ── Filtres ──────────────────────────────────────────────────────────────
    const filter = {
      isBlocked:   { $ne: true },
      suggestable: { $ne: false },
      qualityLevel: { $in: ['platine', 'complete', 'partielle'] }
    };

    if (phase && phase !== 'any') {
      filter.$or = [{ phase }, { phase: { $exists: false } }, { phase: null }];
    }

    // ── Query large — inclut tracks SANS spotifyId pour résolution ISRC ──────
    const raw = await Track.find(filter)
      .sort({ qualityLevel: -1, 'performance.feuRatio': -1 })
      .limit(count * 10)  // pool large : exclusions + shuffle + résolution ISRC
      .select('title artist durationMs qualityLevel providers.spotify.trackId coverArtURL isrc')
      .lean();

    // Exclure déjà joués
    const eligible = raw.filter(t => !playedTitles.has((t.title || '').toLowerCase().trim()));

    // ── Séparer avec/sans spotifyId ───────────────────────────────────────────
    const withSpotify    = eligible.filter(t => t.providers?.spotify?.trackId);
    const withoutSpotify = eligible.filter(t => !t.providers?.spotify?.trackId && t.isrc);

    // ── Résolution ISRC si besoin (couverture < 50 %) ─────────────────────────
    let resolvedMap = new Map();
    const needsMore = withSpotify.length < count;
    if (needsMore && withoutSpotify.length > 0) {
      resolvedMap = await _resolveBatch(withoutSpotify);
    }

    // ── Construire le pool final ──────────────────────────────────────────────
    // 1. Tracks déjà avec spotifyId
    // 2. Tracks résolus par ISRC ce tour
    const resolved = withoutSpotify
      .filter(t => resolvedMap.has(t._id.toString()))
      .map(t => ({ ...t, providers: { ...t.providers, spotify: { trackId: resolvedMap.get(t._id.toString()) } } }));

    const pool = [...withSpotify, ...resolved];

    // Shuffle par qualité
    const shuffled = _shuffleByQuality(pool);
    const result   = shuffled.slice(0, count).map(t => ({
      trackId:     t._id.toString(),
      title:       t.title,
      artist:      t.artist,
      spotifyUri:  `spotify:track:${t.providers.spotify.trackId}`,
      durationMs:  t.durationMs || 0,
      coverArtURL: t.coverArtURL || null,
      qualityLevel: t.qualityLevel,
      _resolvedThisCall: resolvedMap.has(t._id.toString()),
      _source: 'djbrain-lite'
    }));

    console.log(
      `[djbrain-lite] /next partyCode=${partyCode} phase=${phase} → ` +
      `${result.length} tracks (withSpotify:${withSpotify.length} ` +
      `resolved:${resolved.length} total pool:${pool.length})`
    );

    res.json({
      tracks:    result,
      count:     result.length,
      phase,
      partyCode: partyCode || null,
      _meta: {
        poolWithSpotify: withSpotify.length,
        poolWithoutSpotify: withoutSpotify.length,
        resolvedThisCall: resolvedMap.size
      },
      _note: 'PROVISOIRE — contrat stable : [{trackId, title, artist, spotifyUri, durationMs}]',
      generatedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('[djbrain-lite] /next error:', err.message);
    res.status(500).json({ error: 'djbrain-lite error', message: err.message });
  }
});

// ─── Utils ────────────────────────────────────────────────────────────────────

/**
 * Shuffle les tracks en préservant l'ordre de priorité inter-niveaux.
 */
function _shuffleByQuality(tracks) {
  const groups = {};
  tracks.forEach(t => {
    const lvl = t.qualityLevel || 'vide';
    if (!groups[lvl]) groups[lvl] = [];
    groups[lvl].push(t);
  });
  Object.values(groups).forEach(arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  });
  return ['platine', 'complete', 'partielle', 'vide'].flatMap(lvl => groups[lvl] || []);
}

export default router;
