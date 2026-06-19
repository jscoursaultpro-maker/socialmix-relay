/**
 * inject-phase-metadata.mjs
 * Injecte la `phase` depuis curated_base_v3.json dans track_metadata.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CURATED_PATH = resolve(__dirname, 'curated_base_v3.json');
const META_PATH = resolve(__dirname, '../SocialMixApp/SocialMixApp/Resources/track_metadata.json');

function normKey(title, artist) {
  return [title, artist].map(s =>
    (s||'').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/\b(feat\.?|ft\.?|featuring)\b/gi,'')
      .replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'')
      .replace(/[^a-z0-9\s]/g,'')
      .replace(/\s+/g,' ').trim()
  ).join('_');
}

console.log('📂 Chargement des fichiers...');
const existingMeta = JSON.parse(readFileSync(META_PATH, 'utf-8'));
const curatedBase = JSON.parse(readFileSync(CURATED_PATH, 'utf-8'));

console.log(`📊 ${Object.keys(existingMeta).length} titres dans track_metadata.json`);
console.log(`📊 ${curatedBase.tracks.length} titres dans curated_base_v3.json`);

const phaseMap = {
  'arrivée': 'arrival',
  'ambiance': 'ambiance',
  'montée': 'takeoff',
  'groove': 'groove',
  'apogée': 'party',
  'redescente': 'closing'
};

// Index curated tracks
const curatedIndex = {};
for (const t of curatedBase.tracks) {
  if (!t.title || !t.artist) continue;
  const key = normKey(t.title, t.artist);
  let rawPhase = t.phase || 'unclassified';
  curatedIndex[key] = phaseMap[rawPhase] || rawPhase;
}

let updated = 0;
let unchanged = 0;

for (const [fileKey, entry] of Object.entries(existingMeta)) {
  const key = normKey(entry.title || '', entry.artist || '');
  const phase = curatedIndex[key];
  
  if (phase && phase !== 'unclassified') {
    if (entry.phase !== phase) {
      entry.phase = phase;
      updated++;
    }
  } else {
    unchanged++;
  }
}

console.log(`\n✅ ${updated} phases injectées/mises à jour, ${unchanged} titres ignorés/non classifiés`);

// Sauvegarder
writeFileSync(META_PATH, JSON.stringify(existingMeta, null, 2), 'utf-8');
console.log(`💾 track_metadata.json sauvegardé !`);
