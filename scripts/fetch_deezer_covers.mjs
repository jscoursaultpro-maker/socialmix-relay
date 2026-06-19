import mongoose from 'mongoose';
import Track from '../models/Track.js';

const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchDeezer(trackId) {
  try {
    const res = await fetch(`https://api.deezer.com/track/${trackId}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.album?.cover_medium || null;
  } catch (err) {
    return null;
  }
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const tracks = await Track.find({
    coverArtURL: { $in: [null, ""] },
    "providers.deezer.trackId": { $exists: true, $ne: null }
  });

  console.log(`Starting fetch for ${tracks.length} covers from Deezer...`);
  
  let updated = 0;
  for (let i = 0; i < tracks.length; i += 10) {
    const batch = tracks.slice(i, i + 10);
    const promises = batch.map(async t => {
      const cover = await fetchDeezer(t.providers.deezer.trackId);
      if (cover) {
        t.coverArtURL = cover;
        await t.save();
        updated++;
      }
    });
    await Promise.all(promises);
    process.stdout.write(`\rProgress: ${Math.min(i + 10, tracks.length)} / ${tracks.length} | Updated: ${updated}`);
    await delay(200); // Respect limit
  }

  console.log(`\nFinished! Fetched ${updated} missing covers.`);
  process.exit(0);
}

run().catch(console.error);
