/**
 * routes/user-activities.js
 * Auth: verifySupabaseJWT + findOrCreateFromSupabase.
 * Returns the timeline of guest activities ("Sorties" in iOS Afterglow).
 */
import express from 'express';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';
import Party from '../models/Party.js';

const router = express.Router();

// ★ Phase 2: RAM cache (5 min) for /activities to prevent 40s cold-start timeouts
const activitiesCache = new Map();

// Middleware: extract authenticated user from JWT
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'AUTH_MISSING', message: 'Authorization: Bearer <token> required' });
    }
    const token = authHeader.slice(7);
    const payload = await verifySupabaseJWT(token);
    const user = await findOrCreateFromSupabase(payload);
    req.currentUser = user;
    next();
  } catch (err) {
    if (err.name === 'AuthError') {
      return res.status(401).json({ error: 'AUTH_FAILED', message: err.message });
    }
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
}

// Apply auth middleware to all routes
router.use(requireAuth);

// ─── GET /api/user/activities — Fetch all guest participations ───────
router.get('/', async (req, res) => {
  try {
    console.log('[activities] userId=', req.currentUser?._id?.toString());
    const user = req.currentUser;
    if (!user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    const userIdStr = user._id.toString();

    // ★ Check RAM cache
    const cached = activitiesCache.get(userIdStr);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[activities] 🔥 Cache hit for user ${userIdStr}`);
      return res.json({ ok: true, activities: cached.data });
    }

    // Find parties where the user is a participant (excluding those they hosted just to be clean, 
    // though normally host is not in participants, but just in case)
    const parties = await Party.aggregate([
      { 
        $match: { 
          'participants.userId': user._id.toString(),
          hostUserId: { $ne: user._id.toString() }, // Avoid returning hosted parties as club activities
          code: { $not: /_archived_/ }
        } 
      },
      { $sort: { createdAt: -1 } },
      { $limit: 100 }, // iOS limit for activities is 100
      { 
        $project: {
          _id: 0,
          code: 1,
          partyName: 1,
          createdAt: 1,
          hostProfile: 1,
          participantCount: { $size: { $ifNull: ["$participants", []] } },
          trackCount: { $size: { $ifNull: ["$trackHistory", []] } },
          startedAt: 1,
          endedAt: 1,
          genres: "$trackHistory.genre"
          // get the most voted track as topTrack if needed, but we can just leave it null for now
          // as iOS handles optional topTrack
        }
      }
    ]);

    const activities = parties.map(p => {
      // Calculate durationMin
      let durationMin = p.trackCount * 3;
      if (p.startedAt && p.endedAt) {
        durationMin = Math.round((new Date(p.endedAt).getTime() - new Date(p.startedAt).getTime()) / 60000);
      }
      
      // Calculate topGenre
      let topGenre = null;
      if (p.genres && p.genres.length > 0) {
        const counts = {};
        for (const g of p.genres) {
          if (g && typeof g === 'string') {
            counts[g] = (counts[g] || 0) + 1;
          }
        }
        let maxCount = 0;
        for (const g in counts) {
          if (counts[g] > maxCount) {
            maxCount = counts[g];
            topGenre = g;
          }
        }
      }

      // Map to iOS PartyActivity struct
      return {
        id: p.code,
        mode: 'club',
        date: p.createdAt,
        title: p.partyName || 'Sortie nocturne',
        trackCount: p.trackCount || 0,
        guestCount: p.participantCount || 0,
        topTrack: null,
        venueName: p.hostProfile ? p.hostProfile.name : null,
        durationMin,
        topGenre
      };
    });

    // ★ Store in RAM cache (TTL 5 mins)
    activitiesCache.set(userIdStr, {
      data: activities,
      expiresAt: Date.now() + 300000
    });
    console.log(`[activities] 💾 Cache stored for user ${userIdStr}`);

    res.json({ ok: true, activities });
    
  } catch (err) {
    console.error('[API] ❌ GET /api/user/activities error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
