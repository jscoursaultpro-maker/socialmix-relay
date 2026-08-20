/**
 * routes/profile-host.js
 * ★ B2.1: GET /api/profile/host/:handle — Public host profile with aggregated stats.
 * No auth required (public endpoint). Respects profilePublic RGPD opt-in.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Party from '../models/Party.js';
import { encodeObjectId } from '../utils/base62.js';

const router = Router();

// ─── GET /:handle — Public host profile ─────────────────────────────
router.get('/:handle', async (req, res) => {
  try {
    const handle = req.params.handle.toLowerCase().trim();
    
    // Find user by profile.handle
    const user = await User.findOne({ 'profile.handle': handle }).lean();
    if (!user) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!user.preferences?.profilePublic) return res.status(404).json({ error: 'NOT_FOUND' });
    if (user.isBanned || user.isDeleted) return res.status(404).json({ error: 'NOT_FOUND' });
    
    const userId = user._id;
    
    // ─── Aggregate party stats for this host ─────────────────────────
    const partyAgg = await Party.aggregate([
      { $match: { hostUserId: userId, endedAt: { $ne: null } } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: 'hostplaybackhistories',
          localField: 'code',
          foreignField: 'partyCode',
          as: '_hph'
        }
      },
      {
        $lookup: {
          from: 'photos',
          let: { pc: '$code' },
          pipeline: [
            { $match: { $expr: { $eq: ['$partyCode', '$$pc'] }, deletedAt: null } },
            { $sort: { sentAt: -1 } },
            { $limit: 1 },
            { $project: { url: 1 } }
          ],
          as: '_coverPhoto'
        }
      },
      {
        $addFields: {
          _trackCount: { $size: '$_hph' },
          _guestCount: {
            $size: {
              $filter: {
                input: { $ifNull: ['$participants', []] },
                as: 'p',
                cond: { $ne: ['$$p.isHost', true] }
              }
            }
          },
          _photoCount: {
            $size: { $ifNull: ['$_coverPhoto', []] }
          },
          _startedAt: { $ifNull: ['$lifecycle.startedAt', '$createdAt'] },
          _genres: '$_hph.phase'
        }
      },
      {
        $project: {
          code: 1,
          partyName: { $ifNull: ['$partyName', '$welcomeText'] },
          createdAt: 1,
          endedAt: 1,
          _startedAt: 1,
          _trackCount: 1,
          _guestCount: 1,
          _coverPhotoUrl: { $arrayElemAt: ['$_coverPhoto.url', 0] },
          _durationMs: { $subtract: ['$endedAt', '$_startedAt'] },
          streamingProvider: 1
        }
      }
    ]);
    
    // ─── Compute aggregate stats ─────────────────────────────────────
    const totalParties = partyAgg.length;
    let totalTracks = 0, totalGuests = 0, totalDurationMs = 0;
    let longestParty = null, biggestParty = null;
    
    const parties = partyAgg.map(p => {
      const durationMin = p._durationMs ? Math.round(p._durationMs / 60000) : 0;
      totalTracks += p._trackCount || 0;
      totalGuests += p._guestCount || 0;
      totalDurationMs += p._durationMs || 0;
      
      if (!longestParty || durationMin > longestParty.minutes) {
        longestParty = { partyName: p.partyName, base62: encodeObjectId(p._id.toString()), minutes: durationMin };
      }
      if (!biggestParty || p._guestCount > biggestParty.guests) {
        biggestParty = { partyName: p.partyName, base62: encodeObjectId(p._id.toString()), guests: p._guestCount };
      }
      
      return {
        base62: encodeObjectId(p._id.toString()),
        partyName: p.partyName || null,
        startedAt: p._startedAt || p.createdAt,
        endedAt: p.endedAt,
        durationMinutes: durationMin,
        totalTracks: p._trackCount || 0,
        totalGuests: p._guestCount || 0,
        coverPhoto: p._coverPhotoUrl || null
      };
    });
    
    // ─── Top genre from HPH for this host ────────────────────────────
    const genreAgg = await mongoose.connection.db.collection('hostplaybackhistories').aggregate([
      { $match: { hostUserId: userId } },
      { $lookup: { from: 'tracks', localField: 'trackId', foreignField: '_id', as: '_t' } },
      { $unwind: { path: '$_t', preserveNullAndEmptyArrays: true } },
      { $match: { '_t.genre': { $ne: null } } },
      { $group: { _id: '$_t.genre', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]).toArray();
    const topGenre = genreAgg[0]?._id || null;
    
    // ─── Photo count for this host ───────────────────────────────────
    const totalPhotos = await mongoose.connection.db.collection('photos').countDocuments({
      partyCode: { $in: partyAgg.map(p => p.code) },
      deletedAt: null
    });
    
    // ─── Feu ratio ───────────────────────────────────────────────────
    const feuAgg = await mongoose.connection.db.collection('hostplaybackhistories').aggregate([
      { $match: { hostUserId: userId, 'voteScore.feu': { $gt: 0 } } },
      { $group: {
        _id: null,
        totalFeu: { $sum: '$voteScore.feu' },
        totalCool: { $sum: '$voteScore.cool' },
        totalBof: { $sum: '$voteScore.bof' }
      }}
    ]).toArray();
    const feu = feuAgg[0] || {};
    const totalVotes = (feu.totalFeu || 0) + (feu.totalCool || 0) + (feu.totalBof || 0);
    const averageFeuRatio = totalVotes > 0 ? Math.round(((feu.totalFeu || 0) / totalVotes) * 100) / 100 : 0;
    
    // ─── Response ────────────────────────────────────────────────────
    res.json({
      handle: user.profile?.handle,
      name: user.profile?.firstName || 'Hôte',
      emoji: user.profile?.emoji || null,
      memberSince: user.createdAt,
      stats: {
        totalParties,
        totalGuestsHosted: totalGuests,
        totalTracksPlayed: totalTracks,
        totalPhotos,
        totalDurationMinutes: Math.round(totalDurationMs / 60000),
        averageFeuRatio,
        topGenre,
        longestPartyMinutes: longestParty?.minutes || 0,
        biggestPartyGuests: biggestParty?.guests || 0
      },
      parties: parties.slice(0, 50),  // Cap at 50 most recent
      records: {
        longestParty,
        biggestParty
      },
      followersCount: user.followers?.length || 0,
      followingCount: user.following?.length || 0,
      friendsCount: user.friends?.length || 0
    });
    
  } catch (err) {
    console.error('[API] ❌ /api/profile/host error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
