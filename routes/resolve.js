/**
 * routes/resolve.js
 * ★ Lot 1 host web (01/10/2026) — Résolution d'un titre AhOuai vers l'identifiant d'un lecteur.
 *
 * GET /api/resolve?provider=spotify|apple|youtube&trackId=<Mongo _id>
 *   → { providerId: string|null, resolvedBy: 'db'|'isrc'|'text'|'unresolved', provider }
 *
 * Auth : Bearer JWT Supabase (même pattern que /api/user/me/settings).
 *
 * Ordre :
 *   1. providers.<provider> déjà en base → 'db' (aucun appel externe)
 *   2. spotify : _resolveIsrc (djbrain-lite, Client Credentials, cache 1h, rate-limit prudent)
 *                puis _resolveText en dernier recours ; write-back providers.spotify.trackId
 *      apple / youtube : branchés par les Lots 2 et 3 (pour l'instant 'unresolved' si absent en base)
 *   3. Cache RAM : 1 h succès / 5 min échec, clé provider::trackId.
 *
 * Jamais de token ni de secret dans les logs.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import Track from '../models/Track.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';
import { _resolveIsrc, _resolveText } from './djbrain-lite.js';
import { _resolveYouTube } from './youtube-resolve.js';  // ★ Lot 3
import { _resolveAppleMusic } from './apple-resolve.js';  // ★ Lot 2

const router = Router();

const PROVIDERS = ['spotify', 'apple', 'youtube'];
const FIELD = { spotify: 'providers.spotify.trackId', apple: 'providers.appleMusic.trackId', youtube: 'providers.youtube.videoId' };
const CACHE_OK_MS   = 60 * 60 * 1000;
const CACHE_FAIL_MS =  5 * 60 * 1000;
const _cache = new Map();   // `${provider}::${trackId}` → { value, expiresAt }

const rateLimitMap = new Map();       // par utilisateur (req.currentUser._id) — 20/min
const _externalBudget = { spotify: 0, youtube: 0, apple: 0 }; // budget d'appels externes PAR provider (cloisonné)
const RATE_PER_USER   = 20;
const EXTERNAL_PER_MIN = 30;
setInterval(() => { rateLimitMap.clear(); _externalBudget.spotify = 0; _externalBudget.youtube = 0; _externalBudget.apple = 0; }, 60_000).unref?.();

async function requireSupabaseAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'AUTH_MISSING' });
    const payload = await verifySupabaseJWT(authHeader.slice(7));
    req.currentUser = await findOrCreateFromSupabase(payload);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'AUTH_FAILED' });
  }
}

function _getField(track, provider) {
  if (provider === 'spotify') return track.providers?.spotify?.trackId || null;
  if (provider === 'apple')   return track.providers?.appleMusic?.trackId || track.appleMusicID || null;
  if (provider === 'youtube') return track.providers?.youtube?.videoId || null;
  return null;
}

/** Résolution externe par provider — retourne { providerId, resolvedBy } ou null.
 *  Budget global : au-delà de EXTERNAL_PER_MIN appels externes/min, on répond 'unresolved'
 *  (sans cache long) plutôt que d'exposer le compte Spotify (précédent de bannissement). */
async function _resolveExternal(provider, track) {
  if ((_externalBudget[provider] || 0) >= EXTERNAL_PER_MIN) {
    console.warn(`[resolve] budget externe ${provider} épuisé cette minute`);
    return { budgetExhausted: true };   // ≠ "introuvable" : ne pas cacher longtemps
  }
  _externalBudget[provider] = (_externalBudget[provider] || 0) + 1;
  // ★ _id peut être absent (résolution d'une suggestion Deezer non présente en base) → clé de
  //   cache synthétique pour ne pas crasher ; le write-back est de toute façon sauté sans _id.
  const _kid = track._id ? track._id.toString() : ('meta:' + (track.isrc || track.title || 'x'));
  if (provider === 'spotify') {
    if (track.isrc) {
      const id = await _resolveIsrc(track.isrc, _kid);
      if (id) return { providerId: id, resolvedBy: 'isrc' };
    }
    const id = await _resolveText(track.title, track.artist, _kid);
    if (id) return { providerId: id, resolvedBy: 'text' };
    return null;
  }
  if (provider === 'youtube') {
    const id = await _resolveYouTube(track.title, track.artist, track.isrc, _kid);
    if (id) return { providerId: id, resolvedBy: 'search' };
    return null;
  }
  if (provider === 'apple') {
    const id = await _resolveAppleMusic(track.title, track.artist, track.isrc);
    if (id) return { providerId: id, resolvedBy: track.isrc ? 'isrc' : 'search' };
    return null;
  }
  return null;
}

/** Write-back idempotent : n'écrase jamais une valeur existante. */
async function _writeBack(provider, trackId, providerId) {
  const field = FIELD[provider];
  try {
    await Track.updateOne(
      { _id: trackId, $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] },
      { $set: { [field]: providerId } }
    );
  } catch (e) {
    console.warn(`[resolve] write-back ${provider} échoué : ${e.message}`);
  }
}

/** Exporté pour usage serveur (djbrain-lite provider-aware, Lot 4). */
export async function resolveTrack(provider, trackId) {
  const key = `${provider}::${trackId}`;
  const hit = _cache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.value;

  const track = await Track.findById(trackId)
    .select('title artist isrc appleMusicID providers')
    .lean();
  if (!track) return null;

  let value;
  const existing = _getField(track, provider);
  if (existing) {
    value = { providerId: String(existing), resolvedBy: 'db' };
  } else {
    const ext = await _resolveExternal(provider, track);
    if (ext?.budgetExhausted) {
      // Échec dû au budget (pas au catalogue) : répondre unresolved SANS cacher (retry possible)
      return { providerId: null, resolvedBy: 'budget' };
    }
    if (ext) {
      value = ext;
      // Spotify : _resolveIsrc/_resolveText (djbrain-lite) font déjà le write-back.
      if (provider !== 'spotify') await _writeBack(provider, track._id, ext.providerId);
    } else {
      value = { providerId: null, resolvedBy: 'unresolved' };
    }
  }
  _cache.set(key, { value, expiresAt: Date.now() + (value.providerId ? CACHE_OK_MS : CACHE_FAIL_MS) });
  return value;
}

/**
 * Résolution d'une SUGGESTION invité qui n'a pas (encore) d'_id Track AhOuai :
 * on ne connaît souvent que isrc / deezerId / titre+artiste (lien Deezer collé par un guest).
 *   1. Retrouver un Track réel par deezerId puis isrc → resolveTrack(_id) (DB-first + write-back persistant).
 *   2. Sinon, résolution externe directe par métadonnées (pas de write-back, cache court).
 * Exporté pour réutilisation serveur éventuelle.
 */
export async function resolveSuggestion(provider, { isrc, deezerId, title, artist }) {
  let track = null;
  try {
    if (deezerId && !Number.isNaN(Number(deezerId))) {
      track = await Track.findOne({ 'providers.deezer.trackId': Number(deezerId) })
        .select('title artist isrc appleMusicID providers').lean();
    }
    if (!track && isrc) {
      track = await Track.findOne({ isrc }).select('title artist isrc appleMusicID providers').lean();
    }
  } catch (e) { console.warn('[resolve] lookup suggestion échoué :', e.message); }

  if (track) return resolveTrack(provider, track._id.toString());

  // Pas en base → résolution externe par métadonnées (titre/artiste/isrc), sans persistance.
  if (!title && !isrc) return { providerId: null, resolvedBy: 'unresolved' };
  const ext = await _resolveExternal(provider, { title, artist, isrc, _id: null });
  if (ext?.budgetExhausted) return { providerId: null, resolvedBy: 'budget' };
  return ext || { providerId: null, resolvedBy: 'unresolved' };
}

router.get('/', requireSupabaseAuth, async (req, res) => {
  // Rate-limit par utilisateur authentifié (pas par IP : X-Forwarded-For est contrôlable)
  const uid = String(req.currentUser?._id || 'anon');
  const count = (rateLimitMap.get(uid) || 0) + 1;
  rateLimitMap.set(uid, count);
  if (count > RATE_PER_USER) return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });

  const provider = String(req.query.provider || '').toLowerCase();
  const trackId  = String(req.query.trackId || '');
  if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'INVALID_PROVIDER', allowed: PROVIDERS });

  // ★ Suggestion sans _id Track : on accepte isrc / deezerId / title+artist en repli.
  const isrc     = (req.query.isrc || '').toString().trim() || null;
  const deezerId = (req.query.deezerId || req.query.deezerID || '').toString().trim() || null;
  const title    = (req.query.title || '').toString().trim() || null;
  const artist   = (req.query.artist || '').toString().trim() || null;

  const hasValidId = mongoose.Types.ObjectId.isValid(trackId);
  if (!hasValidId && !isrc && !deezerId && !title) return res.status(400).json({ error: 'INVALID_TRACK_ID' });

  try {
    const value = hasValidId
      ? await resolveTrack(provider, trackId)
      : await resolveSuggestion(provider, { isrc, deezerId, title, artist });
    if (!value) return res.status(404).json({ error: 'TRACK_NOT_FOUND' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ provider, trackId: hasValidId ? trackId : null, ...value });
  } catch (err) {
    console.error('[resolve] erreur :', err.message);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
