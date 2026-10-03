#!/usr/bin/env node
/**
 * hph-scan.mjs — ÉLARGISSEMENT DOCTRINE 3.9 — READ-ONLY STRICT — v2
 * Usage : node scripts/hph-scan.mjs [nbSoirees=60]
 *
 * v2 : tri sur l'index _id (plus de "Sort exceeded memory limit") + $project
 *      AVANT toute lecture des gros tableaux + allowDiskUse sur les agrégations.
 *      Mesure aussi le poids des documents Party (photos base64 embarquées).
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config({ quiet: true });

console.log('### hph-scan.mjs v2 — tri sur index _id ###');

const LIMIT = Number(process.argv[2] || 60);
const load = async (f, n) => { const m = await import(`../models/${f}`); return m.default || (n && m[n]) || Object.values(m).find(v => v && v.modelName); };

await mongoose.connect(process.env.MONGODB_URI, { readPreference: 'primary' });
const Party = await load('Party.js');
const Photo = await load('Photo.js', 'Photo');
const HPH   = await load('HostPlaybackHistory.js');

const pad = (s, n) => String(s === null || s === undefined ? '—' : s).padEnd(n).slice(0, n);
const d10 = d => new Date(d).toISOString().slice(0, 10);
const d16 = d => new Date(d).toISOString().replace('T', ' ').slice(0, 16);

// ── Q1/Q2 : $sort sur _id (index) puis $project immédiat — jamais de tri en mémoire ──
const parties = await Party.aggregate([
  { $sort: { _id: -1 } },
  { $limit: LIMIT * 3 },
  { $project: {
      code: 1, createdAt: 1, trackCount: 1, hostUserId: 1, streamingProvider: 1,
      status: '$lifecycle.status',
      nTracks: { $size: { $ifNull: ['$trackHistory', []] } },
      nPhotos: { $size: { $ifNull: ['$photos', []] } },
      docMo: { $divide: [{ $bsonSize: '$$ROOT' }, 1048576] }
  } },
  { $match: { nTracks: { $gt: 0 } } },
  { $limit: LIMIT }
]).allowDiskUse(true);

console.log(`\n══ Q1/Q2 — ${parties.length} dernières soirées ayant au moins 1 titre joué ══\n`);
console.log(pad('code', 8) + pad('date', 18) + pad('hist', 6) + pad('HPH', 6) + pad('delta', 7) +
            pad('trackCount', 12) + pad('provider', 12) + pad('doc Mo', 8) + 'statut');
console.log('─'.repeat(100));

let nbDesync = 0, nbZero = 0, nbTcFaux = 0, titresPerdus = 0;
const rows = [];
for (const p of parties) {
  const n = await HPH.countDocuments({ $or: [{ partyId: p._id }, { partyCode: p.code }] });
  const delta = p.nTracks - n;
  const tcFaux = typeof p.trackCount === 'number' && p.trackCount !== p.nTracks;
  if (delta > 0) nbDesync++;
  if (n === 0) { nbZero++; titresPerdus += p.nTracks; }
  if (tcFaux) nbTcFaux++;
  rows.push({ ...p, n, delta });
  console.log(
    pad(p.code, 8) + pad(d16(p.createdAt), 18) + pad(p.nTracks, 6) + pad(n, 6) +
    pad(delta === 0 ? 'ok' : `+${delta}`, 7) +
    pad(`${p.trackCount ?? '—'}${tcFaux ? ' ✗' : ' ✓'}`, 12) +
    pad(p.streamingProvider || '—', 12) +
    pad(p.docMo.toFixed(2), 8) + (p.status || '—')
  );
}

console.log('\n── Synthèse ──');
console.log(`Soirées en desync HPH (delta > 0)      : ${nbDesync}/${rows.length}`);
console.log(`Soirées à HPH = 0 malgré des titres    : ${nbZero}/${rows.length}  → ${titresPerdus} titres invisibles pour la Fresh Rotation`);
console.log(`Soirées à trackCount ≠ trackHistory    : ${nbTcFaux}/${rows.length}`);

// Datation de la bascule (ordre chronologique)
const chrono = rows.slice().reverse();
const saines = chrono.filter(r => r.delta === 0);
const zeros  = chrono.filter(r => r.n === 0);
if (saines.length) { const l = saines[saines.length - 1]; console.log(`\nDernière soirée SAINE : ${l.code} le ${d10(l.createdAt)} (${l.nTracks} titres, provider ${l.streamingProvider || '—'})`); }
if (zeros.length)  { console.log(`Première soirée à HPH = 0 : ${zeros[0].code} le ${d10(zeros[0].createdAt)} (provider ${zeros[0].streamingProvider || '—'})`); }

// ── Q1bis : le desync est-il corrélé au provider ? (test de l'hypothèse enum appleMusic) ──
console.log('\n── Desync par provider (test de l\'hypothèse enum appleMusic) ──');
const byProv = new Map();
for (const r of rows) {
  const k = r.streamingProvider || '(null)';
  if (!byProv.has(k)) byProv.set(k, { total: 0, zero: 0, titres: 0 });
  const e = byProv.get(k); e.total++; if (r.n === 0) { e.zero++; e.titres += r.nTracks; }
}
console.log(pad('provider', 14) + pad('soirées', 9) + pad('à HPH=0', 9) + 'titres perdus');
for (const [k, v] of [...byProv.entries()].sort((a, b) => b[1].total - a[1].total)) {
  console.log(pad(k, 14) + pad(v.total, 9) + pad(v.zero, 9) + v.titres);
}

// ── Q2bis : ampleur du compteur trackCount sur toute la base ──
const tc = await Party.aggregate([
  { $project: { trackCount: 1, real: { $size: { $ifNull: ['$trackHistory', []] } } } },
  { $match: { real: { $gt: 0 } } },
  { $group: { _id: null, total: { $sum: 1 },
      faux: { $sum: { $cond: [{ $ne: ['$trackCount', '$real'] }, 1, 0] } },
      zero: { $sum: { $cond: [{ $and: [{ $eq: ['$trackCount', 0] }, { $gt: ['$real', 0] }] }, 1, 0] } } } }
]).allowDiskUse(true);
console.log('\n══ Q2bis — compteur trackCount sur toute la base ══');
if (tc[0]) console.log(`${tc[0].total} soirées avec titres · trackCount faux : ${tc[0].faux} (${(tc[0].faux / tc[0].total * 100).toFixed(1)}%) · à 0 à tort : ${tc[0].zero}`);

// ── Q3 : photos sans uploaderUserId ──
console.log('\n══ Q3 — photos sans uploaderUserId ══');
const srcAll = await Photo.aggregate([{ $group: { _id: '$uploadSource', n: { $sum: 1 } } }]).allowDiskUse(true);
const srcNo  = await Photo.aggregate([{ $match: { uploaderUserId: null } }, { $group: { _id: '$uploadSource', n: { $sum: 1 } } }]).allowDiskUse(true);
console.log('uploadSource : sans owner / total');
for (const s of srcAll.sort((a, b) => b.n - a.n)) {
  const m = srcNo.find(x => x._id === s._id);
  console.log(`   ${pad(s._id || '(absent)', 12)} ${pad((m && m.n) || 0, 6)}/ ${s.n}`);
}

// ── Q4 : poids des documents Party (photos base64) — cause du Sort exceeded memory limit ──
console.log('\n══ Q4 — documents Party les plus lourds (risque BSON 16 Mo) ══');
const gros = await Party.aggregate([
  { $sort: { _id: -1 } },
  { $limit: 400 },
  { $project: { code: 1, createdAt: 1,
      nPhotos: { $size: { $ifNull: ['$photos', []] } },
      nDataUrl: { $size: { $filter: { input: { $ifNull: ['$photos', []] }, as: 'p', cond: { $ne: [{ $ifNull: ['$$p.dataURL', null] }, null] } } } },
      mo: { $divide: [{ $bsonSize: '$$ROOT' }, 1048576] } } },
  { $sort: { mo: -1 } },
  { $limit: 10 }
]).allowDiskUse(true);
console.log(pad('code', 8) + pad('date', 12) + pad('photos', 8) + pad('base64', 8) + 'taille');
for (const g of gros) console.log(pad(g.code, 8) + pad(d10(g.createdAt), 12) + pad(g.nPhotos, 8) + pad(g.nDataUrl, 8) + `${g.mo.toFixed(2)} Mo`);

await mongoose.disconnect();
