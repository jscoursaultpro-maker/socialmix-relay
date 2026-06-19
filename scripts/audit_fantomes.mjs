import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Track from '../models/Track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dotenv is loaded via --env-file so we don't strictly need it if ran with it, 
// but we'll manually load if possible or just rely on the env flag.

const REPORT_PATH = '/Users/Jean-Sebastien/Documents/Claude/Projects/Social M/AUDIT_FANTOMES_2026-06-16.md';

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
  console.log("Connectant à MongoDB...");
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
  
  const ghostsMap = new Map(); // deezerID or fallbackHash -> track object
  
  function processTrack(t, source) {
    const did = String(t.providers?.deezer?.trackId || t.deezerID || 0);
    const hash = normKey(t.title, t.artist);
    
    // Check if in Mongo by ID
    if (did !== '0' && mongoIds.has(did)) return;
    
    // Record it as ghost
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
      
      ghostsMap.set(key, {
        title: t.title || 'Inconnu',
        artist: t.artist || 'Inconnu',
        deezerID: did,
        genre: t.genre || 'Inconnu',
        phase: t.phase || 'Aucune',
        energy: t.energy || 0,
        source: source,
        classification
      });
    }
  }
  
  for (const st of (editorialSeed.tracks || [])) processTrack(st, 'editorial_seed');
  for (const t of Object.values(trackMetadata)) processTrack(t, 'track_metadata');
  
  const ghosts = Array.from(ghostsMap.values());
  
  const categories = {
    vrai_dechet: [],
    classique_a_migrer: [],
    doublon: [],
    suspect: []
  };
  
  for (const g of ghosts) {
    categories[g.classification].push(g);
  }
  
  let md = `# AUDIT DES TRACKS FANTÔMES — 16 Juin 2026\n\n`;
  md += `Ce rapport liste les morceaux présents dans les fichiers JSON iOS mais absents de MongoDB.\n\n`;
  
  md += `## Stats globales\n`;
  md += `- **Total fantômes :** ${ghosts.length}\n`;
  md += `- **vrai_dechet :** ${categories.vrai_dechet.length}\n`;
  md += `- **classique_a_migrer :** ${categories.classique_a_migrer.length}\n`;
  md += `- **doublon :** ${categories.doublon.length}\n`;
  md += `- **suspect :** ${categories.suspect.length}\n\n`;
  
  function renderTable(list, title, desc) {
    let res = `## Liste \`${title}\`\n${desc}\n\n`;
    res += `| Titre | Artiste | ID | Genre | E | Phase | Source |\n`;
    res += `|---|---|---|---|---|---|---|\n`;
    for (const g of list) {
      res += `| ${g.title} | ${g.artist} | ${g.deezerID} | ${g.genre} | ${g.energy} | ${g.phase} | ${g.source} |\n`;
    }
    res += `\n`;
    return res;
  }
  
  md += renderTable(categories.vrai_dechet, "vrai_dechet", "À supprimer sans regret (pas d'ID ou titres génériques).");
  md += renderTable(categories.classique_a_migrer, "classique_a_migrer", "Artistes majeurs non présents en base (à récupérer potentiellement).");
  md += renderTable(categories.doublon, "doublon", "Le titre/artiste existe en base mais sous un Deezer ID différent.");
  md += renderTable(categories.suspect, "suspect", "Cas particuliers à reviewer.");
  
  fs.writeFileSync(REPORT_PATH, md, 'utf-8');
  console.log(`Report generated successfully at ${REPORT_PATH}`);
  
  await mongoose.disconnect();
}

run().catch(console.error);
