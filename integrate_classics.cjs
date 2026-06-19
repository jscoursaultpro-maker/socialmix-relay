const fs = require('fs');
const https = require('https');
const path = require('path');

function normalize(str) {
  return (str || '').toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedKey(title, artist) {
  return normalize(title) + "_" + normalize(artist);
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

const fetchDeezer = (title, artist) => {
  return new Promise((resolve) => {
    const q = encodeURIComponent(`${title} ${artist}`);
    const url = `https://api.deezer.com/search?q=${q}&limit=1`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.data && json.data.length > 0) {
            resolve(json.data[0]);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
};

(async () => {
  // 1. Load Existing DBs
  const seedPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json');
  let seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const djBrainPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift');
  const djBrainContent = fs.readFileSync(djBrainPath, 'utf8');

  // Build seen set
  const seenKeys = new Set();
  
  seedData.tracks.forEach(t => {
    seenKeys.add(normalizedKey(t.title, t.artist));
  });

  const regex = /CuratedTrack\(deezerID:\s*(-?\d+),\s*genre:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*artist:\s*"([^"]+)"/g;
  let match;
  while ((match = regex.exec(djBrainContent)) !== null) {
    seenKeys.add(normalizedKey(match[3], match[4]));
  }

  // 2. Load Classics
  const classics = JSON.parse(fs.readFileSync('claude_classics.json', 'utf8'));
  
  const toAdd = [];
  const duplicates = [];

  for (const t of classics) {
    const key = normalizedKey(t.title, t.artist);
    if (seenKeys.has(key)) {
      duplicates.push(t);
    } else {
      toAdd.push(t);
    }
  }

  console.log(`Classics loaded: ${classics.length}`);
  console.log(`Duplicates found: ${duplicates.length}`);
  console.log(`To resolve on Deezer: ${toAdd.length}`);

  let addedCount = 0;
  
  for (let i = 0; i < toAdd.length; i++) {
    const t = toAdd[i];
    process.stdout.write(`Resolving ${i+1}/${toAdd.length}: ${t.title} - ${t.artist}... `);
    
    // Deezer API rate limit friendly
    await new Promise(r => setTimeout(r, 200));
    const dTrack = await fetchDeezer(t.title, t.artist);
    
    let deezerId, albumId, isrc, duration;
    
    if (dTrack) {
      deezerId = dTrack.id;
      albumId = dTrack.album ? dTrack.album.id : null;
      duration = dTrack.duration;
      console.log(`FOUND (ID: ${deezerId})`);
    } else {
      let raw = Math.abs(hashCode(t.title + "_" + t.artist));
      if (raw === 0) raw = 1;
      deezerId = -raw;
      albumId = null;
      duration = 0;
      console.log(`NOT FOUND (Fallback ID: ${deezerId})`);
    }

    const newTrack = {
      fallbackHash: normalizedKey(t.title, t.artist),
      title: t.title,
      artist: t.artist,
      genre: t.newGenre,
      bpm: 0,
      energy: t.energy,
      popularity: t.popularity,
      source: "editorial",
      providers: {
        deezer: {
          trackId: deezerId,
          albumId: albumId
        }
      }
    };

    seedData.tracks.push(newTrack);
    seedData.trackCount = seedData.tracks.length;
    addedCount++;
  }

  // 4. Save editorial_seed.json
  fs.writeFileSync(seedPath, JSON.stringify(seedData, null, 2), 'utf8');
  console.log(`\nDone. Added ${addedCount} tracks to editorial_seed.json.`);
  
})();
