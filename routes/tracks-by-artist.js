/**
 * routes/tracks-by-artist.js
 * ★ feat(#30) — Recherche par artiste avec tri AhOuai + pagination "Voir +".
 *
 * GET /api/tracks/by-artist?name=<artistName>&offset=0&limit=6
 *
 * Flow :
 * 1. Deezer /search?q=artist:"<name>"&limit=100&order=RANKING
 * 2. Filter isDeezerTrackClean (anti-karaoke/cover, copié de server.js)
 * 3. Dedup titre+artiste (même normalisation que /api/deezer/search)
 * 4. Enrichir chaque track avec Track.performance.{feuRatio,totalPlays} depuis DB AhOuai
 * 5. Filtrer suggestable !== false
 * 6. Tri : feuRatio DESC → totalPlays DESC → Deezer rank DESC
 * 7. Slice(offset, offset+limit)
 * 8. Return { tracks, total, hasMore, artistName }
 *
 * Auth : verifyGuestAuth (cohérent avec /api/deezer/search)
 * Note : HPH.count = 0 partout (non exploitable), Track.performance utilisée.
 */

import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';
import Track from '../models/Track.js';

const router = Router();

// ─── Anti-karaoke/cover filter (mirroir server.js BANNED_KEYWORDS) ────────────
const BANNED_KEYWORDS = [
  'karaoke', 'instrumental', 'cover', 'tribute', 'lullaby', 'slowed',
  'sped up', 'reverb', '8d audio', 'nightcore', 'acoustic version',
  'piano version', 'performance live',
  'karaoke version', 'karaoke mix', 'version karaoke',
  'in the style of', 'originally performed by', 'originally performed',
  'made famous by', 'as performed by', 'as made famous',
  'backing track', 'without vocals', 'sing along',
  'rendu celebre', 'playback', 'tribute version', 'instrumental version',
  'acapella', 'a cappella', 'sped'
];

function isDeezerTrackClean(track) {
  const title  = track.title || '';
  const artist = track.artist?.name || '';
  const album  = track.album?.title || '';
  const raw = `${title} ${artist} ${album}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_.]/g, ' ');
  for (const kw of BANNED_KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(raw)) return false;
  }
  return true;
}

// ─── Normalise un titre/artiste pour matching DB AhOuai ───────────────────────
// Enlève: "(Remaster)", "(feat. X)", "- Single", diacritics, lowercase
function normalizeForMatch(str) {
  return (str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, '')          // "(Remastered 2021)", "(feat. X)"
    .replace(/\s*\[.*?\]/g, '')          // "[Deluxe]"
    .replace(/\s*-\s*(single|album|ep)$/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── GET /api/tracks/by-artist ────────────────────────────────────────────────

router.get('/by-artist', verifyGuestAuth, async (req, res) => {
  try {
    const name   = (req.query.name || '').trim();
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const limit  = Math.min(Math.max(parseInt(req.query.limit) || 6, 1), 24);

    if (!name) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Paramètre name requis' });
    }

    // 1. Stratégie Deezer en 2 étapes pour avoir les meilleurs résultats :
    //    a) /search/artist → trouver l'artist_id Deezer
    //    b) /artist/:id/top?limit=50 → tops tracks (les plus pertinentes)
    //    Fallback : query libre si artist_id introuvable
    let deezerTracks = [];
    try {
      // Étape a — Chercher l'artiste
      const artistSearchUrl = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`;
      const artistRes  = await fetch(artistSearchUrl, { signal: AbortSignal.timeout(5000) });
      const artistJson = await artistRes.json();
      const artistData = (artistJson.data || []);

      // Prendre le 1er artiste dont le nom matche le plus proche
      const nameLow = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matchedArtist = artistData.find(a => {
        const aLow = (a.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return aLow === nameLow || aLow.includes(nameLow) || nameLow.includes(aLow);
      }) || artistData[0];

      if (matchedArtist?.id) {
        // Étape b — Top tracks de cet artiste (limit=50 pour avoir assez de pages)
        const topUrl = `https://api.deezer.com/artist/${matchedArtist.id}/top?limit=50`;
        const topRes  = await fetch(topUrl, { signal: AbortSignal.timeout(5000) });
        const topJson = await topRes.json();
        deezerTracks = topJson.data || [];
        console.log(`[by-artist] Deezer artist_id=${matchedArtist.id} (${matchedArtist.name}) → ${deezerTracks.length} top tracks`);
      }

      // Fallback — si pas d'artiste trouvé ou top vide : query libre sur le nom
      if (deezerTracks.length === 0) {
        const fallbackUrl = `https://api.deezer.com/search?q=${encodeURIComponent(name)}&limit=50&order=RANKING`;
        const fallbackRes  = await fetch(fallbackUrl, { signal: AbortSignal.timeout(5000) });
        const fallbackJson = await fallbackRes.json();
        // Filtrer pour ne garder que les tracks de cet artiste (approx)
        const nameLow2 = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        deezerTracks = (fallbackJson.data || []).filter(t => {
          const aLow = (t.artist?.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
          return aLow.includes(nameLow2) || nameLow2.includes(aLow);
        });
        console.log(`[by-artist] Fallback query "${name}" → ${deezerTracks.length} tracks`);
      }

    } catch (fetchErr) {
      console.error('[by-artist] Deezer fetch error:', fetchErr.message);
      return res.status(502).json({ error: 'DEEZER_UNAVAILABLE', message: 'Deezer API indisponible' });
    }

    if (deezerTracks.length === 0) {
      return res.json({ tracks: [], total: 0, hasMore: false, artistName: name });
    }

    // 2. Filtrage anti-karaoke/cover
    deezerTracks = deezerTracks.filter(isDeezerTrackClean);

    // 3. Dedup titre+artiste (Deezer retourne parfois la même chanson de plusieurs albums)
    const seen = new Set();
    deezerTracks = deezerTracks.filter(t => {
      const key = `${normalizeForMatch(t.title)}_${normalizeForMatch(t.artist?.name || '')}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });

    // 4. Enrichissement DB AhOuai — batch lookup par titre+artiste normalisé
    //    On construit une map { normKey → { feuRatio, totalPlays } }
    const normKeys = deezerTracks.map(t => ({
      normTitle:  normalizeForMatch(t.title),
      normArtist: normalizeForMatch(t.artist?.name || ''),
      deezerID:   t.id
    }));

    // Chercher en DB : artiste en regex pour couvrir variations "feat." etc.
    // On prend les artistes uniques pour une seule query groupée
    const artistVariants = [...new Set(normKeys.map(k => k.normArtist))];
    // Regex souple sur le nom de l'artiste normalisé
    const artistNormRegex = new RegExp(
      artistVariants.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'i'
    );

    const dbTracks = await Track.find(
      { artist: { $regex: artistNormRegex } },
      { title: 1, artist: 1, isrc: 1, suggestable: 1, 'performance.feuRatio': 1, 'performance.totalPlays': 1 }
    ).lean();

    // Map normKey → dbTrack (première correspondance gagne)
    const dbMap = new Map();
    for (const dt of dbTracks) {
      const k = `${normalizeForMatch(dt.title)}_${normalizeForMatch(dt.artist)}`;
      if (!dbMap.has(k)) dbMap.set(k, dt);
    }

    // 5. Assembler les tracks enrichies + filtrer suggestable !== false
    const enriched = [];
    for (const t of deezerTracks) {
      const normKey = `${normalizeForMatch(t.title)}_${normalizeForMatch(t.artist?.name || '')}`;
      const dbTrack = dbMap.get(normKey) || null;

      // Filtre suggestable : si trouvé en DB et explicitement false → exclure
      if (dbTrack && dbTrack.suggestable === false) continue;

      enriched.push({
        // Champs Deezer
        deezerID:    t.id,
        title:       t.title,
        artist:      t.artist?.name || name,
        artworkUrl:  t.album?.cover_medium || t.album?.cover || null,
        duration:    t.duration || 0,
        preview:     t.preview  || null,
        deezerRank:  t.rank     || 0,
        // Enrichissement AhOuai (0 si non trouvé en DB)
        feuRatio:    dbTrack?.performance?.feuRatio   || 0,
        totalPlays:  dbTrack?.performance?.totalPlays || 0,
        inAhOuaiDB:  !!dbTrack,
      });
    }

    // 6. Tri : feuRatio DESC → totalPlays DESC → Deezer rank DESC
    enriched.sort((a, b) => {
      if (b.feuRatio   !== a.feuRatio)   return b.feuRatio   - a.feuRatio;
      if (b.totalPlays !== a.totalPlays) return b.totalPlays - a.totalPlays;
      return b.deezerRank - a.deezerRank;
    });

    // 7. Pagination
    const total   = enriched.length;
    const page    = enriched.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    // Retirer les champs internes du tri (pas utiles au front)
    const tracks = page.map(({ feuRatio, totalPlays, inAhOuaiDB, ...t }) => t);

    console.log(`[by-artist] "${name}" → ${total} tracks (${enriched.filter(t => t.inAhOuaiDB).length} in AhOuai DB), offset=${offset}, limit=${limit}, hasMore=${hasMore}`);

    res.json({ tracks, total, hasMore, artistName: name, offset, limit });

  } catch (err) {
    console.error('[by-artist] ❌ Error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
