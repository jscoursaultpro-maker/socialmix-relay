// scripts/curation/explore_party_votes_2026-10-02.mjs
// Read-only : les votes 🔥 sont-ils dans Party.guestVotes (bruts) ou dans Track.performance (agrégés) ?
// Si Party.guestVotes contient des votes réels, on les agrège en live et on identifie les tracks ≥ 3 feu
// sans phase/BPM à qualifier en priorité.

import fs from 'fs';
import mongoose from 'mongoose';
import { connectMongo } from './lib.mjs';

const db = await connectMongo();
const parties = db.collection('parties');
const tracks = db.collection('tracks');

// 1) Combien de parties ont guestVotes non vide ?
const partyCount = await parties.countDocuments({});
const nonDemoCount = await parties.countDocuments({ isDemoParty: { $ne: true } });

// guestVotes est un objet Mixed → compter via aggregate
const voteStats = await parties.aggregate([
  { $project: {
      hasVotes: { $gt: [{ $size: { $objectToArray: { $ifNull: ['$guestVotes', {}] } } }, 0] },
      isDemo: { $ifNull: ['$isDemoParty', false] },
      code: 1
  } },
  { $group: { _id: { hasVotes: '$hasVotes', isDemo: '$isDemo' }, n: { $sum: 1 } } }
]).toArray();

console.log('\n=== PARTY VOTES EXPLORATION ===');
console.log(`Parties total                : ${partyCount}`);
console.log(`Parties non-demo             : ${nonDemoCount}`);
console.log(`Répartition hasVotes × isDemo :`);
for (const r of voteStats) console.log(`  hasVotes=${r._id.hasVotes} isDemo=${r._id.isDemo} : ${r.n}`);

// 2) Agrégation live : parcourir les parties non-demo et compter les feu par track
// La structure de guestVotes est : { [trackKey]: { [guestId]: 'feu'|'cool'|'bof' } } (hypothèse à vérifier)
const sampleParty = await parties.findOne({
  isDemoParty: { $ne: true },
  guestVotes: { $exists: true, $ne: {} }
});
if (sampleParty?.guestVotes && Object.keys(sampleParty.guestVotes).length) {
  const firstKey = Object.keys(sampleParty.guestVotes)[0];
  console.log(`\n=== Sample guestVotes (party ${sampleParty.code || sampleParty._id}) ===`);
  console.log(`First trackKey: ${firstKey}`);
  console.log(`Value: ${JSON.stringify(sampleParty.guestVotes[firstKey]).slice(0, 200)}`);
}

// 3) Compter feu par trackKey à travers toutes les parties non-demo
const feuByTrack = new Map(); // key = trackKey (title+artist ou ISRC ou trackId) → feu count
let partiesScanned = 0;
let totalFeuSeen = 0;
const cursor = parties.find(
  { isDemoParty: { $ne: true }, guestVotes: { $exists: true } },
  { projection: { guestVotes: 1, code: 1 } }
);
for await (const p of cursor) {
  partiesScanned++;
  const gv = p.guestVotes || {};
  for (const [trackKey, voteEntry] of Object.entries(gv)) {
    if (!voteEntry) continue;
    // voteEntry peut être {guestId: 'feu'} OU {feu: n, cool: n, bof: n} OU 'feu'
    let feuCount = 0;
    if (typeof voteEntry === 'object') {
      if (typeof voteEntry.feu === 'number') {
        feuCount = voteEntry.feu;
      } else {
        // {guestId: 'feu'}
        for (const v of Object.values(voteEntry)) {
          if (v === 'feu' || v === '🔥') feuCount++;
        }
      }
    } else if (voteEntry === 'feu' || voteEntry === '🔥') {
      feuCount = 1;
    }
    if (feuCount > 0) {
      feuByTrack.set(trackKey, (feuByTrack.get(trackKey) || 0) + feuCount);
      totalFeuSeen += feuCount;
    }
  }
}

console.log(`\nParties scannées (non-demo)  : ${partiesScanned}`);
console.log(`Total votes 🔥 agrégés       : ${totalFeuSeen}`);
console.log(`Tracks uniques ayant reçu 🔥 : ${feuByTrack.size}`);

// 4) Croiser le top avec Track (phase/bpm)
const sorted = [...feuByTrack.entries()].sort((a, b) => b[1] - a[1]);
const top30 = sorted.slice(0, 30);
const resolved = [];
for (const [key, feu] of top30) {
  // key peut être un trackId Mongo, un ISRC, ou "artist||title"
  let track = null;
  if (/^[0-9a-f]{24}$/i.test(key)) {
    try { track = await tracks.findOne({ _id: new mongoose.Types.ObjectId(key) }, { projection: { artist: 1, title: 1, phase: 1, bpm: 1, qualityLevel: 1, isVerified: 1 } }); } catch {}
  }
  if (!track) {
    // essayer ISRC
    track = await tracks.findOne({ isrc: key }, { projection: { artist: 1, title: 1, phase: 1, bpm: 1, qualityLevel: 1, isVerified: 1 } });
  }
  resolved.push({ key, feu, track });
}

const lines = [];
lines.push('================ VOTES 🔥 (agrégés live depuis Party.guestVotes) ================');
lines.push(`Date (UTC)                   : ${new Date().toISOString()}`);
lines.push(`Parties scannées (non-demo)  : ${partiesScanned}`);
lines.push(`Total votes 🔥               : ${totalFeuSeen}`);
lines.push(`Tracks uniques avec 🔥       : ${feuByTrack.size}`);
lines.push('');
lines.push('=== TOP 30 tracks par feu (clé = ce qui est stocké dans guestVotes) ===');
for (const r of resolved) {
  const t = r.track;
  if (t) {
    const unqual = !t.phase || !t.bpm || t.bpm === 0;
    const mark = unqual ? ' ⚠️ NON-QUALIFIÉ' : '';
    const ver = t.isVerified ? 'V' : ' ';
    lines.push(`  🔥${String(r.feu).padStart(3)} ql=${(t.qualityLevel || 'absent').padEnd(9)} ${ver} phase=${String(t.phase || '-').padEnd(8)} bpm=${String(t.bpm || '-').padEnd(5)} | ${t.artist} — ${t.title}${mark}`);
  } else {
    lines.push(`  🔥${String(r.feu).padStart(3)} [NOT RESOLVED] key=${r.key.slice(0, 60)}`);
  }
}

// Compter les non-qualifiés dans le top résolu
const unqualifiedCount = resolved.filter(r => r.track && (!r.track.phase || !r.track.bpm)).length;
lines.push('');
lines.push(`Top 30 — tracks résolues     : ${resolved.filter(r => r.track).length}`);
lines.push(`Top 30 — non qualifiées      : ${unqualifiedCount}  ← priorité`);
lines.push('==============================================================');

const out = lines.join('\n') + '\n';
console.log('\n' + out);
if (process.env.COUNT_OUT) {
  const dir = process.env.COUNT_OUT.replace(/\/[^\/]+$/, '');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(process.env.COUNT_OUT, out, 'utf8');
}

await mongoose.disconnect();
