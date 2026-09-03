// scripts/audit_quality_levels.mjs
// Audit rapide : combien de tracks par qualityLevel + combien sans deezerID
// Utile pour comprendre le seed editorial_seed.json (filtré platine+complete+deezerID)

import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGODB_URI manquant'); process.exit(1); }

await mongoose.connect(MONGO_URI);
const Track = mongoose.model('Track', new mongoose.Schema({}, { strict: false }));

const total = await Track.countDocuments({});
const byLevel = await Track.aggregate([
  { $group: { _id: { $ifNull: ['$qualityLevel', 'null'] }, count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]);

const withDeezer = await Track.countDocuments({
  $or: [{ 'providers.deezer.trackId': { $gt: 0 } }, { deezerID: { $gt: 0 } }]
});
const withoutDeezer = total - withDeezer;

const suggestibleInBrain = await Track.countDocuments({
  qualityLevel: { $in: ['platine', 'complete'] },
  $or: [{ 'providers.deezer.trackId': { $gt: 0 } }, { deezerID: { $gt: 0 } }]
});

console.log('\n═══════════════════════════════');
console.log(`📊 Total tracks BDD : ${total}`);
console.log('═══════════════════════════════\n');

console.log('Par qualityLevel :');
byLevel.forEach(({ _id, count }) => {
  const pct = ((count / total) * 100).toFixed(1);
  const emoji = _id === 'platine' ? '💎' : _id === 'complete' ? '✅' : _id === 'partielle' ? '🟡' : _id === 'vide' ? '⚪' : '❓';
  console.log(`  ${emoji} ${_id.padEnd(10)} : ${String(count).padStart(5)}  (${pct}%)`);
});

console.log(`\n🎵 Avec deezerID       : ${withDeezer}  (${((withDeezer/total)*100).toFixed(1)}%)`);
console.log(`🚫 Sans deezerID       : ${withoutDeezer}`);
console.log(`\n🧠 Dans seed DJ Brain  : ${suggestibleInBrain}  (${((suggestibleInBrain/total)*100).toFixed(1)}% de la BDD)`);
console.log(`   = platine+complete AVEC deezerID → editorial_seed.json (moins 4 dup deezerID = ${suggestibleInBrain - 4})\n`);

process.exit(0);
