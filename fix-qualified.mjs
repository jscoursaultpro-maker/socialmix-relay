import mongoose from 'mongoose';
import Track from './models/Track.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const tracks = await Track.find({});
  let fixed = 0;
  
  for (const t of tracks) {
    let isQual = true;
    if (!t.genre || t.genre === 'EXCLUDED') isQual = false;
    if (!t.bpm || t.bpm === 0) isQual = false;
    if (!t.energy || t.energy === 0) isQual = false;
    
    // We update it
    if (t.adminQualified !== isQual) {
      t.adminQualified = isQual;
      await t.save();
      fixed++;
    }
  }
  
  const stats = await Track.aggregate([
    { $group: { _id: null, qual: { $sum: { $cond: ['$adminQualified', 1, 0] } }, noE: { $sum: { $cond: [{ $eq: ['$energy', 0] }, 1, 0] } }, noB: { $sum: { $cond: [{ $eq: ['$bpm', 0] }, 1, 0] } } } }
  ]);
  
  console.log(`Fixed ${fixed} tracks. New stats:`, stats);
  process.exit(0);
}
run().catch(console.error);
