import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const c = await Track.countDocuments({ isLabeled: { $ne: true }, gptSuggestion: { $ne: null } });
console.log({ needs_review_count: c });
process.exit(0);
