import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const c = await Track.countDocuments({
      isLabeled: { $ne: true },
      gptSuggestion: null,
      $or: [{ energy: null }, { energy: 0 }]
    });
console.log({count: c});
process.exit(0);
