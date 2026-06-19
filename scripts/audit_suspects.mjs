import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Track from '../models/Track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = '/Users/Jean-Sebastien/Documents/Claude/Projects/Social M/SUSPECTS_ANALYSIS.md';

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
  
  function processTrack(t, source) {
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
  
  const suspects = Array.from(ghostsMap.values()).filter(t => t.classification === 'suspect');
  
  // Analyse
  let hasDeezerID = 0;
  let hasCleanArtist = 0;
  let allCleanCount = 0;
  const cleanSuspects = [];
  const genreCount = {};
  const sourceCount = {};
  
  for (const t of suspects) {
    const did = Number(t.deezerID);
    const titleLower = t.title.toLowerCase();
    const artistLower = t.artist.toLowerCase();
    
    let isDidOk = did > 0;
    let isArtistOk = artistLower && artistLower !== 'dj' && artistLower !== 'various' && !artistLower.includes('va -') && !artistLower.includes('unknown');
    let isTitleOk = titleLower && !titleLower.includes('mix') && !titleLower.includes('untitled') && !titleLower.includes('track 01');
    let isDifferent = titleLower !== artistLower;
    
    if (isDidOk) hasDeezerID++;
    if (isArtistOk && isDifferent) hasCleanArtist++;
    
    if (isDidOk && isArtistOk && isTitleOk && isDifferent) {
      allCleanCount++;
      cleanSuspects.push(t);
    }
    
    const g = t.genre || 'Inconnu';
    genreCount[g] = (genreCount[g] || 0) + 1;
    
    const s = t.source || 'Inconnu';
    sourceCount[s] = (sourceCount[s] || 0) + 1;
  }
  
  const sortedGenres = Object.entries(genreCount).sort((a,b) => b[1]-a[1]);
  const sortedSources = Object.entries(sourceCount).sort((a,b) => b[1]-a[1]);
  
  // Echantillon
  const sampleSize = Math.min(30, suspects.length);
  const sample = [...suspects].sort(() => 0.5 - Math.random()).slice(0, sampleSize);
  
  let md = `# ANALYSE QUALITATIVE DES 872 SUSPECTS — 16 Juin 2026\n\n`;
  md += `## a) FILTRES DE QUALITÉ\n`;
  md += `- Total suspects analysés : ${suspects.length}\n`;
  md += `- Suspects avec deezerID > 0 : ${hasDeezerID}\n`;
  md += `- Suspects avec artist propre : ${hasCleanArtist}\n`;
  md += `- **Suspects "all clean" (prêts à import) : ${allCleanCount}**\n\n`;
  
  md += `## b) DISTRIBUTION PAR GENRE\n`;
  for (const [g, c] of sortedGenres) md += `- ${g} : ${c}\n`;
  md += `\n`;
  
  md += `## c) DISTRIBUTION PAR SOURCE PROBABLE\n`;
  for (const [s, c] of sortedSources) md += `- ${s} : ${c}\n`;
  md += `\n`;
  
  md += `## d) ÉCHANTILLON DE 30 SUSPECTS REPRÉSENTATIF\n\n`;
  md += `| # | Titre | Artiste | DeezerID | Genre | Verdict potentiel |\n`;
  md += `|---|---|---|---|---|---|\n`;
  
  const chatSample = [];
  sample.forEach((t, i) => {
    let verdict = "à importer (vraie pépite)";
    const did = Number(t.deezerID);
    if (did === 0 || !t.artist || t.artist.toLowerCase() === 'dj') verdict = "à purger (douteux)";
    else if (!t.genre || t.genre === 'Inconnu') verdict = "à investiguer";
    
    const line = `| ${i+1} | ${t.title} | ${t.artist} | ${t.deezerID} | ${t.genre} | ${verdict} |`;
    md += line + `\n`;
    chatSample.push(line);
  });
  md += `\n`;
  
  const totalCible = mongoTracks.length + allCleanCount;
  md += `## e) HYPOTHÈSE D'IMPORT MASSIF\n`;
  md += `- MongoDB actuelle : ${mongoTracks.length}\n`;
  md += `- + suspects importables ("all clean") : ${allCleanCount}\n`;
  md += `- **= Total cible : ${totalCible} tracks**\n\n`;
  md += `**Temps de classification estimé :**\n`;
  md += `En important ces ${allCleanCount} tracks, il y aura ~${allCleanCount + 900} tracks à reclassifier (car ~942 n'ont pas de phase en base). Avec des vagues "Pre-Label 50" traitant 50 morceaux par 5 minutes, il faudrait environ ${(allCleanCount + 900)/50 * 5} minutes (soit environ ${Math.round((allCleanCount + 900)/50 * 5 / 60 * 10)/10} heures) de curation pour atteindre 100% de la base labellisée.\n`;

  fs.writeFileSync(REPORT_PATH, md, 'utf-8');
  console.log("=== CHAT SAMPLE ===");
  console.log(chatSample.join('\n'));
  console.log("=== CHAT SAMPLE END ===");
  
  await mongoose.disconnect();
}

run().catch(console.error);
