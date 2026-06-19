/**
 * enrich_deezer_ids.mjs
 * Recherche les deezerID manquants via l'API Deezer Search
 * Rate limit : 1 requête / 1.5 secondes (bien en dessous du 50/5s de Deezer)
 */
import mongoose from 'mongoose';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI manquant'); process.exit(1); }

await mongoose.connect(MONGO_URI);
const Track = (await import('./models/Track.js')).default;
console.log('✅ MongoDB connecté\n');

const DELAY_MS = 5000; // 5s entre chaque requête — safe

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanTitle(title) {
  // Remove parenthetical info, "feat.", "ft.", etc. for better search
  return title
    .replace(/\s*\(.*?\)/g, '')
    .replace(/\s*\[.*?\]/g, '')
    .replace(/\s*[-–—]\s*(feat|ft)\.?\s*.*/i, '')
    .replace(/\s*(feat|ft)\.?\s*.*/i, '')
    .trim();
}

function cleanArtist(artist) {
  // Take first artist if multiple
  return artist
    .split(/[,&]/)[0]
    .replace(/\s*feat\.?\s*.*/i, '')
    .replace(/\s*ft\.?\s*.*/i, '')
    .trim();
}

// Find tracks without deezerID (complete + partielle)
const tracks = await Track.find({
  qualityLevel: { $in: ['complete', 'partielle'] },
  $or: [
    { 'providers.deezer.trackId': null },
    { 'providers.deezer.trackId': 0 },
    { 'providers.deezer': null },
    { 'providers.deezer': { $exists: false } },
  ]
}).lean();

console.log(`🔍 ${tracks.length} tracks sans deezerID à enrichir\n`);

let found = 0, notFound = 0, errors = 0, dupsFixed = 0;

for (let i = 0; i < tracks.length; i++) {
  const t = tracks[i];
  const artistName = typeof t.artist === 'object' ? t.artist.name : t.artist;
  const cleanT = cleanTitle(t.title);
  const cleanA = cleanArtist(artistName);
  
  const query = `${cleanA} ${cleanT}`;
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`;
  
  process.stdout.write(`  [${i+1}/${tracks.length}] "${t.title}" — ${artistName} ... `);
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.error) {
      console.log(`⚠️ API error: ${data.error.message}`);
      errors++;
      await sleep(5000);
      continue;
    }
    
    const results = data.data || [];
    
    let bestMatch = null;
    const titleLower = t.title.toLowerCase();
    
    for (const r of results) {
      const rTitle = r.title?.toLowerCase() || '';
      const rArtist = r.artist?.name?.toLowerCase() || '';
      
      if ((rTitle.includes(titleLower.substring(0, 10)) || titleLower.includes(rTitle.substring(0, 10))) &&
          (rArtist.includes(cleanA.toLowerCase()) || cleanA.toLowerCase().includes(rArtist.substring(0, 5)))) {
        bestMatch = r;
        break;
      }
    }
    
    if (!bestMatch && results.length > 0) {
      bestMatch = results[0];
    }
    
    if (bestMatch) {
      const deezerID = bestMatch.id;
      const isrc = bestMatch.isrc || null;
      const duration = bestMatch.duration || null;
      const rank = bestMatch.rank || 0;
      const albumCover = bestMatch.album?.cover_medium || null;
      
      const update = {
        'providers.deezer.trackId': deezerID,
        'providers.deezer.artist': { id: bestMatch.artist?.id, name: bestMatch.artist?.name },
        'providers.deezer.album': { id: bestMatch.album?.id, title: bestMatch.album?.title, cover_medium: albumCover },
      };
      if (isrc) update.isrc = isrc;
      if (duration) update.duration = duration;
      if (rank > 0) update.deezerRank = rank;
      if (albumCover) update.coverArtURL = albumCover;
      
      try {
        await Track.updateOne({ _id: t._id }, { $set: update });
        console.log(`✅ deezerID=${deezerID} | "${bestMatch.title}" — ${bestMatch.artist?.name}`);
        found++;
      } catch (dupErr) {
        if (dupErr.code === 11000 && dupErr.message.includes('isrc')) {
          // ISRC conflict — retry without ISRC
          delete update.isrc;
          await Track.updateOne({ _id: t._id }, { $set: update });
          console.log(`✅ deezerID=${deezerID} (sans ISRC — doublon) | "${bestMatch.title}"`);
          found++;
          dupsFixed++;
        } else {
          throw dupErr;
        }
      }
    } else {
      console.log(`❌ Aucun résultat`);
      notFound++;
    }
    
  } catch (e) {
    console.log(`💥 ${e.message.substring(0, 80)}`);
    errors++;
    await sleep(5000);
  }
  
  await sleep(DELAY_MS);
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`✅ Trouvés  : ${found}`);
console.log(`❌ Non trouvés : ${notFound}`);
console.log(`⚠️  Erreurs  : ${errors}`);
console.log(`${'═'.repeat(50)}`);

await mongoose.disconnect();
