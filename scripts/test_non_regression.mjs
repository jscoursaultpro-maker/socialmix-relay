import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { cappedPush } from '../utils/cappedPush.js';
import Party from '../models/Party.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

async function runTests() {
  console.log("--- POINT 2: Upload photo test ---");
  const pixelBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";
  try {
    const res = await cloudinary.uploader.upload(pixelBase64, { folder: 'socialmix/test' });
    console.log("✅ Uploaded! URL:", res.secure_url);
    // Cleanup
    await cloudinary.uploader.destroy(res.public_id);
  } catch (err) {
    console.error("❌ Upload failed:", err);
  }

  console.log("\n--- POINT 5: Cap circulaire ---");
  let arr = [];
  for (let i = 0; i < 250; i++) {
    arr = cappedPush(arr, { id: i }, 200);
  }
  console.log("✅ Array length after 250 pushes (cap 200):", arr.length);
  console.log("   First item ID (should be 50):", arr[0].id);

  console.log("\n--- POINT 8: Stress Test BSON Size ---");
  const dummyParty = {
    code: 'TEST01',
    photos: Array(100).fill({ url: 'https://res.cloudinary.com/dtj9ds4xi/image/upload/v1782135733/socialmix/photos/G3X9NS/k8ukeqoljvwys6ucdtmm.jpg', publicId: 'socialmix/photos/G3X9NS/k8ukeqoljvwys6ucdtmm', width: 1080, height: 1080, guestName: 'Guest', sentAt: new Date().toISOString() }),
    trackHistory: Array(500).fill({ title: 'Song Title', artist: 'Artist Name', genre: 'Pop', bpm: 120, playedAt: new Date().toISOString(), requestedBy: {source: 'guest', guestName: 'Guest'}, deezerID: 123456789 })
  };
  const sizeBytes = Buffer.byteLength(JSON.stringify(dummyParty), 'utf8');
  console.log(`✅ Size of party with 100 photos + 500 tracks: ${Math.round(sizeBytes / 1024)} KB (Limit is 16,000 KB)`);

  console.log("\n--- POINT 10: Check Live Party Intact ---");
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) throw new Error('MONGO_URI or MONGODB_URI env var required');
  await mongoose.connect(MONGO_URI);
  const party = await Party.findOne({ 'photos.url': { $exists: true } });
  if (party) {
    console.log(`✅ Found party ${party.code} with migrated photos.`);
    console.log(`   Photo 1 URL: ${party.photos[0].url}`);
    console.log(`   Photo 1 base64 present?: ${!!party.photos[0].base64}`);
  } else {
    console.log("❌ No migrated party found.");
  }
  await mongoose.disconnect();
}

runTests().catch(console.error);
