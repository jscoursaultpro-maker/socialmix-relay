import mongoose from 'mongoose';
import Track from './models/Track.js';
await mongoose.connect(process.env.MONGO_URI);

const res = await Track.updateMany(
  { source: 'batch_workflow' },
  { $set: { isLabeled: false, needs_review: true } }
);
console.log(`Unlabeled ${res.modifiedCount} tracks from batch_workflow`);
process.exit(0);
