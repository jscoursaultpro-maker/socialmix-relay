import mongoose from 'mongoose';
import Track from '../models/Track.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const doc = await Track.findOne({ deezerRank: { $gt: 0 } }).lean();
  console.log("EXEMPLE TRACK ENRICHIE:");
  console.log(JSON.stringify(doc, null, 2));
  process.exit(0);
}
run();
