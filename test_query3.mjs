import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const today = new Date();
today.setHours(0, 0, 0, 0);

const v = await Track.find({ isVerified: true, lastReviewedAt: { $gte: today } }).lean();
console.log('Verified & touched today:', v.length);
v.forEach(t => console.log(' -', t.title));
process.exit(0);
