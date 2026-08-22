import mongoose from 'mongoose';
import User from '../models/User.js';
import Party from '../models/Party.js';
import Track from '../models/Track.js';
import HostPlaybackHistory from '../models/HostPlaybackHistory.js';

const FRESHNESS_WEIGHTS = {
  PLAYED_UNDER_15D_AGO: -30,
  PLAYED_15_TO_30D_AGO: -15,
  PLAYED_OVER_30D_AGO: 0,
  PLAYED_IN_LAST_3_PARTIES: -80
};

async function run() {
  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri);
  
  const hostUserId = '6a50de57ea70fae835205058';
  
  try {
    const hostUser = await User.findById(hostUserId).select('settings').lean();
    const last3Parties = await Party.find({ hostUserId }).sort({ createdAt: -1 }).limit(3).select('_id').lean();
    const last3PartyIds = last3Parties.map(p => p._id.toString());
    
    const history = await HostPlaybackHistory.aggregate([
      { $match: { hostUserId: new mongoose.Types.ObjectId(hostUserId) } },
      { $group: { _id: "$trackId", lastPlayedAt: { $max: "$playedAt" }, partiesPlayedIn: { $addToSet: "$partyId" } } }
    ]);
    
    const trackIds = history.map(item => item._id);
    const tracks = await Track.find({ _id: { $in: trackIds } }).select('providers.deezer.trackId').lean();
    
    const deezerIdMap = {};
    tracks.forEach(t => {
      if (t.providers?.deezer?.trackId) deezerIdMap[t._id.toString()] = t.providers.deezer.trackId.toString();
    });

    const scores = {};
    const msInDay = 24 * 3600 * 1000;
    const now = Date.now();

    history.forEach(item => {
      const trackId = item._id.toString();
      const deezerId = deezerIdMap[trackId];
      if (!deezerId) return;
      const daysAgo = (now - new Date(item.lastPlayedAt).getTime()) / msInDay;
      let score = 0;
      if (daysAgo < 15) score += FRESHNESS_WEIGHTS.PLAYED_UNDER_15D_AGO;
      else if (daysAgo <= 30) score += FRESHNESS_WEIGHTS.PLAYED_15_TO_30D_AGO;
      else score += FRESHNESS_WEIGHTS.PLAYED_OVER_30D_AGO;
      const inLast3 = item.partiesPlayedIn.some(pid => last3PartyIds.includes(pid.toString()));
      if (inLast3) score += FRESHNESS_WEIGHTS.PLAYED_IN_LAST_3_PARTIES;
      scores[deezerId] = score;
    });
    console.log(`✅ LOCAL TEST OK - Computed ${Object.keys(scores).length} scores`);
  } catch (err) {
    console.error("❌ CRASH LOCAL:", err);
  }
  await mongoose.disconnect();
}
run().catch(console.error);
