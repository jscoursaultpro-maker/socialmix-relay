#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// backfill_missing_hph.mjs — Backfill missing HostPlaybackHistory entries
// ═══════════════════════════════════════════════════════════════════
// Root cause: party.hostUserId was NOT restored on reconnect (server.js L3689),
// causing the `if (party.hostUserId)` guard (L4004) to skip HPH creation for
// ALL tracks after any disconnect/reconnect event.
//
// Usage:
//   node scripts/backfill_missing_hph.mjs --dry-run           # Preview only
//   node scripts/backfill_missing_hph.mjs                     # Execute backfill
//   node scripts/backfill_missing_hph.mjs --party ZYAQDE      # Single party
//   node scripts/backfill_missing_hph.mjs --dry-run --party ZYAQDE
// ═══════════════════════════════════════════════════════════════════

import mongoose from 'mongoose';
import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

// ─── CLI args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const partyFlag = args.indexOf('--party');
const TARGET_PARTY = partyFlag >= 0 ? args[partyFlag + 1] : null;

console.log(`\n╔═══════════════════════════════════════════════════════╗`);
console.log(`║  HPH Backfill Script                                  ║`);
console.log(`║  Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : '🔴 LIVE (writing to DB)'}${DRY_RUN ? '        ' : '    '}║`);
if (TARGET_PARTY) console.log(`║  Target: ${TARGET_PARTY.padEnd(44)}║`);
console.log(`╚═══════════════════════════════════════════════════════╝\n`);

// ─── MongoDB connection ──────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not set. Run with: node --env-file=.env scripts/backfill_missing_hph.mjs');
  process.exit(1);
}

await mongoose.connect(MONGODB_URI);
const db = mongoose.connection.db;
console.log('✅ Connected to MongoDB\n');

// ─── Collections ─────────────────────────────────────────────────
const partiesCol = db.collection('parties');
const hphCol = db.collection('hostplaybackhistories');
const tracksCol = db.collection('tracks');

// ─── Query parties ───────────────────────────────────────────────
const partyFilter = { 'trackHistory.0': { $exists: true } };
if (TARGET_PARTY) partyFilter.code = TARGET_PARTY;

const parties = await partiesCol.find(partyFilter, {
  projection: { code: 1, _id: 1, hostUserId: 1, createdAt: 1, trackHistory: 1 },
  allowDiskUse: true
}).limit(TARGET_PARTY ? 1 : 100).toArray();

console.log(`📋 Found ${parties.length} parties with trackHistory\n`);

// ─── Stats ───────────────────────────────────────────────────────
let totalBackfilled = 0;
let totalSkipped = 0;
let totalDuplicate = 0;
const perParty = [];

for (const party of parties) {
  const ramTracks = party.trackHistory || [];
  if (ramTracks.length === 0) continue;

  // Get existing HPH for this party (by partyCode OR partyId)
  const existingHph = await hphCol.find({
    $or: [{ partyCode: party.code }, { partyId: party._id }]
  }, { projection: { title: 1, playedAt: 1, deezerTrackId: 1 } }).toArray();

  // Build dedup set: lowercase title + playedAt timestamp (if available)
  const existingKeys = new Set();
  for (const h of existingHph) {
    const key = `${(h.title || '').toLowerCase().trim()}`;
    existingKeys.add(key);
    // Also add with deezerTrackId for extra safety
    if (h.deezerTrackId) existingKeys.add(`deezer:${h.deezerTrackId}`);
  }

  const missing = [];
  for (const track of ramTracks) {
    const titleKey = `${(track.title || '').toLowerCase().trim()}`;
    const deezerId = track.deezerID || track.deezerId || track.trackId;
    const deezerKey = deezerId ? `deezer:${deezerId}` : null;

    // Skip if already exists (by title OR deezerID)
    if (existingKeys.has(titleKey) || (deezerKey && existingKeys.has(deezerKey))) {
      totalDuplicate++;
      continue;
    }

    // Mark as "will create" to avoid self-duplicates within same party
    existingKeys.add(titleKey);
    if (deezerKey) existingKeys.add(deezerKey);

    missing.push(track);
  }

  if (missing.length === 0) continue;

  const partyStats = { code: party.code, ram: ramTracks.length, hph: existingHph.length, gap: missing.length, tracks: [] };

  for (const track of missing) {
    const deezerId = track.deezerID || track.deezerId || track.trackId;

    // Resolve trackId from Track collection
    let resolvedTrack = null;
    if (deezerId) {
      resolvedTrack = await tracksCol.findOne(
        { 'providers.deezer.trackId': Number(deezerId) },
        { projection: { _id: 1 } }
      );
    }
    if (!resolvedTrack && track.title) {
      const esc = s => (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const titleRegex = new RegExp('^' + esc(track.title.trim()) + '$', 'i');
      const artistFirst = (track.artist || '').split(/[,&]/)[0].trim();
      const artistRegex = artistFirst ? new RegExp(esc(artistFirst), 'i') : null;
      const fallbackQ = { title: titleRegex };
      if (artistRegex) fallbackQ.artist = artistRegex;
      resolvedTrack = await tracksCol.findOne(fallbackQ, { projection: { _id: 1 } });
    }

    const hphDoc = {
      hostUserId: party.hostUserId || null,
      trackId: resolvedTrack?._id || null,
      partyId: party._id,
      partyCode: party.code,
      deezerTrackId: deezerId ? Number(deezerId) : null,
      title: track.title || null,
      artist: track.artist || null,
      playedAt: track.playedAt ? new Date(track.playedAt) : party.createdAt || new Date(),
      phase: track.phase || 'unknown',
      wasSuggestedByGuest: !!(track.suggestedBy || track.requestedBy?.source === 'suggestion'),
      _backfilled: true  // marker for audit
    };

    partyStats.tracks.push({
      title: track.title,
      artist: track.artist,
      trackResolved: !!resolvedTrack,
      playedAt: hphDoc.playedAt
    });

    if (!DRY_RUN) {
      try {
        await hphCol.insertOne(hphDoc);
        totalBackfilled++;
      } catch (e) {
        if (e.code === 11000) {
          totalDuplicate++;
          console.log(`  ⏭️  Duplicate (11000): "${track.title}"`);
        } else {
          console.error(`  ❌ Insert failed: "${track.title}": ${e.message}`);
        }
      }
    } else {
      totalBackfilled++;
    }
  }

  perParty.push(partyStats);
  const resolvedCount = partyStats.tracks.filter(t => t.trackResolved).length;
  console.log(`${DRY_RUN ? '🔍' : '✅'} ${party.code}: ${missing.length} HPH ${DRY_RUN ? 'would be' : ''} backfilled (${resolvedCount}/${missing.length} trackId resolved) — RAM=${ramTracks.length} HPH=${existingHph.length}`);
}

// ─── Report ──────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(65)}`);
console.log(`📊 REPORT — ${DRY_RUN ? 'DRY RUN' : 'LIVE EXECUTION'}`);
console.log(`${'═'.repeat(65)}`);
console.log(`  Parties scanned:     ${parties.length}`);
console.log(`  Parties with gaps:   ${perParty.length}`);
console.log(`  Total backfilled:    ${totalBackfilled}`);
console.log(`  Total duplicates:    ${totalDuplicate}`);
console.log(`  Total skipped:       ${totalSkipped}`);
console.log(`${'═'.repeat(65)}`);

if (perParty.length > 0) {
  console.log(`\n${'Code'.padEnd(10)} ${'RAM'.padStart(5)} ${'HPH'.padStart(5)} ${'Gap'.padStart(5)} ${'Resolved'.padStart(10)}`);
  console.log(`${'-'.repeat(40)}`);
  for (const p of perParty) {
    const resolved = p.tracks.filter(t => t.trackResolved).length;
    console.log(`${p.code.padEnd(10)} ${String(p.ram).padStart(5)} ${String(p.hph).padStart(5)} ${String(p.gap).padStart(5)} ${`${resolved}/${p.gap}`.padStart(10)}`);
  }
}

if (DRY_RUN) {
  console.log(`\n⚠️  This was a DRY RUN. No data was written.`);
  console.log(`    Run without --dry-run to execute the backfill.\n`);
}

await mongoose.disconnect();
