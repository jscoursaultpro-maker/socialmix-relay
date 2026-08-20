/**
 * routes/profile-guest.js
 * ★ B2.1: GET /api/profile/guest/:handle — Public guest profile with attendance stats.
 * No auth required (public endpoint). Respects profilePublic RGPD opt-in.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { encodeObjectId } from '../utils/base62.js';

const router = Router();

// ─── GET /:handle — Public guest profile ─────────────────────────────
router.get('/:handle', async (req, res) => {
  try {
    const handle = req.params.handle.toLowerCase().trim();
    
    const user = await User.findOne({ 'profile.handle': handle }).lean();
    if (!user) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!user.preferences?.profilePublic) return res.status(404).json({ error: 'NOT_FOUND' });
    if (user.isBanned || user.isDeleted) return res.status(404).json({ error: 'NOT_FOUND' });
    
    const userId = user._id;
    const firstName = user.profile?.firstName || 'Guest';
    
    // ─── Parties attended from denormalized array ─────────────────────
    const attended = (user.partiesAttended || []).filter(p => p.role === 'guest');
    
    // ─── Suggestions and votes from HPH ──────────────────────────────
    const hphStats = await mongoose.connection.db.collection('hostplaybackhistories').aggregate([
      { $match: { suggestedBy: firstName } },
      { $group: {
        _id: null,
        totalSuggested: { $sum: 1 },
        totalPlayed: { $sum: { $cond: [{ $ne: ['$playedAt', null] }, 1, 0] } }
      }}
    ]).toArray();
    
    // ─── Photos shared ───────────────────────────────────────────────
    const photoCount = await mongoose.connection.db.collection('photos').countDocuments({
      guestName: firstName,
      deletedAt: null
    });
    
    // ─── Top genre listened (from parties attended → HPH → Track) ────
    const partyCodes = attended.map(p => p.partyCode).filter(Boolean);
    let topGenre = null;
    if (partyCodes.length > 0) {
      const genreAgg = await mongoose.connection.db.collection('hostplaybackhistories').aggregate([
        { $match: { partyCode: { $in: partyCodes } } },
        { $lookup: { from: 'tracks', localField: 'trackId', foreignField: '_id', as: '_t' } },
        { $unwind: { path: '$_t', preserveNullAndEmptyArrays: true } },
        { $match: { '_t.genre': { $ne: null } } },
        { $group: { _id: '$_t.genre', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 }
      ]).toArray();
      topGenre = genreAgg[0]?._id || null;
    }
    
    // ─── Votes given (from GuestVote or participantScores) ───────────
    const totalVotes = user.stats?.feuVotesCount || 0;
    
    // ─── Build parties list with host info ────────────────────────────
    const partyIds = attended.map(p => p.partyId).filter(Boolean);
    let partyHostMap = new Map();
    if (partyIds.length > 0) {
      const parties = await mongoose.connection.db.collection('parties').find(
        { _id: { $in: partyIds } },
        { projection: { hostUserId: 1, code: 1 } }
      ).toArray();
      for (const p of parties) {
        partyHostMap.set(p._id.toString(), p.hostUserId);
      }
    }
    
    // Lookup host profiles
    const hostIds = [...new Set([...partyHostMap.values()].filter(Boolean).map(id => id.toString()))];
    let hostProfileMap = new Map();
    if (hostIds.length > 0) {
      const hosts = await User.find(
        { _id: { $in: hostIds.map(id => new mongoose.Types.ObjectId(id)) } },
        { 'profile.firstName': 1, 'profile.handle': 1, 'profile.emoji': 1 }
      ).lean();
      for (const h of hosts) {
        hostProfileMap.set(h._id.toString(), h.profile);
      }
    }
    
    const parties = attended.slice(0, 50).map(p => {
      const hostId = partyHostMap.get(p.partyId?.toString());
      const hostProfile = hostId ? hostProfileMap.get(hostId.toString()) : null;
      return {
        base62: p.partyId ? encodeObjectId(p.partyId.toString()) : null,
        partyName: p.partyName || null,
        hostName: hostProfile?.firstName || null,
        hostHandle: hostProfile?.handle || null,
        joinedAt: p.joinedAt
      };
    });
    
    // ─── Favorite hosts (most attended) ──────────────────────────────
    const hostCounts = {};
    for (const p of attended) {
      const hid = partyHostMap.get(p.partyId?.toString())?.toString();
      if (hid) hostCounts[hid] = (hostCounts[hid] || 0) + 1;
    }
    const favoriteHosts = Object.entries(hostCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hid, count]) => {
        const hp = hostProfileMap.get(hid);
        return {
          handle: hp?.handle || null,
          name: hp?.firstName || null,
          emoji: hp?.emoji || null,
          count
        };
      });
    
    // ─── Response ────────────────────────────────────────────────────
    res.json({
      handle: user.profile?.handle,
      name: firstName,
      emoji: user.profile?.emoji || null,
      memberSince: user.createdAt,
      stats: {
        totalPartiesAttended: attended.length,
        totalTracksSuggested: hphStats[0]?.totalSuggested || 0,
        totalTracksPlayed: hphStats[0]?.totalPlayed || 0,
        totalVotesGiven: totalVotes,
        totalPhotosShared: photoCount,
        topGenreListened: topGenre
      },
      parties,
      favoriteHosts,
      followersCount: user.followers?.length || 0,
      followingCount: user.following?.length || 0,
      friendsCount: user.friends?.length || 0
    });
    
  } catch (err) {
    console.error('[API] ❌ /api/profile/guest error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
