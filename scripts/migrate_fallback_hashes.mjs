// scripts/migrate_fallback_hashes.mjs
// Chantier normalize alignment — Étape finale : migrer les fallbackHash BDD vers le nouveau format
// (sans espaces, aligné iOS DJBrain 2ee54a1).
//
// Prérequis :
//   1. merge_duplicate_tracks.mjs --live doit avoir tourné (46 duplicates éliminés)
//   2. server.js doit être en prod avec le dual-hash lookup (commit après merge)
//
// Usage:
//   node --env-file=.env scripts/migrate_fallback_hashes.mjs         # DRY-RUN
//   node --env-file=.env scripts/migrate_fallback_hashes.mjs --live  # LIVE
//
// Le script :
// 1. Récupère toutes les tracks
// 2. Recalcule le fallbackHash avec le nouveau algo (sans espaces)
// 3. Si le nouveau hash diffère, update le doc
// 4. Vérifie qu'aucune collision unique-index n'est créée
// 5. Update batch de 500 pour éviter timeout Render

import mongoose from 'mongoose';

const DRY_RUN = !process.argv.includes('--live');
const BATCH_SIZE = 500;
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGODB_URI manquant');
  process.exit(1);
}

// New normalize (aligned iOS - no spaces) — MUST match server.js fallbackHashNew
function normalizeNew(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}
function fallbackHashNew(title, artist) {
  return `${normalizeNew(title)}_${normalizeNew(artist)}`;
}

console.log(`\n🔄 Migration fallbackHash BDD → nouveau format (sans espaces)`);
console.log(`Mode : ${DRY_RUN ? '⚠️  DRY-RUN' : '🚀 LIVE'}\n`);

await mongoose.connect(MONGO_URI);
const Track = mongoose.model('Track', new mongoose.Schema({}, { strict: false }));

// ─── 1. Récupérer toutes les tracks ─────────────────────────────────────────
const tracks = await Track.find({}, { title: 1, artist: 1, fallbackHash: 1, isrc: 1 }).lean();
console.log(`📊 ${tracks.length} tracks scannées\n`);

// ─── 2. Identifier les changements nécessaires ──────────────────────────────
const changes = [];
const newHashCounts = new Map();

for (const t of tracks) {
  const newHash = fallbackHashNew(t.title, t.artist);
  if (newHash !== t.fallbackHash) {
    changes.push({ _id: t._id, oldHash: t.fallbackHash, newHash, title: t.title, artist: t.artist, hasIsrc: !!t.isrc });
  }
  newHashCounts.set(newHash, (newHashCounts.get(newHash) || 0) + 1);
}

console.log(`🎯 ${changes.length} tracks à mettre à jour (${((changes.length / tracks.length) * 100).toFixed(1)}%)\n`);

// ─── 3. Détecter collisions post-migration (2 tracks différentes → même newHash) ──
const collisions = Array.from(newHashCounts.entries()).filter(([_, count]) => count > 1);
if (collisions.length > 0) {
  console.log(`⚠️  ${collisions.length} collisions détectées APRÈS migration :`);
  for (const [hash, count] of collisions) {
    const tracksInCollision = tracks.filter(t => fallbackHashNew(t.title, t.artist) === hash);
    console.log(`  "${hash}" — ${count} tracks :`);
    tracksInCollision.forEach(t => console.log(`     "${t.title}" - "${t.artist}" (${t._id}) ${t.isrc ? '🔑' : '🎵'}`));
  }
  console.log(`\n❌ ARRÊT : des collisions doivent être résolues avant la migration (probablement merge_duplicate_tracks.mjs pas encore joué).`);
  process.exit(1);
} else {
  console.log(`✅ Aucune collision post-migration — safe à appliquer\n`);
}

if (DRY_RUN) {
  console.log(`⚠️  DRY-RUN — Preview des 5 premiers changements :`);
  changes.slice(0, 5).forEach((c, i) => {
    console.log(`  ${i + 1}. "${c.title}" - "${c.artist}"`);
    console.log(`     OLD: ${c.oldHash}`);
    console.log(`     NEW: ${c.newHash}`);
  });
  console.log(`\n... et ${Math.max(0, changes.length - 5)} autres tracks.\n`);
  console.log(`Pour appliquer : node --env-file=.env scripts/migrate_fallback_hashes.mjs --live\n`);
  process.exit(0);
}

// ─── 4. LIVE : update batch ─────────────────────────────────────────────────
console.log(`\n🚀 LIVE — Migration de ${changes.length} tracks (batch ${BATCH_SIZE})...\n`);

let updated = 0;
let failed = 0;
const startTime = Date.now();

for (let i = 0; i < changes.length; i += BATCH_SIZE) {
  const batch = changes.slice(i, i + BATCH_SIZE);
  const bulkOps = batch.map(c => ({
    updateOne: {
      filter: { _id: c._id },
      update: { $set: { fallbackHash: c.newHash } }
    }
  }));
  try {
    const result = await Track.bulkWrite(bulkOps, { ordered: false });
    updated += result.modifiedCount;
    const pct = (((i + batch.length) / changes.length) * 100).toFixed(1);
    console.log(`  Batch ${i / BATCH_SIZE + 1}: ${result.modifiedCount}/${batch.length} updated (${pct}%)`);
  } catch (err) {
    console.error(`  ❌ Batch ${i / BATCH_SIZE + 1} error: ${err.message}`);
    failed += batch.length;
  }
}

const duration = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n═══════════════════════════════`);
console.log(`Mode      : LIVE`);
console.log(`✅ Updated : ${updated}`);
console.log(`❌ Failed  : ${failed}`);
console.log(`⏱️  Duration: ${duration}s`);
console.log(`═══════════════════════════════\n`);

process.exit(0);
