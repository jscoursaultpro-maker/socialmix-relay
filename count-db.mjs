import mongoose from 'mongoose';
import Track from './models/Track.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const c = await Track.countDocuments({ genre: { $nin: ['EXCLUDED', '', null] }, phase: { $ne: null } });
  const all = await Track.countDocuments();
  console.log('Total tracks: ' + all + ', Valid phase/genre tracks: ' + c);
  process.exit(0);
}
run().catch(console.error);
