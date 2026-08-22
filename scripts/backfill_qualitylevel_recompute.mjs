#!/usr/bin/env node
/**
 * Backfill qualityLevel recompute — fixes tracks stuck at 'vide' or 'partielle'
 * when their curatorial fields were already filled (pre-FIX1 Chantier 1).
 *
 * Usage:
 *   DRY_RUN=1 node scripts/backfill_qualitylevel_recompute.mjs   # preview
 *   node scripts/backfill_qualitylevel_recompute.mjs              # execute
 */

import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeQualityLevel } from '../models/Track.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DRY_RUN = process.env.DRY_RUN === '1';

const envPath = path.join(__dirname, '..', '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.match(/^[A-Z]/) && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.substring(0, i).trim(), l.substring(i+1).replace(/^"|"$/g, '').trim()]; })
);

const MONGO_URI = process.env.MONGO_URI || env.MONGO_URI || env.MONGODB_URI;
if (!MONGO_URI) { console.error('❌ MONGODB_URI not set'); process.exit(1); }

await mongoose.connect(MONGO_URI);
console.log(`✅ Connected to MongoDB${DRY_RUN ? ' (DRY RUN)' : ''}`);

const Track = mongoose.connection.collection('tracks');

// ── Before snapshot ──
const before = await Track.aggregate([
  { $group: { _id: '$qualityLevel', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).toArray();
console.log('\n📊 BEFORE — qualityLevel distribution:');
before.forEach(s => console.log(`  ${s._id || 'null'}: ${s.count}`));

// ── Find candidates (vide + partielle) ──
const candidates = await Track.find({
  $or: [
    { qualityLevel: 'vide' },
    { qualityLevel: 'partielle' },
    { qualityLevel: null },
    { qualityLevel: { $exists: false } }
  ]
}).toArray();

console.log(`\n🔍 Candidates to recompute: ${candidates.length}`);

// ── Compute corrections ──
const corrections = { 'vide→partielle': [], 'vide→complete': [], 'vide→platine': [],
                      'partielle→complete': [], 'partielle→platine': [],
                      'null→partielle': [], 'null→complete': [], 'unchanged': [] };

const ops = [];
for (const t of candidates) {
  const oldQL = t.qualityLevel || 'null';
  const newQL = computeQualityLevel(t);

  if (newQL !== (t.qualityLevel || 'vide')) {
    const key = `${oldQL}→${newQL}`;
    if (corrections[key]) corrections[key].push(t);
    else corrections[key] = [t];

    ops.push({
      updateOne: {
        filter: { _id: t._id },
        update: { $set: { qualityLevel: newQL } }
      }
    });
  } else {
    corrections['unchanged'].push(t);
  }
}

// ── Report ──
console.log(`\n📋 Corrections breakdown:`);
for (const [key, arr] of Object.entries(corrections)) {
  if (arr.length > 0 && key !== 'unchanged') {
    console.log(`  ${key}: ${arr.length}`);
  }
}
console.log(`  unchanged: ${corrections.unchanged.length}`);
console.log(`  TOTAL to update: ${ops.length}`);

// ── Samples ──
for (const [key, arr] of Object.entries(corrections)) {
  if (arr.length > 0 && key !== 'unchanged') {
    console.log(`\n── Sample ${key} (max 5) ──`);
    arr.slice(0, 5).forEach(t => {
      console.log(`  "${t.title}" — ${t.artist} | bpm=${t.bpm||0} | energy=${t.energy||0} | phase=${t.phase||'null'} | genre=${t.genre||'null'} | classifiedBy=${t.classifiedBy||'NULL'}`);
    });
  }
}

// ── Execute or skip ──
if (!DRY_RUN && ops.length > 0) {
  await Track.bulkWrite(ops);
  console.log(`\n✅ Updated ${ops.length} tracks`);

  // After snapshot
  const after = await Track.aggregate([
    { $group: { _id: '$qualityLevel', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  console.log('\n📊 AFTER — qualityLevel distribution:');
  after.forEach(s => console.log(`  ${s._id || 'null'}: ${s.count}`));
} else if (DRY_RUN) {
  console.log('\n⏸️  DRY RUN — no changes made. Run without DRY_RUN=1 to execute.');
}

await mongoose.disconnect();
console.log('\n✅ Done.');
