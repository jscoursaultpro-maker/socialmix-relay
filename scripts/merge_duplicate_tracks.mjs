// scripts/merge_duplicate_tracks.mjs
// Chantier normalize alignment — Étape 1 : merger les duplicates révélés par le nouveau normalize.
//
// Pour chaque groupe de tracks qui auraient le même newHash :
// 1. Identifier WINNER = celui avec ISRC (ou le plus complet, ou le plus ancien)
// 2. Identifier LOSERS = les autres tracks du groupe
// 3. Transférer les références downstream vers WINNER :
//    - HostPlaybackHistory.trackId
//    - Party.suggestions[].trackId
//    - Party.currentTrack (si _id match)
//    - Party.nextTrack (si _id match)
//    - AudioEvent (si présent)
// 4. Supprimer les LOSERS
//
// Usage:
//   node --env-file=.env scripts/merge_duplicate_tracks.mjs           # DRY-RUN
//   node --env-file=.env scripts/merge_duplicate_tracks.mjs --live    # LIVE

import mongoose from 'mongoose';

const DRY_RUN = !process.argv.includes('--live');
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGODB_URI manquant'); process.exit(1); }

// New normalize (aligned iOS - no spaces)
function normalizeNew(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}
function fallbackHashNew(title, artist) {
  return `${normalizeNew(title)}_${normalizeNew(artist)}`;
}

console.log(`\n🔀 Merge duplicates révélés par nouveau normalize`);
console.log(`Mode : ${DRY_RUN ? '⚠️  DRY-RUN' : '🚀 LIVE'}\n`);

await mongoose.connect(MONGO_URI);

const Track = mongoose.model('Track', new mongoose.Schema({}, { strict: false }));
const HPH = mongoose.connection.collection('hostplaybackhistories');
const Party = mongoose.model('Party', new mongoose.Schema({}, { strict: false }));

// ─── 1. Compute all newHashes ─────────────────────────────────────────────────
const tracks = await Track.find({}, {
  title: 1, artist: 1, fallbackHash: 1, isrc: 1,
  createdAt: 1, updatedAt: 1, qualityLevel: 1, classifiedBy: 1,
  bpm: 1, energy: 1, genre: 1
}).lean();

const groups = new Map(); // newHash → [tracks]
for (const t of tracks) {
  const newHash = fallbackHashNew(t.title, t.artist);
  if (!groups.has(newHash)) groups.set(newHash, []);
  groups.get(newHash).push(t);
}

const collisions = Array.from(groups.entries()).filter(([_, g]) => g.length > 1);
console.log(`📊 ${collisions.length} collisions à traiter\n`);

// ─── 2. Pick WINNER per collision + list downstream refs ─────────────────────
function pickWinner(group) {
  // Priority: ISRC > titre le plus court (canonique) > qualityLevel > classifiedBy > oldest
  const qOrder = { platine: 4, complete: 3, partielle: 2, vide: 1 };
  return group.sort((a, b) => {
    // 1. ISRC first (une track sans ISRC est moins fiable)
    if (a.isrc && !b.isrc) return -1;
    if (!a.isrc && b.isrc) return 1;
    // 2. Si les 2 ont même statut ISRC : titre le plus court = version canonique
    //    (évite "Pepas (Tiësto)" > "Pepas", ou "Le Freak (Edit)" > "Le Freak")
    const lenDiff = (a.title || '').length - (b.title || '').length;
    if (lenDiff !== 0) return lenDiff;
    // 3. qualityLevel
    const qA = qOrder[a.qualityLevel] || 0;
    const qB = qOrder[b.qualityLevel] || 0;
    if (qA !== qB) return qB - qA;
    // 4. classifiedBy
    if (a.classifiedBy && !b.classifiedBy) return -1;
    if (!a.classifiedBy && b.classifiedBy) return 1;
    // 5. oldest createdAt
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  })[0];
}

let totalMerges = 0;
let totalHPHTransfers = 0;
let totalSuggTransfers = 0;
let totalCurrentTrackFixes = 0;
let totalErrors = 0;

for (const [newHash, group] of collisions) {
  const winner = pickWinner(group);
  const losers = group.filter(t => !t._id.equals(winner._id));

  console.log(`\n🎯 newHash: "${newHash}"`);
  console.log(`   WINNER: "${winner.title}" — "${winner.artist}" (${winner._id}) ${winner.isrc ? '🔑' : '🎵'}`);
  losers.forEach(l => {
    console.log(`   LOSER : "${l.title}" — "${l.artist}" (${l._id}) ${l.isrc ? '🔑' : '🎵'}`);
  });

  for (const loser of losers) {
    // Count refs
    const hphCount = await HPH.countDocuments({ trackId: loser._id });
    const partySuggCount = await Party.countDocuments({ 'suggestions.trackId': loser._id });
    const partyCurrentCount = await Party.countDocuments({
      $or: [{ 'currentTrack._id': loser._id }, { 'nextTrack._id': loser._id }]
    });

    console.log(`     → HPH refs: ${hphCount} | Suggestion refs: ${partySuggCount} | currentTrack refs: ${partyCurrentCount}`);

    if (DRY_RUN) continue;

    try {
      // Transfer HPH refs
      if (hphCount > 0) {
        const r = await HPH.updateMany({ trackId: loser._id }, { $set: { trackId: winner._id } });
        totalHPHTransfers += r.modifiedCount;
      }
      // Transfer Party.suggestions refs
      if (partySuggCount > 0) {
        const r = await Party.updateMany(
          { 'suggestions.trackId': loser._id },
          { $set: { 'suggestions.$[elem].trackId': winner._id } },
          { arrayFilters: [{ 'elem.trackId': loser._id }] }
        );
        totalSuggTransfers += r.modifiedCount;
      }
      // Transfer currentTrack / nextTrack refs
      if (partyCurrentCount > 0) {
        await Party.updateMany({ 'currentTrack._id': loser._id }, { $set: { 'currentTrack._id': winner._id } });
        await Party.updateMany({ 'nextTrack._id': loser._id }, { $set: { 'nextTrack._id': winner._id } });
        totalCurrentTrackFixes += partyCurrentCount;
      }
      // Delete loser
      await Track.deleteOne({ _id: loser._id });
      console.log(`     ✅ Loser ${loser._id} merged into ${winner._id}`);
      totalMerges++;
    } catch (err) {
      console.error(`     ❌ Error merging ${loser._id}: ${err.message}`);
      totalErrors++;
    }
  }
}

console.log(`\n═══════════════════════════════`);
console.log(`Mode : ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`);
console.log(`✅ Losers merged        : ${totalMerges}`);
console.log(`🔄 HPH refs transferred : ${totalHPHTransfers}`);
console.log(`💡 Sugg refs transferred: ${totalSuggTransfers}`);
console.log(`🎵 currentTrack fixes  : ${totalCurrentTrackFixes}`);
console.log(`❌ Errors              : ${totalErrors}`);
console.log(`═══════════════════════════════\n`);

if (DRY_RUN) {
  console.log(`⚠️  DRY-RUN — aucune modification. Pour appliquer :`);
  console.log(`   node --env-file=.env scripts/merge_duplicate_tracks.mjs --live\n`);
}

process.exit(0);
