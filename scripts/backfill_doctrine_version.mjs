#!/usr/bin/env node
/**
 * Backfill doctrineVersion + classifiedAt for existing classified tracks.
 *
 * Usage:
 *   DRY_RUN=1 node scripts/backfill_doctrine_version.mjs   # preview only
 *   node scripts/backfill_doctrine_version.mjs              # execute
 *
 * Logic:
 *   - classifiedBy starts with "claude_batch" → doctrineVersion = "v1_legacy"
 *   - classifiedBy is any other non-null value → doctrineVersion = "v0_manual"
 *   - classifiedBy is null → skip (not classified yet)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === '1';

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGODB_URI not set in .env');
  process.exit(1);
}

await mongoose.connect(MONGO_URI);
console.log(`✅ Connected to MongoDB${DRY_RUN ? ' (DRY RUN)' : ''}`);

const Track = mongoose.connection.collection('tracks');

// 1. Claude batch classified → v1_legacy
const claudeBatch = await Track.find({
  classifiedBy: { $regex: /^claude_batch/ },
  doctrineVersion: null
}).toArray();

console.log(`\n📋 Claude batch classified (→ v1_legacy): ${claudeBatch.length} tracks`);
if (!DRY_RUN && claudeBatch.length > 0) {
  const ids = claudeBatch.map(t => t._id);
  const result = await Track.updateMany(
    { _id: { $in: ids } },
    { $set: { doctrineVersion: 'v1_legacy', classifiedAt: '$updatedAt' } }
  );
  // classifiedAt = updatedAt doesn't work with $set, use bulkWrite instead
  const ops = claudeBatch.map(t => ({
    updateOne: {
      filter: { _id: t._id },
      update: { $set: { doctrineVersion: 'v1_legacy', classifiedAt: t.updatedAt || new Date() } }
    }
  }));
  await Track.bulkWrite(ops);
  console.log(`  ✅ Updated ${ops.length} tracks`);
} else if (DRY_RUN) {
  claudeBatch.slice(0, 5).forEach(t => {
    console.log(`  [DRY] ${t.title} — ${t.artist} (classifiedBy: ${t.classifiedBy})`);
  });
}

// 2. Other classified (manual, gpt, etc.) → v0_manual
const otherClassified = await Track.find({
  classifiedBy: { $ne: null, $not: { $regex: /^claude_batch/ } },
  doctrineVersion: null
}).toArray();

console.log(`\n📋 Other classified (→ v0_manual): ${otherClassified.length} tracks`);
if (!DRY_RUN && otherClassified.length > 0) {
  const ops = otherClassified.map(t => ({
    updateOne: {
      filter: { _id: t._id },
      update: { $set: { doctrineVersion: 'v0_manual', classifiedAt: t.updatedAt || new Date() } }
    }
  }));
  await Track.bulkWrite(ops);
  console.log(`  ✅ Updated ${ops.length} tracks`);
} else if (DRY_RUN) {
  otherClassified.slice(0, 5).forEach(t => {
    console.log(`  [DRY] ${t.title} — ${t.artist} (classifiedBy: ${t.classifiedBy})`);
  });
}

// 3. Summary
const summary = await Track.aggregate([
  { $group: { _id: '$doctrineVersion', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).toArray();

console.log('\n📊 doctrineVersion distribution:');
summary.forEach(s => console.log(`  ${s._id || 'null'}: ${s.count}`));

await mongoose.disconnect();
console.log('\n✅ Done.');
