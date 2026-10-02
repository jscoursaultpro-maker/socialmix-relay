// scripts/curation/inject_user_signal_2026-10-02.mjs
// Agrège les signaux user (suggestions + votes 🔥) depuis Party.* et les projette sur Track
// via un champ dérivé `userSignalScore` + compteurs. N'écrase JAMAIS les données user brutes
// (Party.guestVotes, Party.suggestions, Track.performance.* restent intacts).
//
// Scoring :
//   userSignalScore = suggestedCount + 2 × feuCount   (feu pondéré 2× la suggestion)
//
// Résultat : les tracks qui ont été humainement suggérées ou aimées grimpent en tête
// de l'export curation (voir export_inbox.mjs --priority user-signal).

import fs from 'fs';
import mongoose from 'mongoose';
import { connectMongo, normalize, normalizeArtist } from './lib.mjs';

const DRY = process.env.DRY_RUN === '1';
const db = await connectMongo();
const parties = db.collection('parties');
const tracks = db.collection('tracks');

console.log(`\n=== INJECT USER SIGNAL ${DRY ? '(DRY RUN)' : ''} ===`);

// 1) Agrégation suggestions par track-key (titre+artiste normalisés OU deezerId)
const suggCount = new Map(); // "artist||title" or deezerId → count
const cursorSugg = parties.find(
  { isDemoParty: { $ne: true }, suggestions: { $exists: true, $not: { $size: 0 } } },
  { projection: { suggestions: 1 } }
);
let partiesScannedSugg = 0;
for await (const p of cursorSugg) {
  partiesScannedSugg++;
  for (const s of (p.suggestions || [])) {
    if (!s || typeof s !== 'object') continue;
    const title = s.title || s.name || s.trackName || s.track?.title || null;
    const artist = s.artist || s.artistName || s.track?.artist || null;
    const dz = s.deezerId || s.deezerTrackId || s.providers?.deezer?.trackId || s.track?.providers?.deezer?.trackId || null;
    if (dz && Number(dz) > 0) {
      const k = `dz:${Number(dz)}`;
      suggCount.set(k, (suggCount.get(k) || 0) + 1);
    } else if (title && artist) {
      const k = `n:${normalizeArtist(artist)}||${normalize(title)}`;
      suggCount.set(k, (suggCount.get(k) || 0) + 1);
    }
  }
}

// 2) Agrégation votes 🔥 par track-key
// Structure guestVotes : { [guestId]: { [trackKey]: 'feu'|'cool'|'bof' } } ou inverse selon runtime
const feuCount = new Map();
const cursorVotes = parties.find(
  { isDemoParty: { $ne: true }, guestVotes: { $exists: true } },
  { projection: { guestVotes: 1 } }
);
let partiesScannedVotes = 0;
for await (const p of cursorVotes) {
  partiesScannedVotes++;
  const gv = p.guestVotes || {};
  for (const [outerKey, inner] of Object.entries(gv)) {
    if (inner === 'feu' || inner === '🔥') {
      // forme plate : { trackKey: 'feu' }
      feuCount.set(outerKey, (feuCount.get(outerKey) || 0) + 1);
    } else if (inner && typeof inner === 'object') {
      // forme imbriquée : outerKey = guestId, inner = { trackKey: 'feu' }
      for (const [innerKey, v] of Object.entries(inner)) {
        if (v === 'feu' || v === '🔥') {
          feuCount.set(innerKey, (feuCount.get(innerKey) || 0) + 1);
        } else if (v && typeof v === 'object' && v.vote === 'feu') {
          feuCount.set(innerKey, (feuCount.get(innerKey) || 0) + 1);
        }
      }
    }
  }
}

console.log(`Parties scannées (suggestions): ${partiesScannedSugg}`);
console.log(`Parties scannées (votes)     : ${partiesScannedVotes}`);
console.log(`Keys suggestions uniques     : ${suggCount.size}`);
console.log(`Keys feu uniques             : ${feuCount.size}`);

// 3) Résoudre chaque clé en Track._id et accumuler le score
// Les clés feu sont majoritairement des ObjectIds (ids de tracks). Les clés suggestions ont le préfixe dz: ou n:
const trackScore = new Map(); // trackId str → { suggested, feu }

// 3a) Suggestions avec deezerId → match sur providers.deezer.trackId
for (const [key, count] of suggCount) {
  if (!key.startsWith('dz:')) continue;
  const dzId = Number(key.slice(3));
  const t = await tracks.findOne({ 'providers.deezer.trackId': dzId }, { projection: { _id: 1 } });
  if (t) {
    const id = String(t._id);
    const cur = trackScore.get(id) || { suggested: 0, feu: 0 };
    cur.suggested += count;
    trackScore.set(id, cur);
  }
}

// 3b) Suggestions texte normalisé → match sur artist+title (bulk via distinct keys)
let suggResolved = 0, suggUnresolved = 0;
for (const [key, count] of suggCount) {
  if (!key.startsWith('n:')) continue;
  const [na, nt] = key.slice(2).split('||');
  if (!na || !nt) continue;
  // match conservateur : chercher candidats dont l'artiste commence par les premiers mots
  const firstToken = na.split(' ')[0];
  if (!firstToken || firstToken.length < 3) { suggUnresolved++; continue; }
  const re = new RegExp('^' + firstToken.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
  const cands = await tracks.find({ artist: re }, { projection: { title: 1, artist: 1 } }).limit(10).toArray();
  let hit = null;
  for (const c of cands) {
    if (normalize(c.title) === nt && normalizeArtist(c.artist) === na) { hit = c; break; }
  }
  if (hit) {
    const id = String(hit._id);
    const cur = trackScore.get(id) || { suggested: 0, feu: 0 };
    cur.suggested += count;
    trackScore.set(id, cur);
    suggResolved++;
  } else {
    suggUnresolved++;
  }
}

// 3c) Votes feu : clés sont souvent des ObjectIds
for (const [key, count] of feuCount) {
  if (/^[0-9a-f]{24}$/i.test(key)) {
    const id = key.toLowerCase();
    const cur = trackScore.get(id) || { suggested: 0, feu: 0 };
    cur.feu += count;
    trackScore.set(id, cur);
  }
}

console.log(`Suggestions résolues (match tracks) : ${suggResolved}`);
console.log(`Suggestions non résolues (absent)   : ${suggUnresolved}`);
console.log(`Tracks avec signal user             : ${trackScore.size}`);

// 4) Appliquer en BDD (userSignalScore + compteurs). JAMAIS écrire les données brutes.
let applied = 0, skipped = 0;
const topList = [...trackScore.entries()]
  .map(([id, s]) => ({ id, suggested: s.suggested, feu: s.feu, score: s.suggested + 2 * s.feu }))
  .sort((a, b) => b.score - a.score);

for (const row of topList) {
  if (row.score <= 0) { skipped++; continue; }
  if (DRY) { applied++; continue; }
  try {
    await tracks.updateOne(
      { _id: new mongoose.Types.ObjectId(row.id) },
      { $set: {
          userSignalScore: row.score,
          userSignalSuggestedCount: row.suggested,
          userSignalFeuCount: row.feu,
          userSignalUpdatedAt: new Date()
      } }
    );
    applied++;
  } catch (e) {
    skipped++;
  }
}

// 5) Rapport
const lines = [];
lines.push('================ INJECT USER SIGNAL — RAPPORT ================');
lines.push(`Date (UTC)                       : ${new Date().toISOString()}`);
lines.push(`Dry run                          : ${DRY}`);
lines.push(`Parties scannées (non-demo)      : ${partiesScannedSugg} sugg / ${partiesScannedVotes} votes`);
lines.push(`Suggestions keys uniques         : ${suggCount.size}`);
lines.push(`  résolues sur tracks            : ${suggResolved} + ${[...suggCount.keys()].filter(k => k.startsWith('dz:')).length} par deezerId`);
lines.push(`  non résolues (absent BDD)      : ${suggUnresolved}`);
lines.push(`Votes feu keys uniques           : ${feuCount.size}`);
lines.push(`Tracks avec signal user          : ${trackScore.size}`);
lines.push(`  score ≥ 1 (appliqué/dryrun)    : ${applied}`);
lines.push(`  skippés                        : ${skipped}`);
lines.push('--------------------------------------------------------------');
lines.push('TOP 30 tracks par userSignalScore :');
let i = 0;
for (const row of topList.slice(0, 30)) {
  i++;
  const t = await tracks.findOne({ _id: new mongoose.Types.ObjectId(row.id) }, { projection: { artist: 1, title: 1, phase: 1, bpm: 1, qualityLevel: 1 } });
  if (!t) continue;
  const unq = !t.phase || !t.bpm ? ' ⚠️' : '';
  lines.push(`  score=${String(row.score).padStart(3)} sugg=${String(row.suggested).padStart(2)} feu=${String(row.feu).padStart(2)} ql=${(t.qualityLevel || 'absent').padEnd(9)} phase=${String(t.phase || '-').padEnd(8)} bpm=${String(t.bpm || '-').padEnd(5)} | ${t.artist} — ${t.title}${unq}`);
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
