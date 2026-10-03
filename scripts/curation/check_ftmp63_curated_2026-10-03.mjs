// scripts/curation/check_ftmp63_curated_2026-10-03.mjs
// Read-only : la soirée FTMP63 d'hier (02/10) a-t-elle joué des tracks curatées hier ?
// Critère "curatée hier" : classifiedBy ~ /^claude_batch_auto_v3_/ ET lastReviewedAt dans la journée 02/10 UTC.

import fs from 'fs';
import mongoose from 'mongoose';
import { connectMongo } from './lib.mjs';

const PARTY_CODE = 'FTMP63';
const DAY_START = new Date('2026-10-02T00:00:00Z');
const DAY_END = new Date('2026-10-03T00:00:00Z');

const db = await connectMongo();
const parties = db.collection('parties');
const tracks = db.collection('tracks');
const hphs = db.collection('hostplaybackhistories');

// 1) Trouver la party
const party = await parties.findOne({ code: PARTY_CODE });
const lines = [];
lines.push(`================ FTMP63 × CURATION 02/10 — RAPPORT ================`);
lines.push(`Date (UTC)                : ${new Date().toISOString()}`);
if (!party) {
  lines.push(`❌ Party ${PARTY_CODE} introuvable`);
  const out = lines.join('\n') + '\n';
  console.log(out);
  if (process.env.COUNT_OUT) fs.writeFileSync(process.env.COUNT_OUT, out, 'utf8');
  await mongoose.disconnect();
  process.exit(0);
}
lines.push(`Party ${PARTY_CODE}`);
lines.push(`  id        : ${party._id}`);
lines.push(`  createdAt : ${party.createdAt?.toISOString() || '?'}`);
lines.push(`  endedAt   : ${party.endedAt?.toISOString() || '(not ended)'}`);
lines.push(`  isDemo    : ${party.isDemoParty || false}`);
lines.push(`  status    : ${party.lifecycle?.status || '?'}`);

// 2) Lister HPH entries pour cette party
const list = await hphs.find({ partyId: party._id }).sort({ playedAt: 1 }).toArray();
lines.push('--------------------------------------------------------------');
lines.push(`Playback history total    : ${list.length}`);

if (list.length === 0) {
  lines.push('(aucune track jouée)');
  const out = lines.join('\n') + '\n';
  console.log(out);
  if (process.env.COUNT_OUT) fs.writeFileSync(process.env.COUNT_OUT, out, 'utf8');
  await mongoose.disconnect();
  process.exit(0);
}

// 3) Résoudre et croiser avec Track.lastReviewedAt + classifiedBy
const curated = [];
const other = [];
for (const h of list) {
  if (!h.trackId) { other.push({ h, t: null, status: 'no_trackid' }); continue; }
  const t = await tracks.findOne(
    { _id: new mongoose.Types.ObjectId(h.trackId) },
    { projection: { classifiedBy: 1, lastReviewedAt: 1, artist: 1, title: 1, phase: 1, bpm: 1, qualityLevel: 1 } }
  );
  if (!t) { other.push({ h, t: null, status: 'track_not_found' }); continue; }
  const isCurated =
    typeof t.classifiedBy === 'string' &&
    t.classifiedBy.startsWith('claude_batch_auto_v3_') &&
    t.lastReviewedAt &&
    new Date(t.lastReviewedAt) >= DAY_START &&
    new Date(t.lastReviewedAt) < DAY_END;
  if (isCurated) curated.push({ h, t });
  else other.push({ h, t, status: 'not_curated_yesterday' });
}

lines.push(`  dont curatées hier 02/10: ${curated.length}  ← réponse Jean-Sé`);
lines.push(`  autres                  : ${other.length}`);
lines.push('--------------------------------------------------------------');

if (curated.length > 0) {
  lines.push('');
  lines.push('✅ TRACKS CURATÉES HIER 02/10 ET JOUÉES DANS FTMP63 :');
  for (const { h, t } of curated) {
    const hhmm = new Date(h.playedAt).toISOString().slice(11, 19);
    lines.push(`  ✅ ${hhmm} UTC | phase=${h.phase || '-'} | ${t.artist} — ${t.title}`);
    lines.push(`      → classifiedBy=${t.classifiedBy} | phase=${t.phase} | bpm=${t.bpm}`);
    const v = h.voteScore || {};
    const flags = [];
    if (v.feu) flags.push(`🔥${v.feu}`);
    if (v.cool) flags.push(`👍${v.cool}`);
    if (v.bof) flags.push(`👎${v.bof}`);
    if (h.wasSuggestedByGuest) flags.push('suggérée-guest');
    if (h.wasHostOverride) flags.push('host-override');
    if (flags.length) lines.push(`      → ${flags.join(' | ')}`);
  }
}

lines.push('');
lines.push('AUTRES TRACKS JOUÉES :');
for (const { h, t, status } of other) {
  const hhmm = new Date(h.playedAt).toISOString().slice(11, 19);
  if (t) {
    const cls = t.classifiedBy || 'none';
    const rev = t.lastReviewedAt ? new Date(t.lastReviewedAt).toISOString().slice(0, 10) : 'never';
    lines.push(`  · ${hhmm} UTC | ${t.artist} — ${t.title} | ql=${t.qualityLevel || '?'} by=${cls.slice(0, 25)} rev=${rev}`);
  } else {
    lines.push(`  · ${hhmm} UTC | ${h.artist || '?'} — ${h.title || '?'} | [${status}] dz=${h.deezerTrackId || '-'}`);
  }
}
lines.push('==============================================================');

const out = lines.join('\n') + '\n';
console.log('\n' + out);
if (process.env.COUNT_OUT) {
  const dir = process.env.COUNT_OUT.replace(/\/[^\/]+$/, '');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(process.env.COUNT_OUT, out, 'utf8');
}

await mongoose.disconnect();
