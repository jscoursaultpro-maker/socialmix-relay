/**
 * routes/apple-dev-token.js
 * ★ Lot 0 (01/10/2026) — Jeton développeur MusicKit (ES256) pour le host web.
 *
 * GET /api/apple/dev-token → { token, expiresAt }
 *
 * Env requis :
 *   APPLE_MUSIC_TEAM_ID        Team ID Apple Developer (10 car.)
 *   APPLE_MUSIC_KEY_ID         Key ID de la clé MusicKit (.p8)
 *   APPLE_MUSIC_PRIVATE_KEY    Contenu PEM de la clé .p8 (Render : coller le contenu,
 *                              retours à la ligne réels ou "\n" échappés)
 *   APPLE_MUSIC_PRIVATE_KEY_PATH  (local uniquement) chemin du fichier .p8
 *   APPLE_MUSIC_ORIGINS        (optionnel) origines autorisées à utiliser le jeton, séparées par
 *                              des virgules (claim "origin" du JWT, supporté par Apple). Défaut :
 *                              https://join.ahouai.com,https://socialmix-relay.onrender.com
 *
 * Règles : la clé privée n'est JAMAIS logguée ni renvoyée. Le jeton est
 * régénéré côté serveur, TTL 12 h, cache mémoire, renouvelé 1 h avant expiration.
 * Env manquante → 503 { error: 'APPLE_MUSIC_NOT_CONFIGURED' } + log clair (sans valeur).
 */
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';

const router = Router();

const TOKEN_TTL_SEC = 12 * 60 * 60;        // 12 h
const RENEW_BEFORE_SEC = 60 * 60;          // renouvelé si < 1 h restante

let _cache = { token: null, exp: 0 };      // exp en secondes epoch
let _warnedMissing = false;                // log "non configuré" une seule fois (S3)
const DEFAULT_ORIGINS = 'https://join.ahouai.com,https://socialmix-relay.onrender.com';
function _origins() {
  return (process.env.APPLE_MUSIC_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean);
}
const rateLimitMap = new Map();
setInterval(() => rateLimitMap.clear(), 60_000).unref?.();

function _loadPrivateKey() {
  const inline = process.env.APPLE_MUSIC_PRIVATE_KEY;
  if (inline && inline.trim()) {
    // Render : les "\n" littéraux sont fréquents quand la clé est collée sur une ligne
    return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  }
  const path = process.env.APPLE_MUSIC_PRIVATE_KEY_PATH;
  if (path && path.trim()) {
    try { return readFileSync(path, 'utf8'); } catch { return null; }
  }
  return null;
}

/** Retourne { token, exp } ou null si non configuré. Exporté pour usage serveur (Lot 2 résolution). */
export function getAppleDeveloperToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_cache.token && _cache.exp - now > RENEW_BEFORE_SEC) return { token: _cache.token, exp: _cache.exp };

  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  const privateKey = _loadPrivateKey();
  const missing = [
    !teamId && 'APPLE_MUSIC_TEAM_ID',
    !keyId && 'APPLE_MUSIC_KEY_ID',
    !privateKey && 'APPLE_MUSIC_PRIVATE_KEY (ou _PATH)',
  ].filter(Boolean);
  if (missing.length) {
    if (!_warnedMissing) { _warnedMissing = true; console.warn(`[AppleDevToken] ⚠️ non configuré — manquant : ${missing.join(', ')}`); }
    return null;
  }

  const exp = now + TOKEN_TTL_SEC;
  try {
    // claim "origin" : le jeton n'est utilisable que depuis nos pages (S1 revue 01/10)
    const token = jwt.sign({ iss: teamId, iat: now, exp, origin: _origins() }, privateKey, {
      algorithm: 'ES256',
      header: { alg: 'ES256', kid: keyId },
    });
    _cache = { token, exp };
    console.log(`[AppleDevToken] ✅ jeton généré (exp ${new Date(exp * 1000).toISOString()}, origines ${_origins().length})`);
    return { token, exp };
  } catch (err) {
    console.error(`[AppleDevToken] ❌ signature impossible : ${err.name} — ${err.message}`);
    return null;
  }
}

router.get('/dev-token', (req, res) => {
  // Render : pas de trust proxy global → prendre la première IP de X-Forwarded-For (S2 revue 01/10)
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || 'unknown';
  const count = (rateLimitMap.get(ip) || 0) + 1;
  rateLimitMap.set(ip, count);
  if (count > 30) return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });

  const result = getAppleDeveloperToken();
  if (!result) return res.status(503).json({ error: 'APPLE_MUSIC_NOT_CONFIGURED' });

  res.setHeader('Cache-Control', 'no-store');
  return res.json({ token: result.token, expiresAt: new Date(result.exp * 1000).toISOString() });
});

export default router;
