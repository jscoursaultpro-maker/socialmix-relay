import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const provCount = await Track.countDocuments({ "providers.deezer.trackId": { $exists: true, $ne: null, $ne: 0 } });
const deezerIdCount = await Track.countDocuments({ deezerID: { $exists: true, $ne: null, $ne: 0 } });

console.log({ provCount, deezerIdCount });
process.exit(0);
