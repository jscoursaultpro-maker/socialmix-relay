#!/usr/bin/env node
/**
 * audit-admin-qualified-covers.js
 * Bug 9 Fix B — Audit + block covers in MongoDB
 *
 * Usage:
 *   node --env-file=.env scripts/audit-admin-qualified-covers.js --dry-run
 *   node --env-file=.env scripts/audit-admin-qualified-covers.js --apply
 *
 * What it does:
 *   1. Scans all tracks where adminQualified=true
 *   2. Identifies tracks with known cover-artist patterns
 *   3. Verifies that an original (non-cover) version exists in the DB
 *   4. In --apply mode: sets isBlocked=true on those tracks
 */

import mongoose from 'mongoose';
import { connectDB } from '../db.js';

const isDryRun = !process.argv.includes('--apply');

// ── Cover artist patterns (lowercase) ────────────────────────────────────────
const COVER_ARTIST_PATTERNS = [
  'emily dawn', 'sandy beach', 'glimmer of blooms', 'glimmer of bloom',
  'sunset chasers', 'coral reef', 'alex grey', 'bikini bandits',
  'tribute', 'karaoke', 'remake', 'playback', 'orchestra',
  'sounds like', 'masters', 'covered by'
];

// ── Title normalization ──────────────────────────────────────────────────────
function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/\s*\(feat\..*?\)/gi, '')
    .replace(/\s*\[.*?\]/gi, '')
    .replace(/\s*-\s*(remix|radio edit|extended mix|remaster.*|club mix)$/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function isCoverArtist(artist) {
  const lower = (artist || '').toLowerCase();
  return COVER_ARTIST_PATTERNS.some(p => lower.includes(p));
}

// ── Main ─────────────────────────────────────────────────────────────────────
await connectDB();
const db = mongoose.connection.db;

console.log(`\n${'='.repeat(60)}`);
console.log(`BUG 9 — Audit AdminQualified Covers`);
console.log(`Mode: ${isDryRun ? '🔍 DRY-RUN (no changes)' : '⚠️  APPLY (will update MongoDB)'}`);
console.log('='.repeat(60));

// 1. Load all adminQualified tracks (no photo projection to stay light)
const allQualified = await db.collection('tracks').find(
  { adminQualified: true },
  { projection: { title: 1, artist: 1, deezerRank: 1, isBlocked: 1,
                  phaseAlternate: 1, phase: 1, genre: 1, _id: 1, fallbackHash: 1 } }
).toArray();

console.log(`\nTotal adminQualified tracks: ${allQualified.length}`);

// 2. Identify suspects
const suspects = allQualified.filter(t => isCoverArtist(t.artist));
console.log(`Suspected cover artists: ${suspects.length}`);
console.log(`Cover artists found: ${[...new Set(suspects.map(t => t.artist))].join(', ')}`);

// 3. Match each suspect against an original in the pool
const toBlock = [];
const alreadyBlocked = [];

for (const suspect of suspects) {
  if (suspect.isBlocked === true) {
    alreadyBlocked.push(suspect);
    continue;
  }
  const normTitle = normalizeTitle(suspect.title);
  const originalInBDD = allQualified.find(other => {
    if (String(other._id) === String(suspect._id)) return false;
    if (isCoverArtist(other.artist)) return false; // another cover
    return normalizeTitle(other.title) === normTitle;
  });

  if (originalInBDD) {
    toBlock.push({ suspect, original: originalInBDD });
  }
}

console.log(`\nAlready blocked (skipped): ${alreadyBlocked.length}`);
console.log(`New covers to block: ${toBlock.length}`);

// 4. Report
console.log(`\n${'─'.repeat(60)}`);
console.log('COVERS TO BLOCK:');
console.log('─'.repeat(60));
toBlock.forEach((item, i) => {
  const s = item.suspect;
  const o = item.original;
  console.log(`\n[${i+1}] 🚫 COVER: "${s.title}" — ${s.artist}`);
  console.log(`     phase: ${s.phase || s.phaseAlternate || '?'} | rank: ${s.deezerRank || 0}`);
  console.log(`     ✅ ORIGINAL: "${o.title}" — ${o.artist} (rank: ${o.deezerRank || 0})`);
});

// Tests TB9.2 and TB9.3
console.log(`\n${'─'.repeat(60)}`);
console.log('VALIDATION TESTS:');
const emilyDawnBlindingLights = toBlock.find(
  i => i.suspect.artist.toLowerCase().includes('emily dawn') &&
       i.suspect.title.toLowerCase().includes('blinding lights')
);
console.log(`TB9.2 Emily Dawn "Blinding Lights" → ${emilyDawnBlindingLights ? '✅ DETECTED as cover' : '❌ NOT detected'}`);

const acdc = allQualified.find(t =>
  t.artist.toLowerCase().includes('ac') && t.title.toLowerCase().includes('back in black')
);
const acdcWouldBeBlocked = toBlock.find(i => String(i.suspect._id) === String(acdc?._id));
console.log(`TB9.3 AC/DC "Back In Black" → ${acdc && !acdcWouldBeBlocked ? '✅ NOT blocked (original)' : acdc ? '❌ WRONGLY blocked' : 'ℹ️ Not in DB'}`);

// 5. Apply if requested
if (!isDryRun && toBlock.length > 0) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('APPLYING CHANGES to MongoDB...');
  const ids = toBlock.map(i => i.suspect._id);
  const result = await db.collection('tracks').updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        isBlocked: true,
        blockedReason: 'cover_with_original_in_db',
        blockedAt: new Date().toISOString(),
        blockedBy: 'audit-admin-qualified-covers.js'
      }
    }
  );
  console.log(`✅ Updated: ${result.modifiedCount} tracks set to isBlocked=true`);

  // TB9.5 — Verify in DB
  const verifyCount = await db.collection('tracks').countDocuments({
    _id: { $in: ids },
    isBlocked: true
  });
  console.log(`TB9.5 Verification: ${verifyCount}/${ids.length} tracks confirmed isBlocked=true in MongoDB`);
  console.log(verifyCount === ids.length ? '✅ TB9.5 PASS' : '❌ TB9.5 FAIL');
} else if (!isDryRun && toBlock.length === 0) {
  console.log('\n✅ Nothing to update — all covers already blocked.');
} else {
  console.log('\n🔍 Dry-run complete — no changes made. Run with --apply to update MongoDB.');
}

console.log(`\n${'='.repeat(60)}\n`);
process.exit(0);
