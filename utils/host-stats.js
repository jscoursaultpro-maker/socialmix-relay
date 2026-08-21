/**
 * utils/host-stats.js
 * Extracted logic for computing host stats, used by profile-host and profile-compare.
 */
import mongoose from 'mongoose';
import Party from '../models/Party.js';
import { encodeObjectId } from './base62.js';

export async function computeHostStats(userId) {
  // ─── 1. Get all ended parties for this host (lightweight) ────────
  const rawParties = await Party.find({ hostUserId: userId, endedAt: { $ne: null } })
    .select('_id code partyName welcomeText createdAt endedAt lifecycle.startedAt streamingProvider')
    .sort({ createdAt: -1 })
    .lean();
  
  const partyCodes = rawParties.map(p => p.code);
  const partyIds = rawParties.map(p => p._id);
  
  // ─── 2. Aggregate guest counts per party (lightweight) ───────────
  const guestCounts = await Party.aggregate([
    { $match: { _id: { $in: partyIds } } },
    { $project: { 
      _id: 1, 
      guestCount: {
        $size: {
          $filter: {
            input: { $ifNull: ['$participants', []] },
            as: 'p',
            cond: { $ne: ['$$p.isHost', true] }
          }
        }
      }
    }}
  ]);
  const guestCountMap = new Map(guestCounts.map(g => [g._id.toString(), g.guestCount]));
  
  // ─── 3. Aggregate track counts per party from HPH ────────────────
  const hphCounts = await mongoose.connection.db.collection('hostplaybackhistories').aggregate([
    { $match: { partyCode: { $in: partyCodes } } },
    { $group: { _id: '$partyCode', trackCount: { $sum: 1 } } }
  ]).toArray();
  const trackCountMap = new Map(hphCounts.map(h => [h._id, h.trackCount]));
  
  // ─── 4. Get cover photo per party (first photo) ──────────────────
  const coverPhotos = await mongoose.connection.db.collection('photos').aggregate([
    { $match: { partyCode: { $in: partyCodes }, deletedAt: null } },
    { $sort: { sentAt: -1 } },
    { $group: { _id: '$partyCode', url: { $first: '$url' }, total: { $sum: 1 } } }
  ]).toArray();
  const coverMap = new Map(coverPhotos.map(p => [p._id, p.url]));
  const photoCountMap = new Map(coverPhotos.map(p => [p._id, p.total]));
  
  // ─── 5. Top genre from HPH → Track ───────────────────────────────
  let topGenre = null;
  if (partyCodes.length > 0) {
    const genreAgg = await mongoose.connection.db.collection('hostplaybackhistories').aggregate([
      { $match: { hostUserId: userId } },
      { $lookup: { from: 'tracks', localField: 'trackId', foreignField: '_id', as: '_t' } },
      { $unwind: { path: '$_t', preserveNullAndEmptyArrays: false } },
      { $group: { _id: '$_t.genre', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]).toArray();
    topGenre = genreAgg[0]?._id || null;
  }
  
  // ─── 6. Feu ratio aggregate ──────────────────────────────────────
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
  
  // ─── 7. Build party list + compute stats ─────────────────────────
  let totalTracks = 0, totalGuests = 0, totalPhotos = 0, totalDurationMs = 0;
  let longestParty = null, biggestParty = null;
  
  const parties = rawParties.map(p => {
    const startedAt = p.lifecycle?.startedAt || p.createdAt;
    const rawDurationMs = p.endedAt && startedAt ? new Date(p.endedAt) - new Date(startedAt) : 0;
    const durationMs = Math.max(0, rawDurationMs);
    const durationMin = Math.round(durationMs / 60000);
    const tc = trackCountMap.get(p.code) || 0;
    const gc = guestCountMap.get(p._id.toString()) || 0;
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

  return {
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
    parties,
    records: { longestParty, biggestParty }
  };
}
