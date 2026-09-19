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
    // Include pending + suggestions with no status (legacy data compatibility)
    const pending = allSuggestions
      .filter(s => !s.status || s.status === 'pending')
      .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
      .slice(0, 20);
    console.log(`[suggestions] Party ${code}: ${allSuggestions.length} total, ${pending.length} pending/unset`);

    // Collect unique userIds to batch-fetch (filter out non-ObjectId markers like "host")
    const OID_RE = /^[0-9a-fA-F]{24}$/;
    const rawIds = [...new Set(pending.map(s => s.suggestedBy || s.guestId).filter(Boolean))];
    const validIds = rawIds.filter(id => OID_RE.test(String(id)));
    const users = validIds.length > 0
      ? await User.find({ _id: { $in: validIds } })
          .select('profile.firstName profile.emoji foundersRank')
          .lean()
      : [];
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    // Host profile fallback for suggestions with suggestedBy="host"
    const hostProfile = party.hostProfile || {};
    const hostName = hostProfile.firstName || hostProfile.name || 'Host';
    const hostEmoji = hostProfile.emoji || '🎧';

    const enriched = pending.map(s => {
      const uid = (s.suggestedBy || s.guestId || '').toString();
      const isHost = uid === 'host' || !OID_RE.test(uid);
      const user = userMap.get(uid);
      return {
        id: (s._id || s.id || '').toString(),
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
          firstName: isHost ? hostName : (s.guestName || 'Guest'),
          emoji: isHost ? hostEmoji : '👽',
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
