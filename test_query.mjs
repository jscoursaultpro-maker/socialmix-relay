import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const today = new Date();
today.setHours(0, 0, 0, 0);

const c1 = await Track.countDocuments({ lastReviewedAt: { $gte: today } });
const c2 = await Track.countDocuments({ isLabeled: true, lastReviewedAt: { $gte: today } });
const c3 = await Track.countDocuments({ isVerified: true });
const c4 = await Track.countDocuments({ chatgptQueueId: { $ne: null } });

console.log('lastReviewedAt >= today:', c1);
console.log('isLabeled=true && lastReviewedAt >= today:', c2);
console.log('isVerified=true:', c3);
console.log('chatgptQueueId != null:', c4);

process.exit(0);
