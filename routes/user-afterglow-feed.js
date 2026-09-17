import { Router } from 'express';
import User from '../models/User.js';
import Party from '../models/Party.js';
import { Photo } from '../models/Photo.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';
import { resolvePhotoAccess, filterPhotosForUser } from '../utils/photoVisibility.js';

const router = Router();

// Cache RAM 5min par (requestingUserId + targetHandle)
const feedCache = new Map();

async function requireSupabaseAuth(req, res, next) {
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
    console.error('[requireSupabaseAuth] error:', err.message);
    res.status(401).json({ error: 'AUTH_INVALID', message: 'Invalid or expired token' });
  }
}

// GET /api/user/:handle/afterglow-feed
router.get('/:handle/afterglow-feed', requireSupabaseAuth, async (req, res) => {
  try {
    const handle = (req.params.handle || '').toLowerCase();
    const reqUserId = req.currentUser._id.toString();
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    // Cache check
    const cacheKey = `${reqUserId}_${handle}_${offset}_${limit}`;
    const cached = feedCache.get(cacheKey);
    if (cached && (Date.now() - cached.time < 5 * 60 * 1000)) {
      console.log(`[AfterGlowFeed] 🔥 Cache hit for ${cacheKey}`);
      return res.json(cached.data);
    }

    // 1. Resolve targetUser
    const targetUser = await User.findOne({ 'profile.handle': handle }).lean();
    if (!targetUser) {
      return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User non trouvé' });
    }
    const targetUserIdStr = targetUser._id.toString();

    // 2. Relationship context
    let requestingUserRelation = 'stranger';
    if (reqUserId === targetUserIdStr) {
      requestingUserRelation = 'self';
    } else if (targetUser.friends && targetUser.friends.some(f => f.userId?.toString() === reqUserId)) {
      requestingUserRelation = 'friend';
    }

    // 3. Query MongoDB for parties (host or participant)
    // Filter strictly ended parties (endedAt != null) and not opted-out of AfterGlow
    const query = {
      $or: [
        { hostUserId: targetUserIdStr },
        { hostUserId: targetUser._id },
        { 'participants.userId': targetUserIdStr },
        { 'participants.id': targetUserIdStr }
      ],
      afterglowSaved: { $ne: false },
      endedAt: { $ne: null }
    };

    const parties = await Party.find(query)
      .sort({ endedAt: -1, createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    // Batch lookup all host users to speed up resolution
    const hostUserIds = [...new Set(parties.map(p => p.hostUserId?.toString()).filter(Boolean))];
    const hostUsers = await User.find({ _id: { $in: hostUserIds } }).select('friends').lean();
    const hostUsersMap = new Map(hostUsers.map(u => [u._id.toString(), u]));

    // Batch lookup all photos for the parties
    const partyCodes = parties.map(p => p.code);
    const allPhotos = await Photo.find({ partyCode: { $in: partyCodes }, deletedAt: null }).sort({ sentAt: -1 }).lean();
    const photosByParty = {};
    for (const p of allPhotos) {
      if (!photosByParty[p.partyCode]) photosByParty[p.partyCode] = [];
      photosByParty[p.partyCode].push(p);
    }

    const feed = [];

    for (const party of parties) {
      const hostUser = hostUsersMap.get(party.hostUserId?.toString()) || null;
      const accessLevel = resolvePhotoAccess(reqUserId, party, hostUser);

      if (accessLevel === 'nothing') {
        continue;
      }

      // Resolve photos based on accessLevel
      let rawPhotos = photosByParty[party.code] || [];
      const filteredPhotos = filterPhotosForUser(rawPhotos, accessLevel, party.coverPhotoId);

      const coverPhotoObj = rawPhotos.find(p => p._id?.toString() === party.coverPhotoId?.toString()) 
                         || (rawPhotos.length > 0 ? rawPhotos[0] : null);

      feed.push({
        partyCode: party.code,
        title: party.partyName || party.welcomeText || 'Sortie nocturne',
        date: party.endedAt || party.createdAt,
        hostProfile: {
          handle: hostUser?.profile?.handle || null,
          avatar: hostUser?.profile?.emoji || party.hostProfile?.emoji || null,
          isFounder: hostUser?.profile?.isFounder || false
        },
        afterglowVisibility: party.afterglowVisibility || party.visibility || 'private',
        photoAccess: accessLevel,
        photos: filteredPhotos,
        coverPhoto: coverPhotoObj,
        participants: (party.participants || []).slice(0, 5).map(p => ({
          name: p.name,
          emoji: p.emoji || '🎉'
        }))
      });
    }

    const responseData = {
      targetUser: {
        handle: targetUser.profile?.handle,
        avatarURL: targetUser.profile?.avatarURL || null,
        isFounder: targetUser.profile?.isFounder || false,
        firstName: targetUser.profile?.firstName || null
      },
      requestingUserRelation,
      afterglowCount: feed.length, // this is the count for this page, wait we might want total
      feed
    };

    // Store in cache
    feedCache.set(cacheKey, { data: responseData, time: Date.now() });

    res.json(responseData);
  } catch (err) {
    console.error(`[API] ❌ /api/user/:handle/afterglow-feed error:`, err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

export default router;
