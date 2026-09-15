import express from 'express';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';
import Party from '../models/Party.js';
import HostPlaybackHistory from '../models/HostPlaybackHistory.js';
import PartyPhoto from '../models/PartyPhoto.js';
import mongoose from 'mongoose';

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
    const participants = (party.participants || []).map(p => ({
      name: p.name,
      emoji: p.emoji || '🎉',
      isHost: p.userId === party.hostUserId,
      joinedAt: p.joinedAt || party.createdAt,
      voteCount: p.voteCount || 0,
      photoCount: p.photoCount || 0,
      points: p.points || 0
    }));

    // 3. PHOTOS
    const photos = await PartyPhoto.find({ partyCode: code }).sort({ createdAt: -1 }).lean();
    const photoList = photos.map(ph => ({
      thumbnailDataURL: ph.thumbnailUrl || ph.originalUrl,
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
      tracks,
      participants,
      photos: photoList,
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
