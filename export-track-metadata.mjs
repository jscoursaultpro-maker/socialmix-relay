/**
 * export-track-metadata.mjs
 * Exporte MongoDB → track_metadata.json (le fichier utilisé par l'app iOS via DJBrain)
 * Met à jour UNIQUEMENT les genres, BPM et energy (préserve les coverURLs déjà enrichies)
 */
import mongoose from 'mongoose';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI manquant'); process.exit(1); }

const META_PATH = resolve(__dirname, '../SocialMixApp/SocialMixApp/Resources/track_metadata.json');

// Normalisation genre identique à celle de l'app
const GENRE_MAP = {
  'deep house':'House','progressive house':'House','tech house':'House',
  'tropical house':'House','future house':'House','tribal house':'House',
  'dance-pop':'Electro','eurodance':'Electro','trance':'Electro',
  'techno':'Electro','electro house':'Electro',
  'hip hop':'Hip-Hop','r&b':'R&B','trap':'Hip-Hop',
  'drum n bass':'Hip-Hop','contemporary r&b':'R&B',
  'funk / soul':'Disco','funk/soul':'Disco','funk':'Disco','nu-disco':'Disco',
  'reggaeton':'Latin','bachata':'Latin','guaracha':'Latin',
  'chanson':'COCOVARIET','variété fr':'COCOVARIET',
  'afrobeat':'Afro','afro house':'Afro',
  'pop rock':'Pop','synth-pop':'Pop','k-pop':'Pop',
  'alternative rock':'Rock',
  'ambient':'Chill','jazz':'Jazz',
  'reggae':'Latin',
};
function normalizeGenre(g) {
  const key = (g||'').trim().toLowerCase();
  return GENRE_MAP[key] || (g||'');
}

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

// 1. Charger le fichier existant (pour préserver les cover_medium déjà enrichies)
console.log('📂 Chargement de track_metadata.json...');
const existing = JSON.parse(readFileSync(META_PATH, 'utf-8'));
console.log(`📊 ${Object.keys(existing).length} titres existants`);

// 2. Connexion MongoDB
await mongoose.connect(MONGO_URI);
const db = mongoose.connection.db;
const col = db.collection('tracks');

// 3. Charger TOUS les titres qualifiés de Mongo
const mongoTracks = await col.find({
  $or: [
    { adminQualified: true },
    { bpm: { $gt: 0 } },
    { energy: { $gt: 0 } }
  ]
}).toArray();

console.log(`📀 ${mongoTracks.length} titres trouvés dans MongoDB`);

// 4. Construire un index Mongo par normKey
const mongoIndex = {};
for (const t of mongoTracks) {
  if (!t.title || !t.artist) continue;
  const key = normKey(t.title, t.artist);
  mongoIndex[key] = t;
}

// 5. Mettre à jour les genres dans le fichier existant
let updated = 0;
let unchanged = 0;

for (const [fileKey, entry] of Object.entries(existing)) {
  const key = normKey(entry.title || '', entry.artist || '');
  const mongo = mongoIndex[key];
  if (!mongo) { unchanged++; continue; }

  const newGenre = normalizeGenre(mongo.genre);
  
  if (newGenre && newGenre !== entry.genre) {
    console.log(`  ✏️  "${entry.title}" - ${entry.artist}: ${entry.genre} → ${newGenre}`);
    entry.genre = newGenre;
    updated++;
  }
  
  // Mettre à jour aussi BPM et energy si manquants ou différents
  if (mongo.bpm > 0) entry.bpm = mongo.bpm;
  if (mongo.energy > 0) entry.energy = mongo.energy;
  
  // Exporter la popularité et les KPIs
  if (mongo.deezerRank) entry.deezerRank = mongo.deezerRank;
  if (mongo.performance) {
    if (mongo.performance.feuRatio) entry.feuRatio = mongo.performance.feuRatio;
    if (mongo.performance.totalPlays) entry.totalPlays = mongo.performance.totalPlays;
  }
  if (mongo.suggestCount) entry.suggestCount = mongo.suggestCount;
}

console.log(`\n✅ ${updated} genres mis à jour, ${unchanged} titres non trouvés dans Mongo`);

// 6. Sauvegarder
writeFileSync(META_PATH, JSON.stringify(existing, null, 2), 'utf-8');
console.log(`💾 track_metadata.json sauvegardé !`);

// 7. Afficher la nouvelle ventilation
const genreCount = {};
for (const entry of Object.values(existing)) {
  genreCount[entry.genre] = (genreCount[entry.genre] || 0) + 1;
}
const sorted = Object.entries(genreCount).sort((a,b) => b[1]-a[1]);
console.log('\n── Ventilation après mise à jour ──');
sorted.forEach(([g, c]) => console.log(`  ${g.padEnd(20)} ${c}`));

await mongoose.disconnect();
process.exit(0);
