// scripts/curation/check_ftmp63_curated_2026-10-03.mjs
// Read-only : la soirée FTMP63 d'hier (02/10) a-t-elle joué des tracks curatées par le travail de la veille ?
//
// Critères "track curatée hier" (02/10/2026) :
//   - classifiedBy commence par 'claude_batch_auto_v3_'
//   - lastReviewedAt entre 2026-10-02 00:00:00 UTC et 2026-10-02 23:59:59 UTC
//
// Résultat : liste de toutes les tracks jouées dans FTMP63 et flag "curatée hier".

import fs from 'fs';
import mongoose from 'mongoose';
import { connectMongo } from './lib.mjs';
import HostPlaybackHistory from '../../models/HostPlaybackHistory.js';
import Track from '../../models/Track.js';
import Party from '../../models/Party.js';

const PARTY_CODE = 'FTMP63';
const DAY_START = new Date('2026-10-02T00:00:00Z');
const DAY_END = new Date('2026-10-03T00:00:00Z');

const db = await connectMongo();

// 1) Trouver la party
const party = await Party.findOne({ code: PARTY_CODE });
if (!party) {
  console.log(`❌ Party ${PARTY_CODE} introuvable`);
  await mongoose.disconnect();
  process.exit(0);
}
console.log(`\n=== PARTY ${PARTY_CODE} ===`);
console.log(`id        : ${party._id}`);
console.log(`createdAt : ${party.createdAt?.toISOString() || '?'}`);
console.log(`endedAt   : ${party.endedAt?.toISOString() || '(not ended)'}`);
console.log(`host      : ${party.hostUserId || '?'}`);
console.log(`isDemo    : ${party.isDemoParty}`);
console.log(`status    : ${party.lifecycle?.status || '?'}`);

// 2) Lister toutes les HPH entries pour cette party
const hphs = await HostPlaybackHistory.find({ partyId: party._id }).sort({ playedAt: 1 });
console.log(`\n=== PLAYBACK HISTORY (${hphs.length} tracks jouées) ===`);

if (hphs.length === 0) {
  console.log('(aucune track jouée)');
  await mongoose.disconnect();
  process.exit(0);
}

// 3) Résoudre chaque trackId vers Track et vérifier critères "curatée hier"
const curatedYday = [];
const other = [];

for (const h of hphs) {
  if (!h.trackId) {
    other.push({ hph: h, track: null, status: 'no_trackid' });
    continue;
  }
  const t = await Track.findById(h.trackId).select('classifiedBy lastReviewedAt artist title phase bpm qualityLevel');
  if (!t) {
    other.push({ hph: h, track: null, status: 'track_not_found' });
    continue;
  }
  const isCuratedYday =
    typeof t.classifiedBy === 'string' &&
    t.classifiedBy.startsWith('claude_batch_auto_v3_') &&
    t.lastReviewedAt &&
    t.lastReviewedAt >= DAY_START &&
    t.lastReviewedAt < DAY_END;

  if (isCuratedYday) {
    curatedYday.push({ hph: h, track: t });
  } else {
    other.push({ hph: h, track: t, status: 'played_but_not_curated_yday' });
  }
}

// 4) Rapport
const lines = [];
lines.push(`================ FTMP63 × CURATION 02/10 — RAPPORT ================`);
lines.push(`Date (UTC)                : ${new Date().toISOString()}`);
lines.push(`Party                     : ${PARTY_CODE}`);
lines.push(`  createdAt               : ${party.createdAt?.toISOString() || '?'}`);
lines.push(`  endedAt                 : ${party.endedAt?.toISOString() || '(not ended)'}`);
lines.push(`Tracks jouées (HPH)       : ${hphs.length}`);
lines.push(`  dont curatées hier 02/10: ${curatedYday.length}  ← réponse Jean-Sé`);
lines.push(`  autres (ancienneté/no)  : ${other.length}`);
lines.push('--------------------------------------------------------------');
if (curatedYday.length > 0) {
  lines.push('');
  lines.push('TRACKS CURATÉES HIER 02/10 ET JOUÉES DANS FTMP63 :');
  for (const r of curatedYday) {
    const t = r.track;
    const h = r.hph;
    lines.push(`  ✅ ${h.playedAt.toISOString().slice(11, 19)} UTC | phase=${h.phase || '-'} | ${t.artist} — ${t.title}`);
    lines.push(`      → classifiedBy=${t.classifiedBy} | track.phase=${t.phase} | bpm=${t.bpm}`);
    const v = h.voteScore || {};
    lines.push(`      → votes 🔥${v.feu || 0} 👍${v.cool || 0} 👎${v.bof || 0}${h.wasSuggestedByGuest ? ' | suggérée par guest' : ''}${h.wasHostOverride ? ' | host override' : ''}`);
  }
}
lines.push('');
lines.push('AUTRES TRACKS JOUÉES (non curatées hier) :');
for (const r of other) {
  const h = r.hph;
  if (r.track) {
    const t = r.track;
    const cls = t.classifiedBy || 'none';
    const rev = t.lastReviewedAt ? t.lastReviewedAt.toISOString().slice(0, 10) : 'never';
    lines.push(`  · ${h.playedAt.toISOString().slice(11, 19)} UTC | ${t.artist} — ${t.title} | ql=${t.qualityLevel || '?'} classifiedBy=${cls.slice(0, 25)} reviewed=${rev}`);
  } else {
    lines.push(`  · ${h.playedAt.toISOString().slice(11, 19)} UTC | ${h.artist || '?'} — ${h.title || '?'} | [${r.status}] dz=${h.deezerTrackId || '-'}`);
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
