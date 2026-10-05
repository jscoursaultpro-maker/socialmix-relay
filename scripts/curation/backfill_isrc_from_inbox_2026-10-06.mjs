// Backfill ISRC sur les tracks AhOuai qui n'en ont pas (06/10/2026).
// Source : les inbox JSON de curation-data contiennent `deezer_verification.match.isrc`
// que l'ancien import_outbox.mjs ne propageait pas vers Track.isrc.
//
// Doctrine :
// - Jamais d'écrasement d'un ISRC existant (append-only sur champ null/empty).
// - Jamais de touche à Track isVerified=true (platine) sans FORCE_VERIFIED=1.
// - Jamais de touche à data comportementale (votes, performance, HPH).
// - Backup MigrationBackup_IsrcBackfill avant chaque write.
// - Dry-run par défaut si DRY_RUN=1.
//
// Usage (via GitHub Actions ou local avec .env MONGODB_URI) :
//   DRY_RUN=1 node scripts/curation/backfill_isrc_from_inbox_2026-10-06.mjs
//   node scripts/curation/backfill_isrc_from_inbox_2026-10-06.mjs

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectMongo, readJson } from './lib.mjs';

const DRY = process.env.DRY_RUN === '1';
const FORCE_VERIFIED = process.env.FORCE_VERIFIED === '1';
const DATA_DIR = path.resolve(process.env.CURATION_DATA_DIR || './curation-data');
const INBOX_DIR = path.join(DATA_DIR, 'inbox');

if (!fs.existsSync(INBOX_DIR)) {
  console.error(`❌ Inbox dir not found: ${INBOX_DIR}`);
  console.error(`   Lance avec --data-dir ou CURATION_DATA_DIR vers un clone de la branche curation-data.`);
  process.exit(1);
}

// 1. Lire tous les inbox JSON, construire map {_id: isrc}
console.log('📦 Scanning inbox files…');
const isrcByTrackId = new Map();
const inboxFiles = fs.readdirSync(INBOX_DIR).filter(f => f.endsWith('.json')).sort();
let totalInboxTracks = 0;
let totalIsrcFound = 0;

for (const f of inboxFiles) {
  const data = readJson(path.join(INBOX_DIR, f));
  if (!data?.tracks) continue;
  for (const t of data.tracks) {
    totalInboxTracks++;
    const isrc = t?.deezer_verification?.match?.isrc;
    if (isrc && typeof isrc === 'string' && isrc.length >= 10) {
      // Si plusieurs inboxes ont le même track, on garde la 1ère (données équivalentes a priori)
      if (!isrcByTrackId.has(t._id)) {
        isrcByTrackId.set(t._id, isrc.toUpperCase());
        totalIsrcFound++;
      }
    }
  }
}

console.log(`✓ ${inboxFiles.length} inbox files scanned, ${totalInboxTracks} track entries, ${totalIsrcFound} ISRC résolus.`);

// 2. Connect MongoDB
const db = await connectMongo();
const tracks = db.collection('tracks');
const backup = db.collection('MigrationBackup_IsrcBackfill');

// 3. Build filter : tracks sans ISRC dont _id est dans notre map
const candidateIds = Array.from(isrcByTrackId.keys()).map(id => new mongoose.Types.ObjectId(id));
console.log(`🔎 ${candidateIds.length} ObjectId candidats`);

const query = {
  _id: { $in: candidateIds },
  $or: [{ isrc: null }, { isrc: '' }, { isrc: { $exists: false } }],
};
if (!FORCE_VERIFIED) query.isVerified = { $ne: true };

const toFix = await tracks.find(query, { projection: { _id: 1, title: 1, artist: 1, isrc: 1, isVerified: 1, qualityLevel: 1 } }).toArray();
console.log(`→ ${toFix.length} tracks BDD à backfill (sans ISRC, non platine${FORCE_VERIFIED ? ' incl. platine' : ''}).`);

if (toFix.length === 0) {
  console.log('✓ Rien à faire. Fin.');
  await mongoose.disconnect();
  process.exit(0);
}

// 4. Apply updates (backup first)
let applied = 0;
let skipped = 0;
const errors = [];

for (const t of toFix) {
  const idStr = t._id.toString();
  const isrc = isrcByTrackId.get(idStr);
  if (!isrc) { skipped++; continue; }

  if (DRY) {
    console.log(`  [DRY] ${t.artist} — ${t.title}  →  isrc=${isrc}  (quality=${t.qualityLevel})`);
    applied++;
    continue;
  }

  try {
    await backup.insertOne({
      _snapshotAt: new Date(),
      _hotfix: 'backfill_isrc_from_inbox_2026-10-06',
      _originalId: t._id,
      doc: { _id: t._id, title: t.title, artist: t.artist, isrc_before: t.isrc ?? null, qualityLevel: t.qualityLevel },
    });
    const r = await tracks.updateOne({ _id: t._id }, { $set: { isrc } });
    if (r.modifiedCount === 1) {
      applied++;
      if (applied % 20 === 0) console.log(`  … ${applied}/${toFix.length} backfilled`);
    } else {
      skipped++;
    }
  } catch (err) {
    errors.push({ id: idStr, title: t.title, error: err.message });
  }
}

console.log(`\n✓ Done. Applied: ${applied}  Skipped: ${skipped}  Errors: ${errors.length}`);
if (errors.length) {
  console.log('Errors sample:', errors.slice(0, 5));
}

await mongoose.disconnect();
