import { Router } from 'express';
import Party from '../models/Party.js';
import { fetchUserFoundersData } from '../utils/founders.js';

const router = Router();
const rateLimitMap = new Map();

// Clear map every 60 seconds
setInterval(() => rateLimitMap.clear(), 60000);

router.get('/:code/public-info', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const count = (rateLimitMap.get(ip) || 0) + 1;
    rateLimitMap.set(ip, count);
    if (count > 30) {
      return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
    }

    const { code } = req.params;
    const party = await Party.findOne({ code, endedAt: null })
      .populate('hostUserId', 'profile.handle profile.emoji profile.photo profile.firstName')
      .lean();

    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    const hostData = await fetchUserFoundersData(party.hostUserId?._id?.toString());
    const host = party.hostUserId ? {
      firstName: party.hostUserId.profile?.firstName || null,
      handle: party.hostUserId.profile?.handle || null,
      emoji: party.hostUserId.profile?.emoji || null,
      photo: party.hostUserId.profile?.photo || null,
      foundersRank: hostData.foundersRank,
      foundersIntentSubmitted: hostData.foundersIntentSubmitted,
      foundersIntentPosition: hostData.foundersIntentPosition
    } : null;

    const previewGuests = (party.participants || []).slice(0, 4).map(p => ({
      emoji: '👽', // anonymized
      avatarUrl: null,
      foundersRank: null
    }));

    res.json({
      code: party.code,
      name: party.welcomeText || null,
      startedAt: party.createdAt || null,
      guestCount: party.participantCount || 0,
      coverPhotoId: (party.settings && party.settings.photosEnabled === false) ? null : party.coverPhotoId,
      host,
      previewGuests,
      visibility: party.visibility || 'private'
    });

  } catch (err) {
    console.error('[API] ❌ GET /api/party/:code/public-info error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
