import mongoose from 'mongoose';

// 1. Connexion DB
await mongoose.connect(process.env.MONGO_URI);
import Track from '../models/Track.js';

// Configuration
const isDryRun = process.argv.includes('--dry-run');
const isApply = process.argv.includes('--apply');

if (!isDryRun && !isApply) {
  console.log("Précisez --dry-run ou --apply");
  process.exit(1);
}

// Helper: distance de Levenshtein basique pour vérifier la ressemblance
function levenshtein(a, b) {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = new Array(bn + 1);
  for (let i = 0; i <= bn; i++) {
    let row = new Array(an + 1);
    row[0] = i;
    matrix[i] = row;
  }
  for (let i = 1; i <= an; i++) {
    matrix[0][i] = i;
  }
  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
      }
    }
  }
  return matrix[bn][an];
}

function similarity(s1, s2) {
  s1 = s1.toLowerCase().trim();
  s2 = s2.toLowerCase().trim();
  let longer = s1;
  let shorter = s2;
  if (s1.length < s2.length) {
    longer = s2;
    shorter = s1;
  }
  let longerLength = longer.length;
  if (longerLength === 0) {
    return 1.0;
  }
  return (longerLength - levenshtein(longer, shorter)) / parseFloat(longerLength);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log(`🚀 Démarrage de l'enrichissement Deezer ID (Mode: ${isDryRun ? 'DRY-RUN' : 'APPLY'})`);
  
  const tracks = await Track.find({
    $or: [{ "providers.deezer.trackId": null }, { "providers.deezer.trackId": 0 }, { "providers.deezer.trackId": { $exists: false } }]
  });
  
  console.log(`Cible : ${tracks.length} tracks sans deezerID`);
  
  let matches = 0;
  let notFound = 0;
  const needsHumanCheckList = [];
  
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const artist = typeof t.artist === 'object' ? t.artist.name : t.artist;
    const query = `track:"${t.title}" artist:"${artist}"`;
    
    try {
      const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      
      if (data && data.data && data.data.length > 0) {
        const best = data.data[0];
        
        const titleSim = similarity(t.title, best.title);
        const artistSim = similarity(artist, best.artist.name);
        
        if (titleSim > 0.6 && artistSim > 0.6) {
          matches++;
          
          if (isApply) {
            t.providers = t.providers || {}; t.providers.deezer = t.providers.deezer || {}; t.providers.deezer.trackId = best.id;
            t.deezerRank = best.rank;
            t.coverUrl = best.album.cover_xl || best.album.cover_medium;
            t.isrc = best.isrc || t.isrc; // deezer search doesn't always return isrc but just in case
            t.duration = best.duration;
            t.source = "deezer_search_recovered";
            t.needs_review = true; // Mark it for human check in monitor
            
            await t.save();
          } else {
            needsHumanCheckList.push(`✅ MATCH: "${t.title}" — ${artist} ---> "${best.title}" — ${best.artist.name} (ID: ${best.id})`);
          }
        } else {
          notFound++;
          if (isDryRun) console.log(`❌ NOT FOUND (Sim too low): "${t.title}" — ${artist}`);
        }
      } else {
        notFound++;
        if (isDryRun) console.log(`❌ NOT FOUND (No result): "${t.title}" — ${artist}`);
      }
    } catch (e) {
      console.error(`Erreur sur ${t.title}:`, e.message);
    }
    
    if ((i + 1) % 50 === 0) {
      console.log(`[enrich-id] ${i + 1}/${tracks.length} | ${matches} matches | ${notFound} not found`);
    }
    
    await sleep(500); // 500ms rate limit
  }
  
  console.log(`\n🎉 BILAN FINAL :`);
  console.log(`- Tracks recovered : ${matches}`);
  console.log(`- Tracks not found : ${notFound}`);
  
  if (isDryRun) {
    console.log(`\nExemples de matches :`);
    needsHumanCheckList.slice(0, 10).forEach(msg => console.log(msg));
  }
  
  process.exit(0);
}

run();
