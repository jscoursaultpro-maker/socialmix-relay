import mongoose from 'mongoose';
import Track from './models/Track.js';
await mongoose.connect(process.env.MONGO_URI);

const tracks = await Track.find({ source: 'batch_workflow' }).limit(5);
for (const t of tracks) {
  console.log(`Title: ${t.title}, Artist: ${t.artist}`);
}
process.exit(0);
