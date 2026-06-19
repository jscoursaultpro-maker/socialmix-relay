/**
 * flag_duplicates.mjs
 * Identifie les doublons par deezerID.
 * Garde le meilleur (qualityLevel + deezerRank), flag les autres isDuplicate=true.
 * Les flaggés restent en DB mais sont exclus du seed iOS.
 */
import mongoose from 'mongoose';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI manquant'); process.exit(1); }

await mongoose.connect(MONGO_URI);
const Track = (await import('./models/Track.js')).default;
console.log('✅ MongoDB connecté\n');

const QL_RANK = { platine: 4, complete: 3, partielle: 2, vide: 1 };

// 1. Doublons par deezerID
const dupesDeezer = await Track.aggregate([
  { $match: { 'providers.deezer.trackId': { $gt: 0 } } },
  { $group: { _id: '$providers.deezer.trackId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
  { $match: { count: { $gt: 1 } } },
  { $sort: { count: -1 } }
]);

console.log(`🔍 ${dupesDeezer.length} groupes de doublons par deezerID\n`);

let flagged = 0;

for (const group of dupesDeezer) {
  const tracks = await Track.find({ _id: { $in: group.ids } }).lean();
  
  // Sort: best qualityLevel first, then highest deezerRank
  tracks.sort((a, b) => {
    const qa = QL_RANK[a.qualityLevel] || 0;
    const qb = QL_RANK[b.qualityLevel] || 0;
    if (qb !== qa) return qb - qa;
    return (b.deezerRank || 0) - (a.deezerRank || 0);
  });
  
  const keeper = tracks[0];
  const dupes = tracks.slice(1);
  const artistName = typeof keeper.artist === 'object' ? keeper.artist.name : keeper.artist;
  
  console.log(`  deezerID=${group._id} "${keeper.title}" — ${artistName}`);
  console.log(`    ✅ GARDÉ: ${keeper.qualityLevel} | rank:${keeper.deezerRank || 0} | _id:${keeper._id}`);
  
  for (const dupe of dupes) {
    await Track.updateOne({ _id: dupe._id }, { $set: { isDuplicate: true } });
    console.log(`    🚫 FLAGGÉ: ${dupe.qualityLevel} | rank:${dupe.deezerRank || 0} | _id:${dupe._id}`);
    flagged++;
  }
}

// 2. Doublons par titre+artiste normalisé (même titre, même artiste)
console.log('\n── Doublons titre+artiste ──');
const allTracks = await Track.find({ isDuplicate: { $ne: true } }).select('title artist qualityLevel deezerRank _id').lean();

const byKey = {};
for (const t of allTracks) {
  const artist = typeof t.artist === 'object' ? t.artist.name : t.artist;
  const key = (t.title + '|||' + artist).toLowerCase().trim();
  if (!byKey[key]) byKey[key] = [];
  byKey[key].push(t);
}

let flaggedTitle = 0;
for (const [key, tracks] of Object.entries(byKey)) {
  if (tracks.length <= 1) continue;
  
  tracks.sort((a, b) => {
    const qa = QL_RANK[a.qualityLevel] || 0;
    const qb = QL_RANK[b.qualityLevel] || 0;
    if (qb !== qa) return qb - qa;
    return (b.deezerRank || 0) - (a.deezerRank || 0);
  });
  
  const keeper = tracks[0];
  for (let i = 1; i < tracks.length; i++) {
    await Track.updateOne({ _id: tracks[i]._id }, { $set: { isDuplicate: true } });
    flaggedTitle++;
  }
}
console.log(`  ${flaggedTitle} tracks flaggées par titre+artiste`);

console.log(`\n${'═'.repeat(50)}`);
console.log(`🚫 Total flaggés isDuplicate: ${flagged + flaggedTitle}`);
console.log(`${'═'.repeat(50)}`);

await mongoose.disconnect();
