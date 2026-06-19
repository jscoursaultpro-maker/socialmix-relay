import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const all = await Track.countDocuments({});
const nullCount = await Track.countDocuments({ deezerID: null });
const zeroCount = await Track.countDocuments({ deezerID: 0 });
const noExCount = await Track.countDocuments({ deezerID: { $exists: false } });

console.log({ all, nullCount, zeroCount, noExCount });
process.exit(0);
