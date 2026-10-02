// scripts/curation/count_suggestions_2026-10-02.mjs
// Read-only : compte les tracks dont source ∈ {host_suggestion, guest_suggestion, suggestion},
// ventilées par qualityLevel + isVerified + présence d'un deezerTrackId.
// Objectif : savoir combien de suggestions sont vraiment qualifiables.

import mongoose from 'mongoose';
import { connectMongo } from './lib.mjs';

const SOURCES = ['host_suggestion', 'guest_suggestion', 'suggestion'];
const db = await connectMongo();
const tracks = db.collection('tracks');

const total = await tracks.countDocuments({ source: { $in: SOURCES } });
const byQL = await tracks.aggregate([
  { $match: { source: { $in: SOURCES } } },
  { $group: { _id: { source: '$source', ql: { $ifNull: ['$qualityLevel', 'absent'] } }, n: { $sum: 1 } } },
  { $sort: { n: -1 } }
]).toArray();

const videPartielle = await tracks.countDocuments({
  source: { $in: SOURCES },
  $or: [{ qualityLevel: { $in: ['vide', 'partielle'] } }, { qualityLevel: null }],
  isVerified: { $ne: true },
  isBlocked: { $ne: true },
  suggestable: { $ne: false },
  title: { $nin: [null, ''] },
  artist: { $nin: [null, ''] }
});

const withDeezerId = await tracks.countDocuments({
  source: { $in: SOURCES },
  $or: [{ qualityLevel: { $in: ['vide', 'partielle'] } }, { qualityLevel: null }],
  isVerified: { $ne: true },
  isBlocked: { $ne: true },
  suggestable: { $ne: false },
  title: { $nin: [null, ''] },
  artist: { $nin: [null, ''] },
  'providers.deezer.trackId': { $gt: 0 }
});

// Sample 20 pour voir ce qu'on a
const sample = await tracks.find({
  source: { $in: SOURCES },
  $or: [{ qualityLevel: { $in: ['vide', 'partielle'] } }, { qualityLevel: null }],
  isVerified: { $ne: true },
  isBlocked: { $ne: true },
  suggestable: { $ne: false }
}).limit(20).project({ artist: 1, title: 1, source: 1, qualityLevel: 1, 'providers.deezer.trackId': 1, deezerRank: 1 }).toArray();

console.log('\n=== SUGGESTIONS — COMPTAGE 2026-10-02 ===');
console.log(`Total source ∈ [${SOURCES.join(', ')}] : ${total}`);
console.log('\nRépartition source × qualityLevel :');
for (const r of byQL) {
  console.log(`  ${r._id.source.padEnd(18)} ql=${String(r._id.ql).padEnd(10)} : ${r.n}`);
}
console.log(`\nSuggestions qualifiables (vide/partielle, non vérifiées, suggestable) : ${videPartielle}`);
console.log(`  dont avec deezer trackId (export pipeline readable) : ${withDeezerId}`);
console.log(`  gap sans deezer trackId : ${videPartielle - withDeezerId}`);

console.log('\n=== Sample 20 suggestions qualifiables ===');
for (const t of sample) {
  const dz = t.providers?.deezer?.trackId || 0;
  console.log(`  [${(t.source || '?').padEnd(18)}] ql=${(t.qualityLevel || 'absent').padEnd(9)} dz=${String(dz).padEnd(10)} | ${t.artist} — ${t.title}`);
}

await mongoose.disconnect();
