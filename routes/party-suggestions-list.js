import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';
import Party from '../models/Party.js';
import User from '../models/User.js';

const router = Router();
router.use(verifyGuestAuth);

/**
 * GET /api/party/:code/suggestions
 * Returns pending suggestions for a live party, enriched with suggestedBy user info.
 * Sorted by sentAt desc, limit 20.
 */
router.get('/:code/suggestions', async (req, res) => {
  try {
    const { code } = req.params;
    const party = await Party.findOne({ code, endedAt: null }).lean();
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    const allSuggestions = party.suggestions || [];
    const pending = allSuggestions
      .filter(s => s.status === 'pending')
      .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
      .slice(0, 20);

    // Collect unique userIds to batch-fetch
    const userIds = [...new Set(pending.map(s => s.suggestedBy || s.guestId).filter(Boolean))];
    const users = userIds.length > 0
      ? await User.find({ _id: { $in: userIds } })
          .select('profile.firstName profile.emoji foundersRank')
          .lean()
      : [];
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    const enriched = pending.map(s => {
      const uid = (s.suggestedBy || s.guestId || '').toString();
      const user = userMap.get(uid);
      return {
        id: s.id,
        title: s.title,
        artist: s.artist,
        artworkUrl: s.artworkUrl || s.coverURL || null,
        boostCount: s.boostCount || 0,
        boostedBy: s.boostedBy || [],
        sentAt: s.sentAt,
        suggestedBy: user ? {
          userId: uid,
          firstName: user.profile?.firstName || s.guestName || 'Guest',
          emoji: user.profile?.emoji || '👽',
          foundersRank: user.foundersRank || null
        } : {
          userId: uid,
          firstName: s.guestName || 'Guest',
          emoji: '👽',
          foundersRank: null
        }
      };
    });

    res.json({ suggestions: enriched });
  } catch (err) {
    console.error('[API] ❌ GET /api/party/:code/suggestions error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
