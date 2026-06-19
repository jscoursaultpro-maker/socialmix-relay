import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const count = await Track.countDocuments({ isLabeled: { $ne: true } });
console.log('Unlabeled tracks:', count);

process.exit(0);
