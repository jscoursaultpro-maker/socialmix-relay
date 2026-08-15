import mongoose from 'mongoose';

import Track from './models/Track.js';
import HostPlaybackHistory from './models/HostPlaybackHistory.js';
import Party from './models/Party.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  // Check recent HostPlaybackHistory
  const recentPlays = await HostPlaybackHistory.find().sort({ playedAt: -1 }).limit(10);
  console.log("\n--- Dernières lectures (HostPlaybackHistory) ---");
  recentPlays.forEach(p => {
    console.log(`[${p.playedAt.toISOString()}] ${p.title} - ${p.artist} (Suggéré: ${p.wasSuggestedByGuest}, Votes: 🔥${p.voteScore.feu} 😎${p.voteScore.cool} 😐${p.voteScore.bof})`);
  });

  // Check Track collection for recently updated tracks with plays
  const recentTracks = await Track.find({ 'performance.totalPlays': { $gt: 0 } }).sort({ updatedAt: -1 }).limit(10);
  console.log("\n--- Tracks récemment mis à jour en BDD (Track) ---");
  recentTracks.forEach(t => {
    console.log(`[${t.updatedAt.toISOString()}] ${t.title} - ${t.artist} (Plays: ${t.performance.totalPlays}, Feu Ratio: ${t.performance.feuRatio})`);
  });
  
  // Check recent parties
  const recentParties = await Party.find().sort({ createdAt: -1 }).limit(5);
  console.log("\n--- Dernières soirées (Party) ---");
  recentParties.forEach(p => {
    console.log(`[${p.createdAt.toISOString()}] Code: ${p.code}, Tracks: ${p.trackHistory ? p.trackHistory.length : 0}, Suggestions: ${p.suggestions ? p.suggestions.length : 0}, GuestVotes: ${Object.keys(p.guestVotes || {}).length}`);
  });

  process.exit(0);
}

run().catch(console.error);
