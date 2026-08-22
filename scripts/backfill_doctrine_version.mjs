#!/usr/bin/env node
/**
 * Backfill doctrineVersion for existing classified tracks.
 *
 * Usage:
 *   DRY_RUN=1 node scripts/backfill_doctrine_version.mjs   # preview only
 *   node scripts/backfill_doctrine_version.mjs              # execute
 *
 * Logic (unified):
 *   - qualityLevel === 'complete' OR 'platine' → doctrineVersion = "v1_legacy"
 *   - Everything else (vide, partielle, null)  → doctrineVersion stays null
 *
 * Justification: classifiedBy was not filled by all historic paths (seed,
 * resolve_editorial, import_fantomes). The real signal is qualityLevel,
 * computed from the presence of curatorial fields.
 */

import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']); // Fix SRV resolution on local networks
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRY_RUN = process.env.DRY_RUN === '1';

// Load .env from relay-server root (same pattern as import_batches_out.mjs)
const envPath = path.join(__dirname, '..', '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.match(/^[A-Z]/) && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.substring(0, i).trim(), l.substring(i+1).replace(/^"|"$/g, '').trim()]; })
);

const MONGO_URI = process.env.MONGO_URI || env.MONGO_URI || env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('❌ MONGODB_URI not set in .env');
  process.exit(1);
}

await mongoose.connect(MONGO_URI);
console.log(`✅ Connected to MongoDB${DRY_RUN ? ' (DRY RUN)' : ''}`);

const Track = mongoose.connection.collection('tracks');

// ── Classified tracks: qualityLevel in ['complete', 'platine'] → v1_legacy ──
const classified = await Track.find({
  qualityLevel: { $in: ['complete', 'platine'] },
  $or: [{ doctrineVersion: null }, { doctrineVersion: { $exists: false } }]
}).toArray();

// ── Unchanged: everything else ──
const unchanged = await Track.countDocuments({
  $or: [
    { qualityLevel: { $nin: ['complete', 'platine'] } },
    { qualityLevel: { $exists: false } },
    { qualityLevel: null }
  ]
});

console.log(`\n📋 Classified (qualityLevel complete|platine → v1_legacy): ${classified.length} tracks`);
console.log(`📋 Unchanged (vide|partielle|null → stays null): ${unchanged} tracks`);

if (DRY_RUN) {
  // Sample: 5 general
  console.log(`\n── Sample v1_legacy (5 tracks) ──`);
  classified.slice(0, 5).forEach(t => {
    console.log(`  [DRY] "${t.title}" — ${t.artist} | ql=${t.qualityLevel} | classifiedBy=${t.classifiedBy || 'NULL'}`);
  });

  // Bonus: 5 tracks that become v1_legacy WITHOUT classifiedBy set
  // (the ones the old logic would have missed)
  const noClassifiedBy = classified.filter(t => !t.classifiedBy);
  console.log(`\n── BONUS: tracks v1_legacy SANS classifiedBy (${noClassifiedBy.length} total, showing 5) ──`);
  noClassifiedBy.slice(0, 5).forEach(t => {
    console.log(`  [RESCUED] "${t.title}" — ${t.artist} | ql=${t.qualityLevel} | classifiedBy=NULL | source=${t.source || '?'}`);
  });
} else if (classified.length > 0) {
  const ops = classified.map(t => ({
    updateOne: {
      filter: { _id: t._id },
      update: { $set: {
        doctrineVersion: 'v1_legacy',
        classifiedAt: t.updatedAt || new Date()
      } }
    }
  }));
  await Track.bulkWrite(ops);
  console.log(`  ✅ Updated ${ops.length} tracks → v1_legacy`);
}

// ── Summary ──
const summary = await Track.aggregate([
  { $group: { _id: '$doctrineVersion', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).toArray();

console.log('\n📊 doctrineVersion distribution (current state):');
summary.forEach(s => console.log(`  ${s._id || 'null'}: ${s.count}`));

const totalTracks = await Track.countDocuments();
console.log(`\n📊 Total tracks in collection: ${totalTracks}`);

await mongoose.disconnect();
console.log('\n✅ Done.');
