import { Router } from 'express';
import Track from '../models/Track.js';
import { _resolveIsrc, _resolveText, _normalizeForMatch } from './djbrain-lite.js';
import Party from '../models/Party.js'; // fallback to DB for party history if needed

const router = Router();
const rateLimitMap = new Map();
setInterval(() => rateLimitMap.clear(), 60000);

const linksCache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

router.get('/', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const count = (rateLimitMap.get(ip) || 0) + 1;
    rateLimitMap.set(ip, count);
    if (count > 30) return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });

    const partyCode = req.query.party?.toUpperCase();
    const title = req.query.title;
    const artist = req.query.artist;
    
    if (!partyCode || !title || !artist) return res.status(400).json({ error: 'MISSING_PARAMS' });

    const cacheKey = `${partyCode}::${_normalizeForMatch(title)}::${_normalizeForMatch(artist)}`;
    const cached = linksCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return res.json(cached.data);

    // 1. Retrieve party history
    const parties = req.app.get('parties');
    let party = parties?.get(partyCode);
    if (!party) {
        party = await Party.findOne({ code: partyCode }).select('trackHistory').lean();
    }
    
    let mongoId = null;
    let isrcFromHistory = null;
    
    if (party && party.trackHistory) {
      const normTitle = _normalizeForMatch(title);
      const normArtist = _normalizeForMatch(artist);
      for (const t of party.trackHistory) {
         if (_normalizeForMatch(t.title).includes(normTitle) && _normalizeForMatch(t.artist).includes(normArtist)) {
           mongoId = t.trackId || t._id;
           isrcFromHistory = t.isrc; // in case mongoId isn't reliable
           break;
         }
      }
    }

    let dbTrack = null;
    if (mongoId) {
       dbTrack = await Track.findById(mongoId).lean();
    } else if (isrcFromHistory) {
       dbTrack = await Track.findOne({ isrc: isrcFromHistory }).lean();
    }

    // 2. Prepare result
    const q = encodeURIComponent(`${title} ${artist}`);
    const result = {
      spotify: `https://open.spotify.com/search/${q}`,
      deezer: `https://www.deezer.com/search/${q}`,
      apple: `https://music.apple.com/search?term=${q}`,
      resolvedBy: { spotify: 'search', deezer: 'search', apple: 'search' }
    };

    if (dbTrack) {
      if (dbTrack.providers?.deezer?.trackId) {
        result.deezer = `https://www.deezer.com/track/${dbTrack.providers.deezer.trackId}`;
        result.resolvedBy.deezer = 'bdd';
      }
      
      if (dbTrack.providers?.appleMusic?.trackId) {
        result.apple = `https://music.apple.com/fr/song/${dbTrack.providers.appleMusic.trackId}`; // use fr to ensure correct redirect if possible
        result.resolvedBy.apple = 'bdd';
      }
      
      if (dbTrack.providers?.spotify?.trackId) {
        result.spotify = `https://open.spotify.com/track/${dbTrack.providers.spotify.trackId}`;
        result.resolvedBy.spotify = 'bdd';
      } else if (dbTrack.isrc) {
        const resolvedId = await _resolveIsrc(dbTrack.isrc, dbTrack._id);
        if (resolvedId) {
          result.spotify = `https://open.spotify.com/track/${resolvedId}`;
          result.resolvedBy.spotify = 'isrc';
        }
      } 
      
      if (result.resolvedBy.spotify === 'search') {
         // Fallback to text search if no ISRC or ISRC failed
         const resolvedId = await _resolveText(title, artist, dbTrack._id);
         if (resolvedId) {
           result.spotify = `https://open.spotify.com/track/${resolvedId}`;
           result.resolvedBy.spotify = 'text';
         }
      }
    }

    linksCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL });
    res.json(result);

  } catch (err) {
    console.error('[API] ❌ GET /api/track/links error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
