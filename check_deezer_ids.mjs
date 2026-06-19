import mongoose from 'mongoose';
import Track from './models/Track.js';
await mongoose.connect(process.env.MONGO_URI);

const count = await Track.countDocuments({
  coverArtURL: { $in: [null, ""] },
  "providers.deezer.trackId": { $exists: true, $ne: null }
});

console.log(`Tracks to fetch from Deezer: ${count}`);
process.exit(0);
