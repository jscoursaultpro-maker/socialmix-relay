/**
 * routes/apple-resolve.js
 * ★ Lot 2 host web — Résolution titre AhOuai → Apple Music catalog song id.
 *
 * Exporte _resolveAppleMusic(title, artist, isrc?) → songId|null.
 * Source : Apple Music API (api.music.apple.com), token serveur ES256 SANS claim origin.
 *   1. ISRC exact : GET /v1/catalog/{sf}/songs?filter[isrc]=…
 *   2. Recherche texte : GET /v1/catalog/{sf}/search?term=artiste+titre&types=songs
 * Storefront : APPLE_MUSIC_STOREFRONT (défaut 'fr'). Jamais la clé dans les logs.
 */
import { getAppleServerToken } from './apple-dev-token.js';

const BASE = 'https://api.music.apple.com/v1/catalog';
const STOREFRONT = process.env.APPLE_MUSIC_STOREFRONT || 'fr';

function _norm(s) { return String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]/g, ''); }

/** @returns {Promise<string|null>} Apple Music catalog song id, ou null. */
export async function _resolveAppleMusic(title, artist, isrc = null) {
  const t = getAppleServerToken();
  if (!t?.token) return null;
  const headers = { Authorization: `Bearer ${t.token}` };

  // 1) ISRC exact (le plus fiable)
  if (isrc) {
    try {
      const r = await fetch(`${BASE}/${STOREFRONT}/songs?filter[isrc]=${encodeURIComponent(isrc)}&limit=1`, { headers });
      if (r.ok) { const j = await r.json(); const id = j?.data?.[0]?.id; if (id) return String(id); }
      else if (r.status === 403 || r.status === 429) console.warn(`[apple-resolve] isrc ${r.status}`);
    } catch (e) { /* non bloquant → fallback recherche */ }
  }

  // 2) Recherche texte
  if (title && artist) {
    try {
      const q = `${artist} ${title}`.trim();
      const r = await fetch(`${BASE}/${STOREFRONT}/search?term=${encodeURIComponent(q)}&types=songs&limit=5`, { headers });
      if (!r.ok) { console.warn(`[apple-resolve] search HTTP ${r.status}`); return null; }
      const j = await r.json();
      const songs = j?.results?.songs?.data || [];
      if (!songs.length) return null;
      const wantT = _norm(title), wantA = _norm(artist);
      let best = null, bestScore = -1;
      for (const s of songs) {
        const nT = _norm(s.attributes?.name), nA = _norm(s.attributes?.artistName);
        let sc = 0;
        if (nT && (nT.includes(wantT) || wantT.includes(nT))) sc += 2;
        if (nA && (nA.includes(wantA) || wantA.includes(nA))) sc += 1;
        if (sc > bestScore) { bestScore = sc; best = s; }
      }
      if (best && bestScore >= 2) return String(best.id);   // titre (±artiste) correspond
      return String(songs[0].id);                            // sinon meilleur résultat Apple
    } catch (e) { console.warn(`[apple-resolve] search erreur : ${e.message}`); }
  }
  return null;
}
