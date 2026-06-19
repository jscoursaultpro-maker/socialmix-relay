/**
 * rebuild_from_csv.mjs
 *
 * Repart du CSV V1 comme source unique.
 * Supprime de curated_base_v3.json tous les titres qui ne sont PAS dans le CSV.
 * Garde uniquement les tracks matchés par deezerID.
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

// ─── Load CSV ─────────────────────────────────────────────────────────────────
const raw    = fs.readFileSync(CSV_PATH, 'utf-8');
const lines  = raw.split('\n');
const header = parseCSVLine(lines[1]);

const COL_TITLE  = header.indexOf('Titre');
const COL_ARTIST = header.indexOf('Artiste');
const COL_GENRE  = header.indexOf('Genre');
const COL_BPM    = header.indexOf('Bpm');
const COL_FILE   = header.indexOf('Nom du fichier');
const COL_DUR    = header.indexOf('Durée');

const csvByDeezerID = {};
let csvTotal = 0;

for (let i = 2; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols   = parseCSVLine(line);
  const title  = cols[COL_TITLE]  || '';
  const artist = cols[COL_ARTIST] || '';
  if (!title) continue;

  const bpm   = parseFloat(cols[COL_BPM]) || 0;
  const genre = cols[COL_GENRE] || '';
  const fname = cols[COL_FILE]  || '';
  const dur   = cols[COL_DUR]   || '';

  // Parse duration MM:SS → seconds
  let duration = 0;
  const durMatch = dur.match(/(\d+):(\d+)/);
  if (durMatch) duration = parseInt(durMatch[1]) * 60 + parseInt(durMatch[2]);

  const dzMatch  = fname.match(/dz(\d+)/);
  if (!dzMatch) continue;
  const deezerID = parseInt(dzMatch[1]);

  csvByDeezerID[deezerID] = { title, artist, genre, bpm, deezerID, duration, source: 'csv_v1' };
  csvTotal++;
}

console.log(`CSV V1: ${csvTotal} titres avec deezerID chargés`);

// ─── Load current DB ──────────────────────────────────────────────────────────
const db     = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const before = db.tracks.length;

// Stats sur ce qu'on va supprimer
const toKeep   = db.tracks.filter(t => t.deezerID > 0 && csvByDeezerID[t.deezerID]);
const toRemove = db.tracks.filter(t => !t.deezerID || !csvByDeezerID[t.deezerID]);

// Source breakdown of removed tracks
const removedBySrc = {};
toRemove.forEach(t => {
  const s = t.source || 'unknown';
  removedBySrc[s] = (removedBySrc[s] || 0) + 1;
});

console.log(`\nAvant : ${before} tracks`);
console.log(`À garder (dans CSV) : ${toKeep.length}`);
console.log(`À supprimer (hors CSV) : ${toRemove.length}`);
console.log('\nSupprimés par source:');
Object.entries(removedBySrc).sort((a,b)=>b[1]-a[1]).forEach(([s,c]) => {
  console.log(`  ${s.padEnd(42)}: ${c}`);
});

// ─── Rebuild: keep DB metadata if available, but CSV is master ───────────────
// For tracks in both CSV and DB: merge (DB BPM/genre/phase + CSV BPM if DB has 0)
const newTracks = toKeep.map(dbTrack => {
  const csv = csvByDeezerID[dbTrack.deezerID];
  return {
    ...dbTrack,
    // If BPM was 0 in DB, use CSV BPM
    bpm: (dbTrack.bpm && dbTrack.bpm > 0) ? dbTrack.bpm : csv.bpm,
    // Keep source as csv_v1 to track provenance
    source: 'csv_v1',
  };
});

// ─── Also add CSV tracks NOT yet in the DB (new ones) ────────────────────────
const existingIDs = new Set(toKeep.map(t => t.deezerID));
const newFromCSV  = [];

for (const [deezerID, csv] of Object.entries(csvByDeezerID)) {
  const id = parseInt(deezerID);
  if (!existingIDs.has(id)) {
    newFromCSV.push({
      deezerID: id,
      genre:    '',  // to be normalized
      title:    csv.title,
      artist:   csv.artist,
      bpm:      csv.bpm,
      duration: csv.duration,
      source:   'csv_v1',
      phase:    '',
    });
  }
}

console.log(`\nNouveaux titres CSV non encore en DB : ${newFromCSV.length}`);
if (newFromCSV.length > 0) {
  newFromCSV.slice(0,10).forEach(t => {
    console.log(`  + "${t.title}" — ${t.artist} [${t.bpm} BPM]`);
  });
  if (newFromCSV.length > 10) console.log(`  ... et ${newFromCSV.length - 10} autres`);
}

// ─── Save ─────────────────────────────────────────────────────────────────────
const allTracks = [...newTracks, ...newFromCSV];

db.tracks      = allTracks;
db.generatedAt = new Date().toISOString();
db.version     = 'v3-csv-only';

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

// ─── Final stats ──────────────────────────────────────────────────────────────
const withBPM  = allTracks.filter(t => t.bpm > 0).length;
const zeroBPM  = allTracks.filter(t => !t.bpm || t.bpm === 0).length;

console.log('\n══════════════════════════════════════════════════');
console.log(`  ✅ Avant  : ${before} tracks`);
console.log(`  ✅ Après  : ${allTracks.length} tracks (CSV uniquement)`);
console.log(`  🗑️  Supprimés : ${before - allTracks.length + newFromCSV.length} hors-CSV`);
console.log(`  ➕ Ajoutés   : ${newFromCSV.length} nouveaux depuis CSV`);
console.log(`  📊 Avec BPM : ${withBPM} | Sans BPM : ${zeroBPM}`);
console.log(`  📄 curated_base_v3.json mis à jour`);
console.log('══════════════════════════════════════════════════\n');
