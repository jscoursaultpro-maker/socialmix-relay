import mongoose from 'mongoose';
import Track from './models/Track.js';
await mongoose.connect(process.env.MONGO_URI);

const total = await Track.countDocuments();
const withCover = await Track.countDocuments({ coverArtURL: { $ne: null } });
const withAlbumId = await Track.countDocuments({ "providers.deezer.albumId": { $exists: true } });

console.log(`Total: ${total}`);
console.log(`With coverArtURL: ${withCover}`);
console.log(`With albumId: ${withAlbumId}`);
process.exit(0);
