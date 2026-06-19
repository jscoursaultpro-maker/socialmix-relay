import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const c1 = await Track.countDocuments({ isLabeled: true, chatgptQueueId: { $ne: null } });
console.log('isLabeled=true && chatgptQueueId != null:', c1);

process.exit(0);
