import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure we don't accidentally load dotenv if it overrides a production environment,
// but we allow it for local testing if needed.
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is required in environment variables.");
  console.error("Usage: MONGODB_URI='mongodb://...' node scripts/report-bogus-artists.mjs");
  process.exit(1);
}

const bogusKeywords = ["unknown", "various artists", "dj mix", "tbd"];

// Minimal track schema for read-only access
const trackSchema = new mongoose.Schema({
  title: String,
  artist: String,
  isrc: String,
  providerId: String
}, { collection: 'tracks' });

const Track = mongoose.model('Track', trackSchema);

async function run() {
  try {
    console.log("🔄 Connecting to MongoDB (READ-ONLY)...");
    // Connect to MongoDB with secondaryPreferred for read-only safety on replica sets
    await mongoose.connect(MONGODB_URI, { readPreference: 'secondaryPreferred' });
    console.log("✅ Connected to MongoDB");

    // regex for bogus artists
    const regex = new RegExp(bogusKeywords.join("|"), "i");
    
    console.log("🔍 Searching for bogus artists...");
    const tracks = await Track.find({ artist: { $regex: regex } }).lean();

    const csvLines = ["ID,Title,Artist,ISRC,ProviderId"];
    tracks.forEach(t => {
        const id = String(t._id);
        const title = `"${(t.title || '').replace(/"/g, '""')}"`;
        const artist = `"${(t.artist || '').replace(/"/g, '""')}"`;
        const isrc = t.isrc || "";
        const providerId = t.providerId || "";
        csvLines.push(`${id},${title},${artist},${isrc},${providerId}`);
    });

    const outputPath = path.join(__dirname, '..', 'bogus_artists.csv');
    fs.writeFileSync(outputPath, csvLines.join('\n'), 'utf8');
    
    console.log(`✅ Report generated: ${outputPath}`);
    console.log(`📊 Total bogus tracks found: ${tracks.length}`);

  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
}

run();
