import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';
import Party from '../models/Party.js';
import HostPlaybackHistory from '../models/HostPlaybackHistory.js';
import { Photo } from '../models/Photo.js';
import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { resolvePhotoAccess, filterPhotosForUser } from '../utils/photoVisibility.js';

import FoundersIntent from '../models/FoundersIntent.js';

const router = express.Router();

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

router.use(requireAuth);

router.get('/:code/details', async (req, res) => {
  try {
    const user = req.currentUser;
    const code = (req.params.code || '').toUpperCase();

    // Verify user is in participants
    let userIdVariants = [user._id.toString()];
    try { userIdVariants.push(new mongoose.Types.ObjectId(user._id)); } catch (_) {}

    const party = await Party.findOne({
      code,
      'participants.userId': { $in: userIdVariants }
    }).lean();

    if (!party) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'User is not a participant of this party' });
    }

    // 1. TRACKS
    const hph = await HostPlaybackHistory.aggregate([
      { $match: { partyCode: code } },
      { $sort: { playedAt: 1 } },
      { $lookup: {
          from: 'tracks',
          localField: 'trackId',
          foreignField: '_id',
          as: 'trackData'
      }},
      { $unwind: { path: '$trackData', preserveNullAndEmptyArrays: true } }
    ]);

    const tracks = hph.map(h => ({
      title: h.trackData?.title || h.titleFallback || 'Unknown Track',
      artist: h.trackData?.artist || h.artistFallback || 'Unknown Artist',
      genre: h.trackData?.genre || h.genreFallback || '',
      bpm: h.trackData?.bpm || 0,
      playedAt: h.playedAt,
      fireCount: h.fireCount || 0,
      likeCount: h.likeCount || 0,
      mehCount: h.mehCount || 0,
      suggestedBy: h.suggestedBy
    }));

    // 2. PARTICIPANTS
    // Batch lookup foundersRank for all participants
    const participantUserIds = (party.participants || [])
      .map(p => p.userId)
      .filter(id => id && mongoose.Types.ObjectId.isValid(id.toString()));
      
    const usersForFounders = await User.find({ _id: { $in: participantUserIds } })
      .select('foundersRank')
      .lean();
      
    // Fetch intents for participants
    const intentsForFounders = await FoundersIntent.find({ userId: { $in: participantUserIds } }).lean();
      
    const founderMap = {};
    for (const u of usersForFounders) {
      founderMap[u._id.toString()] = {
        rank: u.foundersRank || null,
        intentSubmitted: false,
        intentPosition: null
      };
    }
    
    for (const intent of intentsForFounders) {
      if (intent.userId) {
        const idStr = intent.userId.toString();
        if (!founderMap[idStr]) {
          founderMap[idStr] = { rank: null, intentSubmitted: false, intentPosition: null };
        }
        const position = 1 + await FoundersIntent.countDocuments({ createdAt: { $lt: intent.createdAt } });
        founderMap[idStr].intentSubmitted = true;
        founderMap[idStr].intentPosition = position;
      }
    }

    const participants = (party.participants || []).map(p => {
      const founderData = p.userId ? (founderMap[p.userId.toString()] || {}) : {};
      return {
        name: p.name,
        emoji: p.emoji || '🎉',
        isHost: p.userId === party.hostUserId,
        isFounder: (founderData.rank != null && founderData.rank > 0),
        foundersRank: founderData.rank,
        foundersIntentSubmitted: founderData.intentSubmitted || false,
        foundersIntentPosition: founderData.intentPosition,
        joinedAt: p.joinedAt || party.createdAt,
        voteCount: p.voteCount || 0,
        photoCount: p.photoCount || 0,
        points: p.points || 0
      };
    });

    // 3. PHOTOS
    const photos = await Photo.find({ partyCode: code }).sort({ createdAt: -1 }).lean();
    const photoList = photos.map(ph => ({
      thumbnailDataURL: ph.url || ph.originalUrl || '',
      guestName: ph.guestName || 'Invité',
      sentAt: ph.createdAt
    }));
    
    // Add legacy photos if any (pre-fix #79)
    if (party.photos && Array.isArray(party.photos)) {
      const knownUrls = new Set(photoList.map(p => p.thumbnailDataURL));
      for (const legacy of party.photos) {
        const u = legacy.thumbnailDataURL || legacy.originalUrl || legacy.dataURL;
        if (u && !knownUrls.has(u)) {
          photoList.push({
            thumbnailDataURL: u,
            guestName: legacy.guestName || 'Invité',
            sentAt: legacy.sentAt || party.createdAt
          });
          knownUrls.add(u);
        }
      }
    }

    const reqUserId = user._id.toString();
    const hostUser = await User.findById(party.hostUserId).select('friends').lean();
    const accessLevel = resolvePhotoAccess(reqUserId, party, hostUser);
    
    // Si l'utilisateur n'a accès à rien, on pourrait renvoyer 403,
    // mais comme c'est "Mes Soirées" (participations), l'accessLevel sera normalement 'full'.
    // Cependant, le règles engine garantit qu'on est sûr.
    if (accessLevel === 'nothing') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'AfterGlow non disponible' });
    }
    
    // Remapper photoList avec l'ID pour que filterPhotosForUser fonctionne sur la coverPhotoId
    // Attention: filterPhotosForUser se base sur _id ou id de la photo.
    // Or dans user-participations.js, photoList contient thumbnailDataURL etc.,
    // ce n'est pas le format natif. Mais comme accessLevel = 'full' pour un participant, 
    // filterPhotosForUser renverra photoList directement.
    // On l'applique par sécurité.
    const finalPhotoList = filterPhotosForUser(photoList, accessLevel, party.coverPhotoId);

    res.json({
      party: {
        partyName: party.partyName || 'Sortie nocturne',
        partyCode: code,
        hostProfile: {
          name: party.hostProfile?.name || 'Host',
          emoji: party.hostProfile?.emoji || '👑',
          avatarURL: party.hostProfile?.avatarURL || null
        },
        createdAt: party.createdAt
      },
      photoAccess: accessLevel, // ★ Sprint X2
      tracks,
      participants,
      photos: finalPhotoList,
      messages: party.messages || [],
      leaderboard: [],
      genreVotes: {},
      myFavoriteTracks: []
    });

  } catch (err) {
    console.error(`[API] ❌ /api/user/participations/${req.params.code}/details error:`, err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
