/**
 * patch_empty_genres.mjs
 *
 * Les 873 tracks ajoutés depuis le CSV ont genre="" car rebuild_from_csv
 * ne copiait pas le genre brut du CSV. Ce script le restaure puis lance
 * la normalisation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '../SocialMix V1.csv');
const DB_PATH  = path.join(__dirname, './curated_base_v3.json');

function parseCSVLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQuotes && line[i+1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else current += c;
  }
  result.push(current.trim());
  return result;
}

// Load CSV index
const raw    = fs.readFileSync(CSV_PATH, 'utf-8');
const lines  = raw.split('\n');
const header = parseCSVLine(lines[1]);
const COL_GENRE = header.indexOf('Genre');
const COL_FILE  = header.indexOf('Nom du fichier');

const csvByID = {};
for (let i = 2; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols  = parseCSVLine(line);
  const genre = cols[COL_GENRE] || '';
  const fname = cols[COL_FILE]  || '';
  const dz    = fname.match(/dz(\d+)/);
  if (dz) csvByID[parseInt(dz[1])] = genre;
}

// Patch DB
const db     = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const tracks = db.tracks || [];

// Genre normalization map (same as normalize_genres.mjs)
const GENRE_MAP = {
  'Hip Hop':'Hip-Hop','Hip-Hop':'Hip-Hop','Pop Rap':'Hip-Hop','Trap':'Hip-Hop',
  'Gangsta':'Hip-Hop','Jazzy Hip-Hop':'Hip-Hop','Trip Hop':'Hip-Hop',
  'House':'House','Progressive House':'House','Deep House':'House','Tech House':'House',
  'French House':'House','Future House':'House','Tropical House':'House',
  'Tribal House':'House','Euro House':'House','Garage House':'House',
  'Hard House':'House','Hands Up':'House','Hip-House':'House','Dance / Club':'House','Dance':'House',
  'Electro':'Electro','Electro House':'Electro','Techno':'Electro','Trance':'Electro',
  'Hard Trance':'Electro','Eurodance':'Electro','Drum n Bass':'Electro','Dubstep':'Electro',
  'Synthwave':'Electro','Electroclash':'Electro','ELECTRONIC':'Electro','Deep Techno':'Electro',
  'Progressive Breaks':'Electro','Hi NRG':'Electro','Eurobeat':'Electro','Psy-Trance':'Electro',
  'Leftfield':'Electro','Big Beat':'Electro','Hardcore':'Electro','IDM':'Electro',
  'Pop':'Pop','Dance-pop':'Pop','Synth-pop':'Pop','Indie Pop':'Pop','Europop':'Pop',
  'Power Pop':'Pop','K-pop':'Pop','New Wave':'Pop',
  'Disco':'Disco','Nu-Disco':'Disco','Italodance':'Disco',
  'Contemporary R&B':'R&B','R&B':'R&B','RnB/Swing':'R&B','Soul':'R&B','Neo Soul':'R&B','Funk / Soul':'R&B',
  'Latin':'Latin','Guaracha':'Latin','Bachata':'Latin',
  'Reggaeton':'Reggaeton','Dancehall':'Reggaeton','Reggae-Pop':'Reggaeton',
  'Reggae':'Afro','Dub':'Afro',
  'Rock':'Rock','Rock & Roll':'Rock','Indie Rock':'Rock','Pop Rock':'Rock','Surf':'Rock',
  'Goth Rock':'Rock','Emo':'Rock',
  'Chanson':'COCOVARIET',
  'Downtempo':'Chill','Balearic':'Chill',
  'Ambient':'Ambient',
};

const NEEDS_REVIEW = new Set([
  'UK Garage','Bass Music','Jazz','Classical','Non-Music','Industrial',
  'Sound Collage','Experimental','Stage & Screen','New Age','Chiptune',
  'Cut-up/DJ','Folk','Folk, World, & Country','Soundtrack','Theme',
  '',
]);

let patched = 0, normalized = 0, flagged = 0;

for (const t of tracks) {
  if (t.genre !== '') continue; // already has genre

  const csvGenre = csvByID[t.deezerID] || '';

  if (GENRE_MAP[csvGenre]) {
    t.genre = GENRE_MAP[csvGenre];
    t.needs_review = false;
    normalized++;
  } else if (NEEDS_REVIEW.has(csvGenre)) {
    t.genre = csvGenre || 'Unknown';
    t.needs_review = true;
    flagged++;
  } else {
    // Unknown genre from CSV → flag for monitor
    t.genre = csvGenre || 'Unknown';
    t.needs_review = true;
    flagged++;
  }
  patched++;
}

db.generatedAt = new Date().toISOString();
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

// Final distribution
const finalGenres = {};
tracks.forEach(t => { finalGenres[t.genre||''] = (finalGenres[t.genre||''] || 0) + 1; });
const reviewCount = tracks.filter(t => t.needs_review).length;

console.log(`\n✅ Patched: ${patched} tracks`);
console.log(`   → Normalisés directement : ${normalized}`);
console.log(`   → Flagués needs_review   : ${flagged}`);
console.log(`\n📊 Distribution finale:`);
Object.entries(finalGenres).sort((a,b)=>b[1]-a[1]).forEach(([g,c])=>
  console.log(`   ${(g||'VIDE').padEnd(22)}: ${c}`)
);
console.log(`\n🔍 Total needs_review : ${reviewCount}/${tracks.length}`);
console.log(`✅ curated_base_v3.json mis à jour\n`);
