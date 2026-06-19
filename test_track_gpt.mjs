import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const t = await Track.findOne({ 'providers.deezer.trackId': 561836 }).lean();
console.log('track:', JSON.stringify(t.gptSuggestion, null, 2));
process.exit(0);
