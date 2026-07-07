/**
 * lib/providerResolver.mjs
 * Résolution ISRC → IDs plateformes (Apple Music, Spotify, Deezer).
 *
 * Usage:
 *   import { resolveDeezer, resolveSpotify, resolveAppleMusic } from './lib/providerResolver.mjs';
 *
 * Sécurité:
 *   - Aucun secret hardcodé — toujours process.env.*
 *   - resolveAppleMusic() retourne null si APPLE_MUSIC_DEV_TOKEN absent (log warn)
 *   - resolveSpotify() retourne null si SPOTIFY_CLIENT_ID/SECRET absents (log warn)
 *   - resolveDeezer() : API publique, aucun auth requis
 */

const BACKFILL_VERSION = 'v1-2026-07';

// ─── Deezer (public — aucune auth) ────────────────────────────────────────────
/**
 * Résout un ISRC vers un Deezer trackId via l'endpoint public ISRC.
 * https://api.deezer.com/track/isrc:<isrc>
 *
 * @param {string} isrc
 * @returns {Promise<{ trackId: number, albumId: number|null }|null>}
 */
export async function resolveDeezer(isrc) {
  if (!isrc) return null;
  try {
    const url = `https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    // Deezer retourne { error: { type, message, code } } si non trouvé
    if (data?.error || !data?.id) return null;
    return {
      trackId: data.id,
      albumId: data.album?.id ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Spotify (client_credentials — SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET) ─
/**
 * Obtient un access token Spotify via le flow client_credentials.
 * Token valide 3600s — caller doit le cacher entre appels.
 *
 * @returns {Promise<string|null>} access_token ou null si env vars absentes
 */
export async function getSpotifyToken() {
  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('[providerResolver] ⚠️  Spotify skipped: SPOTIFY_CLIENT_ID/SECRET missing');
    return null;
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Résout un ISRC vers un Spotify trackId.
 * https://api.spotify.com/v1/search?q=isrc:<isrc>&type=track
 *
 * @param {string} isrc
 * @param {string} token  Spotify access_token (client_credentials)
 * @returns {Promise<{ trackId: string }|null>}
 */
export async function resolveSpotify(isrc, token) {
  if (!isrc || !token) return null;
  try {
    const url = `https://api.spotify.com/v1/search?q=isrc%3A${encodeURIComponent(isrc)}&type=track&limit=1`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.tracks?.items;
    if (!items || items.length === 0) return null;
    return { trackId: items[0].id };
  } catch {
    return null;
  }
}

// ─── Apple Music (APPLE_MUSIC_DEV_TOKEN — JWT ES256 MusicKit) ─────────────────
/**
 * Résout un ISRC vers un Apple Music song ID (FR catalog).
 * https://api.music.apple.com/v1/catalog/fr/songs?filter[isrc]=<isrc>
 *
 * Requires APPLE_MUSIC_DEV_TOKEN (JWT ES256, team token signed with MusicKit key).
 * If absent, returns null with a clear warning message.
 *
 * @param {string} isrc
 * @returns {Promise<{ trackId: string }|null>}
 */
export async function resolveAppleMusic(isrc) {
  const devToken = process.env.APPLE_MUSIC_DEV_TOKEN;
  if (!devToken) {
    // Warn already emitted once by caller — silent here to avoid log spam per-track
    return null;
  }
  if (!isrc) return null;

  try {
    const url = `https://api.music.apple.com/v1/catalog/fr/songs?filter[isrc]=${encodeURIComponent(isrc)}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${devToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data?.data;
    if (!items || items.length === 0) return null;
    return { trackId: items[0].id };
  } catch {
    return null;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
export { BACKFILL_VERSION };
