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
    
    const firstName = user.profile?.firstName || 'Guest';
    const email = user.email; // Used to reliably match GuestSession
    
    // ─── 1. GuestSessions (totalPartiesAttended) ─────────────────────
    const guestSessions = await mongoose.connection.db.collection('guestsessions').find(
      { email: email },
      { projection: { partyCode: 1, joinedAt: 1 } }
    ).toArray();
    
    const attendedPartyCodes = [...new Set(guestSessions.map(s => s.partyCode))];
    const totalPartiesAttended = attendedPartyCodes.length;
    
    // ─── 2. Suggestions (totalTracksSuggested) ───────────────────────
    // V1 Approx: HostPlaybackHistory only stores suggestedBy as string (guestName)
    // For V1.1 we should probably use guestUserId or email
    const totalTracksSuggested = await mongoose.connection.db.collection('hostplaybackhistories').countDocuments({
      wasSuggestedByGuest: true,
      suggestedBy: firstName
    });
    
    // ─── 3. Votes (totalVotesGiven) ──────────────────────────────────
    // V1 Approx: Returning 0 or user.stats.feuVotesCount if we had it
    // // TODO V1.1 exact - parse participantScores or GuestVote for this email
    const totalVotesGiven = 0;
    
    // ─── 4. Photos (totalPhotosShared) ───────────────────────────────
    // V1 Approx: Photo only has guestName
    const totalPhotosShared = await mongoose.connection.db.collection('photos').countDocuments({
      guestName: firstName,
      deletedAt: null
    });
    
    // ─── 5. Top Genre & Parties List & Hosts ─────────────────────────
    let topGenreListened = null;
    let parties = [];
    let favoriteHosts = [];
    
    if (attendedPartyCodes.length > 0) {
      // Find the parties they attended
      const rawParties = await mongoose.connection.db.collection('parties').find(
        { code: { $in: attendedPartyCodes } },
        { projection: { _id: 1, code: 1, partyName: 1, welcomeText: 1, hostUserId: 1 } }
      ).toArray();
      
      const hostIds = [...new Set(rawParties.map(p => p.hostUserId).filter(Boolean))];
      
      // Fetch Host Profiles
      let hostProfileMap = new Map();
      if (hostIds.length > 0) {
        const hosts = await User.find(
          { _id: { $in: hostIds } },
          { 'profile.firstName': 1, 'profile.handle': 1, 'profile.emoji': 1 }
        ).lean();
        for (const h of hosts) {
          hostProfileMap.set(h._id.toString(), h.profile);
        }
      }
      
      // Top genre from the parties attended (using HPH)
      const genreAgg = await mongoose.connection.db.collection('hostplaybackhistories').aggregate([
        { $match: { partyCode: { $in: attendedPartyCodes } } },
        { $lookup: { from: 'tracks', localField: 'trackId', foreignField: '_id', as: '_t' } },
        { $unwind: { path: '$_t', preserveNullAndEmptyArrays: false } },
        { $group: { _id: '$_t.genre', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 }
      ]).toArray();
      topGenreListened = genreAgg[0]?._id || null;
      
      // Build Parties List
      parties = rawParties.map(p => {
        const hostProfile = p.hostUserId ? hostProfileMap.get(p.hostUserId.toString()) : null;
        // Find joinedAt from session (approx taking the first session for this code)
        const session = guestSessions.find(s => s.partyCode === p.code);
        
        return {
          base62: encodeObjectId(p._id.toString()),
          partyName: p.partyName || p.welcomeText || null,
          hostName: hostProfile?.firstName || null,
          hostHandle: hostProfile?.handle || null,
          joinedAt: session?.joinedAt || null
        };
      })
      .sort((a, b) => new Date(b.joinedAt || 0) - new Date(a.joinedAt || 0))
      .slice(0, 50); // limit 50, sort desc
      
      // Build Favorite Hosts
      const hostCounts = {};
      for (const p of rawParties) {
        const hid = p.hostUserId?.toString();
        if (hid) hostCounts[hid] = (hostCounts[hid] || 0) + 1;
      }
      
      favoriteHosts = Object.entries(hostCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([hid, count]) => {
          const hp = hostProfileMap.get(hid);
          return {
            handle: hp?.handle || null,
            name: hp?.firstName || null,
            emoji: hp?.emoji || null,
            count
          };
        });
    }
    
    // ─── Response ────────────────────────────────────────────────────
    res.json({
      userId: user._id,
      handle: user.profile?.handle,
      name: firstName,
      emoji: user.profile?.emoji || null,
      memberSince: user.createdAt,
      stats: {
        totalPartiesAttended,
        totalTracksSuggested,
        totalPhotosShared,
        totalVotesGiven,
        topGenreListened
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
