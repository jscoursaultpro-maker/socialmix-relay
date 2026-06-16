/**
 * normalize-genres.mjs — Ramène tous les genres à 10 canoniques
 */
import mongoose from 'mongoose';
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) process.exit(1);
await mongoose.connect(MONGO_URI);
const T = (await import('./models/Track.js')).default;
console.log('✅ Connecté\n');

// Carte de normalisation : genre source → genre canonique
const MAP = {
  // House
  'deep house':'House','progressive house':'House','tech house':'House',
  'tropical house':'House','future house':'House','nu-disco':'House',
  'garage house':'House','tribal house':'House','electro house':'House',
  // Electro
  'electro':'Electro','eurobeat':'Electro','eurodance':'Electro',
  'dance-pop':'Electro','trance':'Electro','techno':'Electro',
  'hi nrg':'Electro','hands up':'Electro','leftfield':'Electro',
  'dub':'Electro','progressive breaks':'Electro',
  // Hip-Hop
  'hip hop':'Hip-Hop','hip-hop':'Hip-Hop','r&b':'Hip-Hop','trap':'Hip-Hop',
  'drum n bass':'Hip-Hop','jazz hip-hop':'Hip-Hop','jazzy hip-hop':'Hip-Hop',
  'contemporary r&b':'Hip-Hop','vocal':'Hip-Hop',
  // Disco
  'disco':'Disco','funk / soul':'Disco','funk/soul':'Disco',
  'funk':'Disco','funky':'Disco',
  // Latin
  'latin':'Latin','reggaeton':'Latin','bachata':'Latin','guaracha':'Latin',
  'dancehall':'Latin',
  // Pop
  'pop':'Pop','synth-pop':'Pop','k-pop':'Pop','pop rock':'Pop',
  'dance-pop (keep as pop)':'Pop',
  // COCOVARIET (chanson française + classics)
  'chanson':'COCOVARIET','années 80':'COCOVARIET','années 90':'COCOVARIET',
  'folk, world, & country':'COCOVARIET','cocovariet':'COCOVARIET',
  // Afro
  'afro':'Afro','afrobeat':'Afro',
  // Rock (garder pour les vrais rock)
  'rock':'Rock','alternative rock':'Rock','synth-pop (rock)':'Rock',
  // Chill
  'chill':'Chill','jazz':'Chill',
  // Reggae
  'reggae':'Reggae',
};

// Genres à ne PAS toucher (déjà canoniques)
const KEEP = new Set(['House','Electro','Hip-Hop','Disco','Latin','Pop','COCOVARIET','Afro','Rock','Chill','Reggae','R&B','Années 80','Années 90','Ambient']);

const all = await T.find({});
let changed = 0;
for (const track of all) {
  const raw = (track.genre || '').trim();
  if (KEEP.has(raw)) continue;
  const key = raw.toLowerCase();
  const canonical = MAP[key];
  if (canonical && canonical !== raw) {
    await T.updateOne({_id: track._id}, {$set: {genre: canonical}});
    changed++;
    console.log(`  ${raw.padEnd(28)} → ${canonical}`);
  }
}
console.log(`\n✅ ${changed} genres normalisés`);

// Résumé final
const dist = await T.aggregate([
  {$group:{_id:'$genre',count:{$sum:1}}},
  {$sort:{count:-1}}
]).toArray();
console.log('\n── Distribution finale ──');
dist.forEach(d => console.log(`  ${(d._id||'?').padEnd(16)} ${d.count}`));
await mongoose.disconnect(); process.exit(0);
