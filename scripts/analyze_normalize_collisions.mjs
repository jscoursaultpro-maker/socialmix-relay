// scripts/analyze_normalize_collisions.mjs
// Analyse les collisions potentielles si on aligne server.js fallbackHash sur iOS
// (suppression des espaces dans normalize).
//
// Usage:
//   node --env-file=.env scripts/analyze_normalize_collisions.mjs
//
// Ne modifie RIEN. Juste liste les tracks qui auraient le même fallbackHash après migration.

import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGODB_URI manquant'); process.exit(1); }

// ─── OLD normalize (server.js actuel) ────────────────────────────────────────
function normalizeOld(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function fallbackHashOld(title, artist) {
  return `${normalizeOld(title)}_${normalizeOld(artist)}`;
}

// ─── NEW normalize (aligné iOS - no spaces) ──────────────────────────────────
function normalizeNew(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]/g, '')  // ← retire aussi \s (l'espace)
    .trim();
}
function fallbackHashNew(title, artist) {
  return `${normalizeNew(title)}_${normalizeNew(artist)}`;
}

// ─── Analyse ────────────────────────────────────────────────────────────────
console.log('🔍 Analyse collisions potentielles : old normalize (spaces) vs new (no spaces)\n');

await mongoose.connect(MONGO_URI);
const Track = mongoose.model('Track', new mongoose.Schema({}, { strict: false }));

const tracks = await Track.find({}, { title: 1, artist: 1, fallbackHash: 1, isrc: 1 }).lean();
console.log(`📊 ${tracks.length} tracks en BDD\n`);

// Group by NEW hash
const groupsByNewHash = new Map();
let changedCount = 0;

for (const t of tracks) {
  const newHash = fallbackHashNew(t.title, t.artist);
  const oldHash = t.fallbackHash;
  if (newHash !== oldHash) changedCount++;

  if (!groupsByNewHash.has(newHash)) groupsByNewHash.set(newHash, []);
  groupsByNewHash.get(newHash).push({ _id: t._id, title: t.title, artist: t.artist, oldHash, newHash, isrc: t.isrc });
}

console.log(`🔄 ${changedCount} tracks auraient un fallbackHash différent après migration\n`);

// Trouver les collisions (>1 track pour le même newHash)
const collisions = [];
for (const [newHash, group] of groupsByNewHash.entries()) {
  if (group.length > 1) collisions.push({ newHash, tracks: group });
}

if (collisions.length === 0) {
  console.log('✅ AUCUNE COLLISION — migration safe\n');
} else {
  console.log(`⚠️  ${collisions.length} COLLISIONS détectées :\n`);
  collisions.slice(0, 30).forEach((c, i) => {
    console.log(`  ${i + 1}. newHash: "${c.newHash}"`);
    c.tracks.forEach(t => {
      const marker = t.isrc ? '🔑 ISRC' : '🎵 hash';
      console.log(`     ${marker} "${t.title}" — "${t.artist}" (_id=${t._id})`);
    });
    console.log('');
  });
  if (collisions.length > 30) {
    console.log(`... et ${collisions.length - 30} autres collisions non affichées.\n`);
  }

  // Split collisions in 2 categories: with ISRC (safe = ISRC prevails) vs without (dangerous)
  const isrcSafe = collisions.filter(c => c.tracks.every(t => t.isrc));
  const dangerous = collisions.filter(c => !c.tracks.every(t => t.isrc));
  console.log(`📊 Résumé :`);
  console.log(`   ${isrcSafe.length} collisions SAFE (toutes ont ISRC → ISRC prime, pas de conflit hash)`);
  console.log(`   ${dangerous.length} collisions DANGEREUSES (au moins 1 track sans ISRC → utiliserait le hash → duplicate)`);
}

process.exit(0);
