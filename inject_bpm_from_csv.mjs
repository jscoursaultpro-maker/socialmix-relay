/**
 * inject_bpm_from_csv.mjs
 *
 * Injecte les BPM manquants (=0) dans curated_base_v3.json
 * depuis SocialMix V1.csv, en matchant par deezerID (colonne "Nom du fichier").
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSV_PATH = path.join(__dirname, '../SocialMix V1.csv');
const DB_PATH  = path.join(__dirname, './curated_base_v3.json');

// ─── Parse CSV proprement (gère les guillemets et virgules dans les champs) ──
function parseCSVLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// ─── Load CSV ─────────────────────────────────────────────────────────────────
const raw   = fs.readFileSync(CSV_PATH, 'utf-8');
const lines = raw.split('\n');

// Line 0 = "sep=," | Line 1 = header | Line 2+ = data
const headerLine = lines[1];
const header     = parseCSVLine(headerLine);

const COL_TITLE    = header.indexOf('Titre');
const COL_ARTIST   = header.indexOf('Artiste');
const COL_GENRE    = header.indexOf('Genre');
const COL_BPM      = header.indexOf('Bpm');
const COL_FILENAME = header.indexOf('Nom du fichier');

console.log(`Colonnes: Titre[${COL_TITLE}] Artiste[${COL_ARTIST}] Genre[${COL_GENRE}] BPM[${COL_BPM}] Fichier[${COL_FILENAME}]`);

const csvByDeezerID = {};
const csvByKey      = {};
let csvTotal = 0, csvWithBPM = 0;

for (let i = 2; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  
  const cols   = parseCSVLine(line);
  const title  = cols[COL_TITLE]    || '';
  const artist = cols[COL_ARTIST]   || '';
  const genre  = cols[COL_GENRE]    || '';
  const bpmRaw = cols[COL_BPM]      || '';
  const fname  = cols[COL_FILENAME] || '';
  
  const bpm    = parseFloat(bpmRaw) || 0;
  const dzMatch = fname.match(/dz(\d+)/);
  const deezerID = dzMatch ? parseInt(dzMatch[1]) : 0;
  
  csvTotal++;
  if (bpm > 0) csvWithBPM++;
  
  const entry = { title, artist, genre, bpm, deezerID };
  
  if (deezerID > 0) {
    csvByDeezerID[deezerID] = entry;
  }
  // Also index by title+artist for tracks without deezerID
  const key = `${title.toLowerCase()}|${artist.toLowerCase()}`;
  if (key !== '|') csvByKey[key] = entry;
}

console.log(`CSV: ${csvTotal} lignes, ${csvWithBPM} avec BPM, ${Object.keys(csvByDeezerID).length} avec deezerID`);

// ─── Load DB & inject ─────────────────────────────────────────────────────────
const db     = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const tracks = db.tracks || [];

let fixed_deezerID = 0;
let fixed_key      = 0;
let still_zero     = 0;

for (const t of tracks) {
  if (t.bpm > 0) continue; // already has BPM

  // Try by deezerID first
  if (t.deezerID > 0 && csvByDeezerID[t.deezerID]) {
    const csv = csvByDeezerID[t.deezerID];
    if (csv.bpm > 0) {
      console.log(`  ✅ [ID:${t.deezerID}] "${t.title}" — BPM: 0 → ${csv.bpm}`);
      t.bpm = csv.bpm;
      fixed_deezerID++;
      continue;
    }
  }

  // Try by title+artist key
  const key = `${(t.title || '').toLowerCase()}|${(t.artist || '').toLowerCase()}`;
  if (csvByKey[key] && csvByKey[key].bpm > 0) {
    console.log(`  ✅ [KEY] "${t.title}" — BPM: 0 → ${csvByKey[key].bpm}`);
    t.bpm = csvByKey[key].bpm;
    fixed_key++;
    continue;
  }

  still_zero++;
}

// ─── Save ─────────────────────────────────────────────────────────────────────
db.generatedAt = new Date().toISOString();
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log('\n══════════════════════════════════════════');
console.log(`  ✅ BPM injectés (deezerID match): ${fixed_deezerID}`);
console.log(`  ✅ BPM injectés (titre+artiste) : ${fixed_key}`);
console.log(`  ⚠️  Toujours à 0 (absents CSV)  : ${still_zero}`);
console.log(`  📄 curated_base_v3.json mis à jour`);
console.log('══════════════════════════════════════════\n');
