import fs from 'fs';
import https from 'https';

async function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

const DJBRAIN_PATH = '/Users/Jean-Sebastien/App Workshop/Virtual DJ V3/SocialMixApp/SocialMixApp/Engine/DJBrain.swift';
const SEED_PATH = '/Users/Jean-Sebastien/App Workshop/Virtual DJ V3/SocialMixApp/SocialMixApp/Resources/editorial_seed.json';

function normalizeGenre(raw) {
  const g = (raw || '').trim();
  const map = {
    'Electro/Dance': 'Electro',
    'Pop FR': 'COCOVARIET',
    'Afro House': 'Afro',
    'Chill/Lounge': 'Chill',
    'Latino': 'Latin',
    'Dancehall': 'Reggaeton',
    'Techno': 'Electro',
    'World': 'Afro',
    'Other': '',
    '0': '',
    '0 ': '',
    '': '',
    'House': 'Electro',
  };
  return map[g] !== undefined ? map[g] : g;
}

function parseEditorialCatalog() {
  const swift = fs.readFileSync(DJBRAIN_PATH, 'utf8');
  const startIdx = swift.indexOf('private let editorialCatalog');
  if (startIdx === -1) return [];
  
  // Find the end of the dictionary
  const endIdx = swift.indexOf('private let', startIdx + 50);
  const catalogBlock = swift.substring(startIdx, endIdx !== -1 ? endIdx : swift.length);
  
  const tracks = [];
  const genreRegex = /"([^"]+)":\s*\[([\s\S]*?)\]/g;
  
  let genreMatch;
  while ((genreMatch = genreRegex.exec(catalogBlock)) !== null) {
    const genre = genreMatch[1];
    const entries = genreMatch[2];
    
    const queryRegex = /"([^"]+)"/g;
    let queryMatch;
    while ((queryMatch = queryRegex.exec(entries)) !== null) {
      tracks.push({
        query: queryMatch[1],
        genre: normalizeGenre(genre)
      });
    }
  }
  return tracks;
}

async function main() {
  console.log("Parsing editorialCatalog from DJBrain...");
  const queries = parseEditorialCatalog();
  console.log(`Found ${queries.length} queries.`);
  
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const existingTracks = seed.tracks;
  
  const existingKeys = new Set();
  for (const t of existingTracks) {
    const key = (t.title + '_' + t.artist).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    existingKeys.add(key);
    if (t.deezerID) existingKeys.add(String(t.deezerID));
    if (t.isrc) existingKeys.add(t.isrc);
  }

  let added = 0;
  let skipped = 0;

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const url = 'https://api.deezer.com/search?limit=1&q=' + encodeURIComponent(q.query);
    
    try {
      const res = await fetchPage(url);
      if (res.data && res.data[0]) {
        const top = res.data[0];
        
        // Check dedup
        const key = (top.title + '_' + top.artist.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
        if (existingKeys.has(key) || existingKeys.has(String(top.id))) {
          skipped++;
          continue;
        }

        // Enrich
        const detail = await fetchPage('https://api.deezer.com/track/' + top.id);
        
        const newTrack = {
          title: top.title,
          artist: top.artist.name,
          genre: q.genre,
          bpm: detail.bpm || 0,
          energy: 7,
          deezerID: top.id,
          isrc: detail.isrc || null,
          source: 'editorial'
        };
        
        existingTracks.push(newTrack);
        existingKeys.add(key);
        existingKeys.add(String(top.id));
        if (newTrack.isrc) existingKeys.add(newTrack.isrc);
        added++;
        process.stdout.write('+');
      } else {
        process.stdout.write('-');
      }
    } catch(e) {
      process.stdout.write('x');
    }
    
    // Throttle
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n\nAdded: ${added}`);
  console.log(`Skipped (already in seed): ${skipped}`);
  
  seed.trackCount = existingTracks.length;
  const genres = {};
  for (const t of existingTracks) {
    genres[t.genre] = (genres[t.genre] || 0) + 1;
  }
  seed.genreDistribution = genres;
  
  fs.writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2));
  console.log(`Total tracks now: ${existingTracks.length}`);
}

main();
