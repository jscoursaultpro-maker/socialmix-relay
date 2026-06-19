import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Track from '../models/Track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function stripDiacritics(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normKey(title, artist) {
  return [title, artist].map(s =>
    stripDiacritics((s||'').toLowerCase())
      .replace(/\b(feat\.?|ft\.?|featuring)\b/gi,'')
      .replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'')
      .replace(/[^a-z0-9\s]/g,'')
      .replace(/\s+/g,' ').trim()
  ).join('_');
}

const CLASSIC_ARTISTS = [
  'daft punk', 'abba', 'earth wind & fire', 'earth, wind & fire', 'jean-jacques goldman', 
  'michel sardou', 'michael jackson', 'queen', 'madonna', 'prince', 'the beatles', 
  'david bowie', 'elton john', 'indochine', 'telephone', 'rita mitsouko', 'france gall', 
  'claude francois', 'celine dion', 'whitney houston', 'george michael', 'kool & the gang',
  'gala', 'corona', 'spice girls', 'backstreet boys', 'gloria gaynor', 'donna summer',
  'stevie wonder', 'bee gees', 'chic', 'boney m', 'iam', 'ntm', 'mc solaar', 'kylie minogue',
  'depeche mode', 'new order', 'ac/dc', 'acdc', 'nirvana', 'red hot chili peppers',
  'justice', 'kavinsky', 'bob sinclar', 'martin solveig', 'david guetta'
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const mongoTracks = await Track.find().lean();
  const mongoIds = new Set();
  const mongoHashes = new Set();
  
  for (const m of mongoTracks) {
    const did = m.providers?.deezer?.trackId;
    if (did) mongoIds.add(String(did));
    mongoHashes.add(normKey(m.title, m.artist));
  }
  
  const editorialSeedPath = path.join(__dirname, '../../SocialMixApp/SocialMixApp/Resources/editorial_seed.json');
  const trackMetaPath = path.join(__dirname, '../../SocialMixApp/SocialMixApp/Resources/track_metadata.json');
  
  const editorialSeed = JSON.parse(fs.readFileSync(editorialSeedPath, 'utf-8'));
  const trackMetadata = JSON.parse(fs.readFileSync(trackMetaPath, 'utf-8'));
  
  const ghostsMap = new Map();
  
  function processTrack(t) {
    const did = String(t.providers?.deezer?.trackId || t.deezerID || 0);
    const hash = normKey(t.title, t.artist);
    if (did !== '0' && mongoIds.has(did)) return;
    
    const key = did !== '0' ? did : hash;
    if (!ghostsMap.has(key)) {
      let classification = "suspect";
      const titleLower = (t.title || '').toLowerCase();
      const artistLower = (t.artist || '').toLowerCase();
      
      const isDechet = 
        did === '0' || 
        titleLower.includes("mix") || 
        titleLower.includes("untitled") || 
        titleLower.includes("track 01") ||
        !artistLower || 
        artistLower === "dj" || 
        artistLower === "various" || 
        artistLower.includes("va -");
        
      const isDoublon = mongoHashes.has(hash);
      const isClassic = did !== '0' && CLASSIC_ARTISTS.some(a => artistLower.includes(a));
      
      if (isDechet) classification = "vrai_dechet";
      else if (isClassic) classification = "classique_a_migrer";
      else if (isDoublon) classification = "doublon";
      
      ghostsMap.set(key, { ...t, deezerID: did, classification, fallbackHash: hash });
    }
  }
  
  for (const st of (editorialSeed.tracks || [])) processTrack(st);
  for (const t of Object.values(trackMetadata)) processTrack(t);
  
  const ghosts = Array.from(ghostsMap.values());
  const toImport = ghosts.filter(g => g.classification === 'classique_a_migrer' || g.classification === 'suspect');
  const doublons = ghosts.filter(g => g.classification === 'doublon');
  
  console.log(`[import] Préparation de l'import de ${toImport.length} tracks...`);
  
  let inserted = 0;
  let skipped = 0;
  
  for (let i = 0; i < toImport.length; i++) {
    const g = toImport[i];
    
    // Check if duplicate exists (again for safety)
    const exists = await Track.findOne({ 'providers.deezer.trackId': Number(g.deezerID) });
    if (exists) {
      console.log(`[import] Skipping track ${i+1}/${toImport.length} : ${g.artist} — ${g.title} (already exists)`);
      skipped++;
      continue;
    }
    
    const doc = new Track({
      fallbackHash: g.fallbackHash,
      title: g.title,
      artist: g.artist,
      genre: g.genre || 'Pop',
      bpm: g.bpm || 0,
      energy: g.energy || 0,
      phase: g.phase || null,
      providers: { deezer: { trackId: Number(g.deezerID) } },
      source: "fantome_recovered",
      isLabeled: false,
      isGuessed: true,
      importedAt: new Date(),
      schemaVersion: "2.0"
    });
    
    await doc.save();
    console.log(`[import] Inserting track ${i+1}/${toImport.length} : ${g.artist} — ${g.title}`);
    inserted++;
  }
  
  console.log(`[import] DONE : ${inserted} inserted, ${skipped} skipped (duplicates)`);
  
  console.log(`\n[merge] Préparation de la fusion des ${doublons.length} doublons...`);
  let merged = 0;
  
  for (const d of doublons) {
    // d est le document JSON qui a le même fallbackHash qu'un document Mongo
    const mongoTrack = await Track.findOne({ fallbackHash: d.fallbackHash });
    if (mongoTrack) {
      let updated = false;
      // Migrer la phase si elle existe dans le JSON mais pas dans Mongo
      if (d.phase && !mongoTrack.phase) {
        mongoTrack.phase = d.phase;
        updated = true;
      }
      // Migrer l'énergie si elle est nulle dans Mongo
      if (d.energy > 0 && mongoTrack.energy === 0) {
        mongoTrack.energy = d.energy;
        updated = true;
      }
      if (updated) {
        await mongoTrack.save();
        console.log(`[merge] Kept ID ${mongoTrack.providers?.deezer?.trackId} (${d.artist} - ${d.title}), enriched from ghost ID ${d.deezerID}`);
        merged++;
      } else {
        console.log(`[merge] Skipped ID ${mongoTrack.providers?.deezer?.trackId} (${d.artist} - ${d.title}), already complete compared to ghost ID ${d.deezerID}`);
      }
    }
  }
  
  const finalCount = await Track.countDocuments({});
  console.log(`\n=== RÉSULTAT FINAL ===`);
  console.log(`- Tracks inserted : ${inserted}`);
  console.log(`- Tracks skipped (existed) : ${skipped}`);
  console.log(`- Tracks doublons fusionnées : ${merged}/${doublons.length}`);
  console.log(`- Total MongoDB final : ${finalCount}`);
  
  await mongoose.disconnect();
}

run().catch(console.error);
