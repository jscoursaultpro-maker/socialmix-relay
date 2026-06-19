import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const c = await Track.countDocuments({ isLabeled: true, classifiedBy: "claude-sonnet-4-6-batch" });
console.log('Tracks completed:', c);
process.exit(0);
