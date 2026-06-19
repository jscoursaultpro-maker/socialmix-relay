import mongoose from 'mongoose';
import Track from './models/Track.js';
await mongoose.connect(process.env.MONGO_URI);

const t = await Track.findOne({ isLabeled: true });
console.log(t.qualityLevel);
process.exit(0);
