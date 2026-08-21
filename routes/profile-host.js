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
    
    // ─── 1. Get all ended parties for this host (lightweight) ────────
    // Use aggregate with allowDiskUse to handle 500+ parties without hitting sort memory limit
    const rawParties = await Party.aggregate([
      { $match: { hostUserId: userId, endedAt: { $ne: null } } },
      { $sort: { createdAt: -1 } },
      { $project: {
        code: 1, partyName: 1, welcomeText: 1, createdAt: 1, endedAt: 1,
        'lifecycle.startedAt': 1, streamingProvider: 1,
        _guestCount: {
          $size: {
            $filter: {
              input: { $ifNull: ['$participants', []] },
              as: 'p',
              cond: { $ne: ['$$p.isHost', true] }
            }
          }
        }
      }}
    ], { allowDiskUse: true });
    
    const partyCodes = rawParties.map(p => p.code);
    
    // ─── 2. Aggregate track counts per party from HPH ────────────────
    const hphCounts = await mongoose.connection.db.collection('hostplaybackhistories').aggregate([
      { $match: { partyCode: { $in: partyCodes } } },
      { $group: { _id: '$partyCode', trackCount: { $sum: 1 } } }
    ]).toArray();
    const trackCountMap = new Map(hphCounts.map(h => [h._id, h.trackCount]));
    
    // ─── 3. Get cover photo per party (first photo) ──────────────────
    const coverPhotos = await mongoose.connection.db.collection('photos').aggregate([
      { $match: { partyCode: { $in: partyCodes }, deletedAt: null } },
      { $sort: { sentAt: -1 } },
      { $group: { _id: '$partyCode', url: { $first: '$url' }, total: { $sum: 1 } } }
    ]).toArray();
    const coverMap = new Map(coverPhotos.map(p => [p._id, p.url]));
    const photoCountMap = new Map(coverPhotos.map(p => [p._id, p.total]));
    
    // ─── 4. Top genre from HPH → Track ───────────────────────────────
    const genreAgg = await mongoose.connection.db.collection('hostplaybackhistories').aggregate([
      { $match: { hostUserId: userId } },
      { $lookup: { from: 'tracks', localField: 'trackId', foreignField: '_id', as: '_t' } },
      { $unwind: { path: '$_t', preserveNullAndEmptyArrays: false } },
      { $group: { _id: '$_t.genre', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ], { allowDiskUse: true }).toArray();
    const topGenre = genreAgg[0]?._id || null;
    
    // ─── 5. Feu ratio aggregate ──────────────────────────────────────
    const feuAgg = await mongoose.connection.db.collection('hostplaybackhistories').aggregate([
      { $match: { hostUserId: userId } },
      { $group: {
        _id: null,
        totalFeu: { $sum: { $ifNull: ['$voteScore.feu', 0] } },
        totalCool: { $sum: { $ifNull: ['$voteScore.cool', 0] } },
        totalBof: { $sum: { $ifNull: ['$voteScore.bof', 0] } }
      }}
    ]).toArray();
    const feu = feuAgg[0] || {};
    const totalVotes = (feu.totalFeu || 0) + (feu.totalCool || 0) + (feu.totalBof || 0);
    const averageFeuRatio = totalVotes > 0 ? Math.round(((feu.totalFeu || 0) / totalVotes) * 100) / 100 : 0;
    
    // ─── 6. Build party list + compute stats ─────────────────────────
    let totalTracks = 0, totalGuests = 0, totalPhotos = 0, totalDurationMs = 0;
    let longestParty = null, biggestParty = null;
    
    const parties = rawParties.map(p => {
      const startedAt = p.lifecycle?.startedAt || p.createdAt;
      const durationMs = p.endedAt && startedAt ? new Date(p.endedAt) - new Date(startedAt) : 0;
      const durationMin = Math.round(durationMs / 60000);
      const tc = trackCountMap.get(p.code) || 0;
      const gc = p._guestCount || 0;
      const pc = photoCountMap.get(p.code) || 0;
      
      totalTracks += tc;
      totalGuests += gc;
      totalPhotos += pc;
      totalDurationMs += durationMs;
      
      if (!longestParty || durationMin > longestParty.minutes) {
        longestParty = { partyName: p.partyName || p.welcomeText || null, base62: encodeObjectId(p._id.toString()), minutes: durationMin };
      }
      if (!biggestParty || gc > biggestParty.guests) {
        biggestParty = { partyName: p.partyName || p.welcomeText || null, base62: encodeObjectId(p._id.toString()), guests: gc };
      }
      
      return {
        base62: encodeObjectId(p._id.toString()),
        partyName: p.partyName || p.welcomeText || null,
        startedAt,
        endedAt: p.endedAt,
        durationMinutes: durationMin,
        totalTracks: tc,
        totalGuests: gc,
        totalPhotos: pc,
        coverPhoto: coverMap.get(p.code) || null
      };
    });
    
    // ─── Response ────────────────────────────────────────────────────
    res.json({
      handle: user.profile?.handle,
      name: user.profile?.firstName || 'Hôte',
      emoji: user.profile?.emoji || null,
      memberSince: user.createdAt,
      stats: {
        totalParties: rawParties.length,
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
