import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '..', '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.match(/^[A-Z]/) && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.substring(0, i).trim(), l.substring(i+1).replace(/^"|"$/g, '').trim()]; })
);

const MONGO_URI = process.env.MONGO_URI || env.MONGO_URI || env.MONGODB_URI;

const DRY_RUN = process.env.LIVE !== '1';
const LIMIT = parseInt(process.env.LIMIT) || 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchDeezer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    const Track = mongoose.model('Track', new mongoose.Schema({}, { strict: false }));

    console.log(`\n=============================================`);
    console.log(`  BACKFILL BPM FROM DEEZER - ${DRY_RUN ? 'DRY RUN' : 'LIVE MODE'}`);
    console.log(`=============================================\n`);

    let query = Track.find({ 
      'providers.deezer.trackId': { $exists: true, $ne: null, $gt: 0 },
      $or: [{ bpm: { $exists: false } }, { bpm: null }, { bpm: 0 }]
    }).sort({ deezerRank: -1 });

    if (LIMIT > 0) {
      query = query.limit(LIMIT);
    }

    const tracks = await query.lean();
    console.log(`Total tracks à traiter : ${tracks.length}`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const t of tracks) {
      const deezerId = t.providers.deezer.trackId;
      try {
        const response = await fetchDeezer(`https://api.deezer.com/track/${deezerId}`);
        await sleep(40); // Rate limit 25 req/s

        if (response.error) {
          console.error(`❌ Deezer API error for track ${deezerId}: ${response.error.message}`);
          errors++;
          continue;
        }

        const bpm = response.bpm ? Math.round(response.bpm) : 0;

        if (bpm > 0) {
          console.log(`✅ Track ${t._id} ("${t.title}"): BPM trouvé -> ${bpm}`);
          updated++;
          if (!DRY_RUN) {
            await Track.updateOne(
              { _id: t._id },
              { $set: { bpm: bpm, bpmSource: 'deezer_api_v1_2026_07_14', bpm_confidence: 'deezer_api' } }
            );
          }
        } else {
          console.log(`⏭️ Track ${t._id} ("${t.title}"): no_bpm_from_deezer`);
          skipped++;
        }
      } catch (err) {
        console.error(`❌ Error fetching Deezer for track ${t._id} (${deezerId}): ${err.message}`);
        errors++;
      }
    }

    console.log(`\n--- RAPPORT FINAL ---`);
    console.log(`✅ Updated : ${updated}`);
    console.log(`⏭️ Skipped : ${skipped}`);
    console.log(`❌ Errors  : ${errors}`);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
})();
