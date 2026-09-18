import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';

const router = Router();
router.use(verifyGuestAuth);

router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ data: [] });

    // Minimal Deezer proxy
    const deezerRes = await fetch(`https://api.deezer.com/search/track?q=${encodeURIComponent(String(q))}&limit=5`);
    if (!deezerRes.ok) throw new Error('Deezer API error');
    const deezerData = await deezerRes.json();

    const results = (deezerData.data || []).map((t) => ({
      trackId: t.id.toString(),
      deezerID: t.id,
      title: t.title,
      artist: t.artist?.name || 'Inconnu',
      artworkUrl: t.album?.cover_xl || t.album?.cover_medium || t.album?.cover || null,
      isrc: t.isrc || null,
    }));

    res.json({ data: results });
  } catch (err) {
    console.error('[API] ❌ GET /api/library/search error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.get('/explore', async (req, res) => {
  try {
    const tag = req.query.tag;
    // Map tag to a Deezer playlist or generic search
    const tagToPlaylistId = {
      'Party': '1313621735', // Hits de l'été / Party
      'Chill': '1306931615',
      '80s': '1116190041',
      'Français': '1362526545',
      'Latino': '1970220662',
      'Rap FR': '1996494362'
    };
    
    let url = `https://api.deezer.com/playlist/${tagToPlaylistId[String(tag)] || '1313621735'}/tracks?limit=20`;
    
    const deezerRes = await fetch(url);
    if (!deezerRes.ok) throw new Error('Deezer API error');
    const deezerData = await deezerRes.json();

    const results = (deezerData.data || []).map((t) => ({
      trackId: t.id.toString(),
      deezerID: t.id,
      title: t.title,
      artist: t.artist?.name || 'Inconnu',
      artworkUrl: t.album?.cover_xl || t.album?.cover_medium || t.album?.cover || null,
      isrc: t.isrc || null,
    }));

    res.json({ data: results });
  } catch (err) {
    console.error('[API] ❌ GET /api/library/explore error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
