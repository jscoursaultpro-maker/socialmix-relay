import { Router } from 'express';
import crypto from 'crypto';
import Track from '../models/Track.js';
import SoloVote from '../models/SoloVote.js';

// ★ Solo votes route — POST /api/track/vote
// Anonymous votes from /track landing page (viral loop).
// Rate-limited by IP, dedup by IP+track via SoloVote unique index.

const router = Router();

// ─── In-memory rate limiter (simple, no dependency) ──────────────────
const rateLimitMap = new Map(); // Map<ipHash, { count, resetAt }>
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ipHash) {
  const now = Date.now();
  const entry = rateLimitMap.get(ipHash);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ipHash, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Cleanup stale entries every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 10 * 60 * 1000);

// ─── POST /vote ─────────────────────────────────────────────────────
router.post('/vote', async (req, res) => {
  try {
    const { deezerID, isrc, title, artist, voteType } = req.body || {};

    // Validation
    if (!deezerID || typeof deezerID !== 'number') {
      return res.status(400).json({ error: 'deezerID required (number)' });
    }
    if (!voteType || !['bof', 'top', 'feu'].includes(voteType)) {
      return res.status(400).json({ error: "voteType required: 'bof' | 'top' | 'feu'" });
    }

    // IP hash (RGPD-safe — no raw IP stored)
    const rawIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const ipHash = crypto.createHash('sha256').update(rawIP).digest('hex').slice(0, 16);

    // Rate limit
    if (!checkRateLimit(ipHash)) {
      return res.status(429).json({ error: 'Rate limit exceeded (30/hour)' });
    }

    // Map vote type to Track field
    const fieldMap = { feu: 'feuSolo', top: 'likeSolo', bof: 'bofSolo' };
    const incField = `performance.ratings.${fieldMap[voteType]}`;

    // 1. Try to find existing Track by deezerID
    let track = await Track.findOne({ 'providers.deezer.trackId': deezerID });
    
    // 2. Fallback: try ISRC if provided
    if (!track && isrc) {
      track = await Track.findOne({ isrc });
    }

    if (track) {
      // Increment solo vote on existing Track
      await Track.updateOne({ _id: track._id }, { $inc: { [incField]: 1 } });
      console.log(`[SoloVote] ✅ ${voteType} on Track "${track.title}" (deezerID: ${deezerID})`);
    } else {
      // Track not in catalogue — save to SoloVote collection
      try {
        await SoloVote.create({
          deezerID,
          isrc: isrc || null,
          title: title || 'Unknown',
          artist: artist || 'Unknown',
          voteType,
          ipHash
        });
        console.log(`[SoloVote] 📝 New SoloVote: ${voteType} on "${title}" (deezerID: ${deezerID})`);
      } catch (err) {
        if (err.code === 11000) {
          // Duplicate vote from same IP — silently ignore
          console.log(`[SoloVote] ⚠️ Duplicate vote ignored: ${ipHash} on deezerID ${deezerID}`);
          return res.json({ ok: true, voted: false, reason: 'already_voted' });
        }
        throw err;
      }
    }

    return res.json({ ok: true, voted: true });
  } catch (err) {
    console.error('[SoloVote] ❌ Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
