// scripts/curation/explore_party_suggestions.mjs
// Explore les suggestions stockées dans Party.suggestions (array Mixed).
// Objectif : savoir combien de suggestions uniques existent, et combien sont déjà
// dans la collection tracks (par ISRC ou titre+artiste normalisé).
//
// LECTURE SEULE. Jamais d'écriture.

import mongoose from 'mongoose';
import { connectMongo, normalize, normalizeArtist } from './lib.mjs';
import fs from 'fs';

const db = await connectMongo();
const parties = db.collection('parties');
const tracks = db.collection('tracks');

// 1) Count parties + total suggestions
const partyCount = await parties.countDocuments({});
const sumSuggestions = await parties.aggregate([
  { $project: { n: { $size: { $ifNull: ['$suggestions', []] } } } },
  { $group: { _id: null, total: { $sum: '$n' }, maxOne: { $max: '$n' }, partiesWithSugg: { $sum: { $cond: [{ $gt: ['$n', 0] }, 1, 0] } } } }
]).toArray();

const stats = sumSuggestions[0] || { total: 0, maxOne: 0, partiesWithSugg: 0 };

console.log(`\n=== PARTY SUGGESTIONS EXPLORATION ===`);
console.log(`Parties total                : ${partyCount}`);
console.log(`Parties avec suggestions     : ${stats.partiesWithSugg}`);
console.log(`Suggestions totales (brut)   : ${stats.total}`);
console.log(`Max suggestions une party    : ${stats.maxOne}`);

// 2) Sample 1 suggestion pour voir la structure
const sampleParty = await parties.findOne({ suggestions: { $exists: true, $not: { $size: 0 } } });
if (sampleParty && Array.isArray(sampleParty.suggestions) && sampleParty.suggestions.length) {
  console.log(`\n=== Sample structure (1 suggestion) ===`);
  console.log(JSON.stringify(sampleParty.suggestions[0], null, 2));
}

// 3) Déduper toutes les suggestions par titre+artiste normalisé
const uniq = new Map(); // key = `${normArtist}||${normTitle}` → {artist, title, isrc?, deezerId?, count, firstSeenAt}
const cursor = parties.find({ suggestions: { $exists: true, $not: { $size: 0 } } }, { projection: { suggestions: 1, createdAt: 1, code: 1 } });
let scanned = 0;
for await (const p of cursor) {
  scanned++;
  for (const s of (p.suggestions || [])) {
    if (!s || typeof s !== 'object') continue;
    // Essayer plusieurs clés possibles (schema mixed → formats variés)
    const title = s.title || s.name || s.trackName || s.track?.title || null;
    const artist = s.artist || s.artistName || s.track?.artist || null;
    if (!title || !artist) continue;
    const key = `${normalizeArtist(artist)}||${normalize(title)}`;
    const prev = uniq.get(key);
    if (prev) {
      prev.count++;
    } else {
      uniq.set(key, {
        artist,
        title,
        isrc: s.isrc || s.track?.isrc || null,
        deezerTrackId: s.deezerId || s.deezerTrackId || s.providers?.deezer?.trackId || s.track?.providers?.deezer?.trackId || null,
        spotifyTrackId: s.spotifyId || s.spotifyTrackId || s.track?.spotifyTrackId || null,
        count: 1,
        firstSeenAt: p.createdAt || null,
        partyCode: p.code || null
      });
    }
  }
}

console.log(`\nParties scannées             : ${scanned}`);
console.log(`Suggestions uniques (dédup)  : ${uniq.size}`);

// 4) Croiser avec la collection tracks pour voir lesquelles sont déjà présentes
let alreadyInTracks = 0;
let alreadyQualified = 0;
let needQualification = 0;
const needList = [];
let i = 0;
for (const [key, s] of uniq) {
  i++;
  // Match par deezerTrackId > ISRC > titre+artiste normalisé
  let hit = null;
  if (s.deezerTrackId) {
    hit = await tracks.findOne({ 'providers.deezer.trackId': Number(s.deezerTrackId) }, { projection: { qualityLevel: 1, source: 1, isVerified: 1, _id: 1 } });
  }
  if (!hit && s.isrc) {
    hit = await tracks.findOne({ isrc: s.isrc }, { projection: { qualityLevel: 1, source: 1, isVerified: 1, _id: 1 } });
  }
  if (!hit) {
    // match normalisé (slow)
    const [na, nt] = key.split('||');
    const cands = await tracks.find({ artist: { $regex: new RegExp('^' + s.artist.slice(0, 15).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i') } }, { projection: { title: 1, artist: 1, qualityLevel: 1, source: 1, isVerified: 1, _id: 1 } }).limit(5).toArray();
    for (const c of cands) {
      if (normalize(c.title) === nt && normalizeArtist(c.artist) === na) { hit = c; break; }
    }
  }
  if (hit) {
    alreadyInTracks++;
    const ql = hit.qualityLevel;
    if (hit.isVerified || ql === 'complete' || ql === 'platine') alreadyQualified++;
    else needQualification++;
  } else {
    needList.push({ ...s, status: 'absent_from_tracks' });
  }
}

console.log(`\n=== Croisement suggestions × collection tracks ===`);
console.log(`Déjà en tracks               : ${alreadyInTracks}`);
console.log(`  dont qualifiées            : ${alreadyQualified}`);
console.log(`  dont à qualifier           : ${needQualification}`);
console.log(`Absentes de tracks           : ${needList.length}`);

// 5) Écrire un fichier détaillé pour le workflow
const COUNT_OUT = process.env.COUNT_OUT;
if (COUNT_OUT) {
  const dir = COUNT_OUT.replace(/\/[^\/]+$/, '');
  fs.mkdirSync(dir, { recursive: true });
  const out = [
    '=== PARTY SUGGESTIONS EXPLORATION ===',
    `Date (UTC)              : ${new Date().toISOString()}`,
    `Parties total           : ${partyCount}`,
    `Parties avec suggestions: ${stats.partiesWithSugg}`,
    `Suggestions totales     : ${stats.total}`,
    `Suggestions uniques     : ${uniq.size}`,
    '---',
    `Déjà en tracks          : ${alreadyInTracks}`,
    `  dont qualifiées       : ${alreadyQualified}`,
    `  dont à qualifier      : ${needQualification}`,
    `Absentes de tracks      : ${needList.length}`,
    '',
    '=== TOP 30 suggestions ABSENTES de tracks (par fréquence) ===',
    ...needList.sort((a, b) => b.count - a.count).slice(0, 30).map(s =>
      `  ${String(s.count).padStart(3)}× | dz=${String(s.deezerTrackId || '-').padEnd(10)} | ${s.artist} — ${s.title}`
    ),
    ''
  ];
  fs.writeFileSync(COUNT_OUT, out.join('\n'), 'utf8');
}

await mongoose.disconnect();
