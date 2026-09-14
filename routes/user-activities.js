/**
 * routes/user-activities.js
 * Auth: verifySupabaseJWT + findOrCreateFromSupabase.
 * Returns the timeline of guest activities ("Sorties" in iOS Afterglow).
 */
import express from 'express';
import { verifyUser } from '../middleware/auth.js';
import Party from '../models/Party.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(verifyUser);

// ─── GET /api/user/activities — Fetch all guest participations ───────
router.get('/', async (req, res) => {
  try {
    const user = req.currentUser;
    if (!user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
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
          // get the most voted track as topTrack if needed, but we can just leave it null for now
          // as iOS handles optional topTrack
        }
      }
    ]);

    const activities = parties.map(p => {
      // Map to iOS PartyActivity struct
      return {
        id: p.code,
        mode: 'club',
        date: p.createdAt,
        title: p.partyName || 'Sortie nocturne',
        trackCount: p.trackCount || 0,
        guestCount: p.participantCount || 0,
        topTrack: null,
        venueName: p.hostProfile ? p.hostProfile.name : null
      };
    });

    res.json({ ok: true, activities });
    
  } catch (err) {
    console.error('[API] ❌ GET /api/user/activities error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
