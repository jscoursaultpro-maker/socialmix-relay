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

// ─── Cache texte (échec ISRC) ────────────────────────────────────────────────
// Cache clé : "title::artist" normalisé → { trackId | null, expiresAt }
// Jamais stocké pour les faux positifs (karaoke, tribute) — null mis en cache.
const _textCache = new Map();

// Normalisation alphanumérique stricte (même règle que normalizeTitle iOS)
function _normalizeForMatch(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // accents
    .replace(/[^a-z0-9]/g, '');                          // non alphanumérique
}

// Blacklist faux positifs : karaoke, tribute, cover, backing track, made famous
const _FP_BLACKLIST = /karaoke|tribute|made famous|backing track|instrumental version/i;

/**
 * Résout un seul titre via recherche texte Spotify après échec ISRC.
 * GET /v1/search?q=track:"<title>" artist:"<artist>"&type=track&market=FR&limit=3
 * Normalisation stricte alphanumérique : titre ET artiste doivent matcher.
 * Blacklist faux positifs (karaoke, tribute, made famous, backing track).
 * Write-back BDD identique à _resolveIsrc (jamais écrasement existant).
 * @param {string} title
 * @param {string} artist
 * @param {string} mongoId
 * @returns {string|null} trackId Spotify ou null
 */
async function _resolveText(title, artist, mongoId) {
  const cacheKey = `${_normalizeForMatch(title)}::${_normalizeForMatch(artist)}`;
  const cached   = _textCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.trackId;

  const token = await _getClientCredentialsToken();
  if (!token) return null;

  const q   = `track:"${title}" artist:"${artist}"`;
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&market=FR&limit=3`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      console.warn(`[djbrain-lite] 429 text search — Retry-After: ${res.headers.get('Retry-After') || '?'}s`);
      return null;
    }
    if (!res.ok) { console.warn(`[djbrain-lite] text search HTTP ${res.status} for "${title}"`); return null; }

    const data  = await res.json();
    const items = data?.tracks?.items || [];
    const normTitle  = _normalizeForMatch(title);
    const normArtist = _normalizeForMatch(artist);

    // Retenir le 1er résultat dont titre ET artiste normalisés matchent, sans faux positif
    const match = items.find(item => {
      if (_FP_BLACKLIST.test(item.name)) return false;   // blacklist
      const tOK = _normalizeForMatch(item.name).includes(normTitle) ||
                  normTitle.includes(_normalizeForMatch(item.name));
      const aOK = item.artists.some(a =>
        _normalizeForMatch(a.name).includes(normArtist) ||
        normArtist.includes(_normalizeForMatch(a.name))
      );
      return tOK && aOK;
    });

    if (!match) {
      console.log(`[djbrain-lite] text search: no match for "${title}" — "${artist}"`);
      _textCache.set(cacheKey, { trackId: null, expiresAt: Date.now() + ISRC_CACHE_TTL });
      return null;
    }

    const trackId = match.id;
    console.log(`[djbrain-lite] ✅ text "${title}" → spotify:track:${trackId} (${match.name} — ${match.artists[0]?.name})`);
    _textCache.set(cacheKey, { trackId, expiresAt: Date.now() + ISRC_CACHE_TTL });

    // Write-back BDD (jamais écrasement existant)
    Track.findOneAndUpdate(
      { _id: mongoId, $or: [
        { 'providers.spotify.trackId': { $exists: false } },
        { 'providers.spotify.trackId': null },
        { 'providers.spotify.trackId': '' }
      ]},
      { $set: { 'providers.spotify.trackId': trackId } },
      { upsert: false }
    ).then(doc => {
      if (doc) console.log(`[djbrain-lite] 📝 text write-back ${mongoId} → ${trackId}`);
    }).catch(e => console.error('[djbrain-lite] text write-back err:', e.message));

    return trackId;
  } catch (e) {
    console.error(`[djbrain-lite] text search erreur pour "${title}":`, e.message);
    return null;
  }
}

/**
 * Résolution texte batch — max 5 résolutions (mutualisées avec ISRC).
 * N'est appelé que si withSpotify.length < count après ISRC.
 * @param {Array} tracks — tracks sans trackId après ISRC (avec title+artist)
 * @param {number} budget — appels restants (budget global ISRC+text = 5)
 * @returns {Map<string, string>} mongoId → trackId
 */
async function _resolveTextBatch(tracks, budget) {
  const candidates = tracks.slice(0, budget);
  const resolved   = new Map();
  for (const t of candidates) {
    if (!t.title || !t.artist) continue;
    const trackId = await _resolveText(t.title, t.artist, t._id);
    if (trackId) resolved.set(t._id.toString(), trackId);
  }
  if (candidates.length > 0) {
    console.log(`[djbrain-lite] Text batch: ${resolved.size}/${candidates.length} résolus`);
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
    const MAX_RESOLUTION_BUDGET = 5; // budget global ISRC + texte par appel /next
    let resolvedMap = new Map();
    const needsMore = withSpotify.length < count;
    if (needsMore && withoutSpotify.length > 0) {
      resolvedMap = await _resolveBatch(withoutSpotify); // max 5 ISRC
    }

    // ── 2.1: Recherche texte de secours (après échec ISRC) ────────────────────
    // Si encore < count après ISRC, tenter la recherche texte sur les tracks
    // sans trackId même après résolution ISRC.
    let resolvedTextMap = new Map();
    const stillMissing = withoutSpotify.filter(t =>
      !resolvedMap.has(t._id.toString()) && t.title && t.artist
    );
    const textBudget = Math.max(0, MAX_RESOLUTION_BUDGET - resolvedMap.size);
    if (needsMore && stillMissing.length > 0 && textBudget > 0) {
      resolvedTextMap = await _resolveTextBatch(stillMissing, textBudget);
    }

    // ── Construire le pool final ──────────────────────────────────────────────
    // 1. Tracks déjà avec spotifyId
    // 2. Tracks résolus par ISRC ce tour
    // 3. Tracks résolus par texte ce tour
    const resolvedByIsrc = withoutSpotify
      .filter(t => resolvedMap.has(t._id.toString()))
      .map(t => ({ ...t, providers: { ...t.providers, spotify: { trackId: resolvedMap.get(t._id.toString()) } }, _resolvedBy: 'isrc' }));

    const resolvedByText = stillMissing
      .filter(t => resolvedTextMap.has(t._id.toString()))
      .map(t => ({ ...t, providers: { ...t.providers, spotify: { trackId: resolvedTextMap.get(t._id.toString()) } }, _resolvedBy: 'text' }));

    const resolved = [...resolvedByIsrc, ...resolvedByText];

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
      _resolvedThisCall: resolvedMap.has(t._id.toString()) || resolvedTextMap.has(t._id.toString()),
      _resolvedBy:  t._resolvedBy || (t.providers?.spotify?.trackId ? 'bdd' : 'unknown'),
      _source: 'djbrain-lite'
    }));

    console.log(
      `[djbrain-lite] /next partyCode=${partyCode} phase=${phase} → ` +
      `${result.length} tracks (withSpotify:${withSpotify.length} ` +
      `resolved:${resolved.length} total pool:${pool.length})`
    );
    // A1.4 debug : trackId AhOuai → spotifyUri (jamais de token/secret)
    if (process.env.NODE_ENV !== 'production' || partyCode) {
      result.forEach(t => {
        const src = t._resolvedBy === 'isrc' ? 'ISRC-résolu' : t._resolvedBy === 'text' ? 'text-résolu' : 'BDD';
        console.log(`[djbrain-lite]   trackId ...${t.trackId.slice(-8)} (${src}) → ${t.spotifyUri} | ${t.title}`);
      });
    }

    res.json({
      tracks:    result,
      count:     result.length,
      phase,
      partyCode: partyCode || null,
      _meta: {
        poolWithSpotify: withSpotify.length,
        poolWithoutSpotify: withoutSpotify.length,
        resolvedByIsrc:   resolvedMap.size,
        resolvedByText:   resolvedTextMap.size,
        unresolved:       stillMissing.length - resolvedTextMap.size
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
