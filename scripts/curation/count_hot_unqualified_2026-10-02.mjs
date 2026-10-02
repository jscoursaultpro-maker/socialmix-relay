// scripts/curation/count_hot_unqualified_2026-10-02.mjs
// Read-only : combien de tracks avec ≥ 3 votes 🔥 sont encore sans phase OU sans BPM ?
// Ces tracks sont priorité absolue : les guests ont adhéré mais DJ Brain ne peut pas s'en servir.

import fs from 'fs';
import mongoose from 'mongoose';
import { connectMongo } from './lib.mjs';

const db = await connectMongo();
const tracks = db.collection('tracks');

const MIN_FEU = 3;

// Dénominateur : toutes les tracks ≥ 3 feu
const totalHot = await tracks.countDocuments({ 'performance.votes.feu': { $gte: MIN_FEU } });

// Sous-ensembles
const hotNoPhase = await tracks.countDocuments({
  'performance.votes.feu': { $gte: MIN_FEU },
  $or: [{ phase: null }, { phase: '' }, { phase: { $exists: false } }]
});
const hotNoBpm = await tracks.countDocuments({
  'performance.votes.feu': { $gte: MIN_FEU },
  $or: [{ bpm: null }, { bpm: 0 }, { bpm: { $exists: false } }]
});
const hotNoPhaseOrBpm = await tracks.countDocuments({
  'performance.votes.feu': { $gte: MIN_FEU },
  $or: [
    { phase: null }, { phase: '' }, { phase: { $exists: false } },
    { bpm: null }, { bpm: 0 }, { bpm: { $exists: false } }
  ]
});
const hotBothMissing = await tracks.countDocuments({
  'performance.votes.feu': { $gte: MIN_FEU },
  $and: [
    { $or: [{ phase: null }, { phase: '' }, { phase: { $exists: false } }] },
    { $or: [{ bpm: null }, { bpm: 0 }, { bpm: { $exists: false } }] }
  ]
});

// Croisement candidat pipeline (vide/partielle, non-verified, avec deezer trackId)
const hotCandidates = await tracks.countDocuments({
  'performance.votes.feu': { $gte: MIN_FEU },
  isVerified: { $ne: true },
  isBlocked: { $ne: true },
  suggestable: { $ne: false },
  'providers.deezer.trackId': { $gt: 0 },
  $or: [{ qualityLevel: { $in: ['vide', 'partielle'] } }, { qualityLevel: null }]
});

// Top 30 pour voir ce qu'on a (plus de feu d'abord)
const sample = await tracks.find({
  'performance.votes.feu': { $gte: MIN_FEU },
  $or: [
    { phase: null }, { phase: '' }, { phase: { $exists: false } },
    { bpm: null }, { bpm: 0 }, { bpm: { $exists: false } }
  ]
})
  .sort({ 'performance.votes.feu': -1 })
  .limit(30)
  .project({
    artist: 1, title: 1, phase: 1, bpm: 1,
    'performance.votes.feu': 1, 'performance.feuRatio': 1,
    qualityLevel: 1, isVerified: 1, source: 1,
    'providers.deezer.trackId': 1
  })
  .toArray();

const lines = [];
lines.push('================ TRACKS ≥ 3 🔥 NON QUALIFIÉES ================');
lines.push(`Date (UTC)                       : ${new Date().toISOString()}`);
lines.push(`Seuil feu                        : ≥ ${MIN_FEU}`);
lines.push('--------------------------------------------------------------');
lines.push(`Total tracks ≥ ${MIN_FEU} 🔥             : ${totalHot}`);
lines.push(`  dont sans phase                : ${hotNoPhase}`);
lines.push(`  dont sans BPM (null/0)         : ${hotNoBpm}`);
lines.push(`  dont sans phase OU sans BPM    : ${hotNoPhaseOrBpm}  ← priorité`);
lines.push(`  dont sans phase ET sans BPM    : ${hotBothMissing}  ← urgent`);
lines.push('--------------------------------------------------------------');
lines.push(`CANDIDATES curation auto (vide/partielle, non-verified, deezer OK, ≥ ${MIN_FEU} 🔥) :`);
lines.push(`  ${hotCandidates}  ← exportable par pipeline immédiatement`);
lines.push('==============================================================');
lines.push('');
lines.push('=== TOP 30 (par nombre de feu décroissant) ===');
for (const t of sample) {
  const feu = t.performance?.votes?.feu || 0;
  const ratio = t.performance?.feuRatio || 0;
  const dz = t.providers?.deezer?.trackId || 0;
  const phase = t.phase || '-';
  const bpm = t.bpm || '-';
  const ql = t.qualityLevel || 'absent';
  const ver = t.isVerified ? 'V' : ' ';
  lines.push(`  🔥${String(feu).padStart(3)} r=${(ratio).toFixed(2)} ql=${ql.padEnd(9)} ${ver} phase=${String(phase).padEnd(8)} bpm=${String(bpm).padEnd(5)} dz=${String(dz).padEnd(10)} | ${t.artist} — ${t.title}`);
}

const out = lines.join('\n') + '\n';
console.log('\n' + out);
if (process.env.COUNT_OUT) {
  const dir = process.env.COUNT_OUT.replace(/\/[^\/]+$/, '');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(process.env.COUNT_OUT, out, 'utf8');
}

await mongoose.disconnect();
