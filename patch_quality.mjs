import mongoose from 'mongoose';
import Track from './models/Track.js';
await mongoose.connect(process.env.MONGO_URI);

const tracks = await Track.find({});
let updated = 0;
for (const t of tracks) {
  // Let the pre-save hook do its job
  t.markModified('qualityLevel');
  await t.save();
  updated++;
}
console.log(`Updated ${updated} tracks with new qualityLevel`);
process.exit(0);
