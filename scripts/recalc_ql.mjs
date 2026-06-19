import mongoose from 'mongoose';
import Track from '../models/Track.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const tracks = await Track.find({});
  let count = 0;
  for (const t of tracks) {
    // Just re-save to trigger the pre('save') hook
    await t.save();
    count++;
  }
  console.log(`Recalculated qualityLevel for ${count} tracks.`);
  process.exit(0);
}

run().catch(console.error);
