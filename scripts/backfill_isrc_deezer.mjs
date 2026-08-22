import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env manually
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')
    .filter(l => l.match(/^[A-Z]/) && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.substring(0, idx).trim(), l.substring(idx + 1).replace(/^"|"$/g, '').trim()];
    })
);

const MONGO_URI = process.env.MONGO_URI || env.MONGO_URI || env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI manquant');
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    const tracksCollection = db.collection('tracks');

    // Mongoose ou collection native, on utilise la query du user
    // "providers.deezer.trackId" : { $exists: true, $ne: null }, isrc: { $exists: false }
    const tracksToBackfill = await tracksCollection.find({
      'providers.deezer.trackId': { $exists: true, $ne: null },
      $or: [
        { isrc: { $exists: false } },
        { isrc: null },
        { isrc: "" }
      ]
    }).limit(500).toArray();

    console.log(`🔍 Trouvé ${tracksToBackfill.length} tracks à backfill pour l'ISRC depuis Deezer`);

    let updated = 0;
    let failed = 0;
    let notFound = 0;

    for (let i = 0; i < tracksToBackfill.length; i++) {
      const track = tracksToBackfill[i];
      const deezerId = track.providers.deezer.trackId;

      try {
        const response = await fetch(`https://api.deezer.com/track/${deezerId}`);
        const data = await response.json();

        if (data && data.isrc) {
          await tracksCollection.updateOne(
            { _id: track._id },
            { $set: { isrc: data.isrc } }
          );
          updated++;
          if (i % 20 === 0) console.log(`✅ [${i}/${tracksToBackfill.length}] Updated ISRC for Deezer ID: ${deezerId} -> ${data.isrc}`);
        } else if (data && data.error) {
          console.warn(`⚠️ [${i}] Deezer API Error for ${deezerId}: ${data.error.message}`);
          failed++;
        } else {
          console.warn(`⚠️ [${i}] Pas d'ISRC retourné pour Deezer ID: ${deezerId}`);
          notFound++;
        }
      } catch (err) {
        console.error(`❌ [${i}] Fetch error for Deezer ID: ${deezerId}`, err.message);
        failed++;
      }

      // Rate limit: 25ms
      await sleep(25);
    }

    console.log('\n=== BILAN BACKFILL ISRC ===');
    console.log(`Total traité: ${tracksToBackfill.length}`);
    console.log(`Mises à jour: ${updated}`);
    console.log(`Non trouvés (Deezer n'a pas l'ISRC): ${notFound}`);
    console.log(`Erreurs API / Fetch: ${failed}`);

  } catch (err) {
    console.error('Erreur globale :', err);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Déconnecté de MongoDB');
  }
})();
