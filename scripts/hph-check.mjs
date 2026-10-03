#!/usr/bin/env node
/**
 * hph-check.mjs — VÉRIFICATION MIGRATION HPH — READ-ONLY STRICT — v2
 * Usage : node scripts/hph-check.mjs FTMP63
 * Lecture sur PRIMARY (écarte tout retard de réplication) + tolère HPH vide.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config({ quiet: true });

console.log('### hph-check.mjs v2 — lecture PRIMARY ###');

const CODE = (process.argv[2] || 'FTMP63').toUpperCase();
const load = async (f, n) => { const m = await import(`../models/${f}`); return m.default || (n && m[n]) || Object.values(m).find(v => v && v.modelName); };

await mongoose.connect(process.env.MONGODB_URI, { readPreference: 'primary' });
const Party = await load('Party.js');
const HPH   = await load('HostPlaybackHistory.js');

const iso = d => { const t = new Date(d).getTime(); return Number.isFinite(t) ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : '—'; };
const pad = (s, n) => String(s === null || s === undefined ? '—' : s).padEnd(n).slice(0, n);
const group = (a, fn) => { const m = new Map(); for (const x of a) { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((x, y) => y[1] - x[1]); };

const party = await Party.findOne({ code: CODE }).lean();
if (!party) { console.error(`Soirée ${CODE} introuvable`); await mongoose.disconnect(); process.exit(1); }

const hist = [...(party.trackHistory || [])].reverse();
const hph  = await HPH.find({ $or: [{ partyId: party._id }, { partyCode: CODE }] }).sort({ playedAt: 1 }).lean();

console.log(`\n══ ${CODE} ══`);
console.log(`base             : ${mongoose.connection.name}`);
console.log(`party._id        : ${party._id}`);
console.log(`trackHistory     : ${hist.length}`);
console.log(`HPH              : ${hph.length}`);
console.log(`total base       : ${await Party.estimatedDocumentCount()} parties · ${await HPH.estimatedDocumentCount()} docs HPH`);

if (hph.length === 0) {
  console.log('\n🚨 AUCUN document HostPlaybackHistory pour cette soirée (lu sur le PRIMARY).');
  console.log('   La migration annoncée n\'existe pas dans cette base.\n');

  const since = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000);
  const recents = await HPH.find(
    { _id: { $gte: mongoose.Types.ObjectId.createFromTime(since) } },
    { partyCode: 1, title: 1, playedAt: 1, provider: 1 }
  ).lean();
  console.log(`── Docs HPH créés depuis 24 h, toutes soirées : ${recents.length}`);
  if (recents.length) {
    for (const [k, v] of group(recents, r => r.partyCode || '(sans partyCode)')) console.log(`   ${pad(k, 20)} ${v}`);
    console.log('   5 plus récents :');
    for (const r of recents.slice(-5)) console.log(`   ${pad(r.partyCode, 10)} ${pad(iso(r.playedAt), 20)} ${pad(r.provider, 12)} ${r.title}`);
  } else {
    console.log('   → aucune insertion HPH depuis 24 h, sur aucune soirée.');
  }

  const titres = hist.slice(0, 5).map(t => t.title).filter(Boolean);
  if (titres.length) {
    const orph = await HPH.find({ title: { $in: titres } }, { partyCode: 1, title: 1, playedAt: 1 }).lean();
    console.log(`\n── Docs HPH portant l'un des 5 premiers titres de la soirée : ${orph.length}`);
    for (const o of orph.slice(0, 10)) console.log(`   ${pad(o.partyCode, 10)} ${pad(iso(o.playedAt), 20)} ${o.title}`);
  }

  console.log('\n→ Les 98 titres restent uniquement dans party.trackHistory.');
  console.log('→ La Fresh Rotation cross-party ne les voit pas, et l\'AfterGlow affichera 0 titre.');
  await mongoose.disconnect();
  process.exit(0);
}

const hd = hist.map(t => new Date(t.playedAt).getTime()).filter(Number.isFinite);
const pd = hph.map(h => new Date(h.playedAt).getTime()).filter(Number.isFinite);
console.log('\n── Fenêtre temporelle ──');
if (hd.length) console.log(`trackHistory : ${iso(Math.min(...hd))} → ${iso(Math.max(...hd))}`);
if (pd.length) console.log(`HPH          : ${iso(Math.min(...pd))} → ${iso(Math.max(...pd))}`);
if (hd.length && pd.length) {
  const a = (Math.max(...hd) - Math.min(...hd)) / 60000, b = (Math.max(...pd) - Math.min(...pd)) / 60000;
  console.log(`durée couverte : trackHistory ${a.toFixed(0)} min · HPH ${b.toFixed(0)} min`);
  console.log(Math.abs(a - b) > 5
    ? `\n🚨 ÉCART ${Math.abs(a - b).toFixed(0)} min → les playedAt HPH ne reproduisent pas la soirée ; la tuile "durée" sera fausse.`
    : '\n✅ Chronologie HPH cohérente.');
}

const day = new Date(party.createdAt).toISOString().slice(0, 10);
const hors = hph.filter(h => new Date(h.playedAt).toISOString().slice(0, 10) !== day);
console.log(`\nHPH datés hors du jour de la soirée (${day}) : ${hors.length}/${hph.length}`);
for (const [d, n] of group(hors, h => new Date(h.playedAt).toISOString().slice(0, 10))) console.log(`   ${d} : ${n}`);

console.log('\n── Complétude des champs ──');
const champ = (f, t) => { const ok = hph.filter(t).length; console.log(`${pad(f, 22)} ${pad(ok + '/' + hph.length, 10)} ${ok === hph.length ? '✅' : (ok === 0 ? '🚨 aucun' : '⚠️  partiel')}`); };
champ('trackId (catalogue)', h => h.trackId);
champ('deezerTrackId', h => h.deezerTrackId);
champ('title', h => h.title);
champ('artist', h => h.artist);
champ('phase', h => h.phase);
champ('provider', h => h.provider);
champ('partyId', h => h.partyId);
champ('hostUserId', h => h.hostUserId);
champ('wasSuggestedByGuest', h => h.wasSuggestedByGuest === true);
champ('voteScore non nul', h => h.voteScore && (h.voteScore.feu || h.voteScore.cool || h.voteScore.bof));

console.log('\nprovider :', group(hph, h => h.provider || '(null)').map(([k, v]) => `${k}=${v}`).join(' · '));
console.log('phase    :', group(hph, h => h.phase || '(null)').map(([k, v]) => `${k}=${v}`).join(' · '));

const votes = hist.filter(t => (t.fireCount || 0) + (t.likeCount || 0) + (t.mehCount || 0) > 0);
console.log(`\nTracks avec votes dans trackHistory : ${votes.length}`);
for (const t of votes) {
  const m = hph.find(h => (h.title || '').toLowerCase().trim() === (t.title || '').toLowerCase().trim());
  const v = m && m.voteScore ? `${m.voteScore.feu || 0}/${m.voteScore.cool || 0}/${m.voteScore.bof || 0}` : (m ? '0/0/0' : 'ABSENT');
  console.log(`  ${pad(t.title, 38)} hist ${t.fireCount || 0}/${t.likeCount || 0}/${t.mehCount || 0}  →  HPH ${v}`);
}

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const sH = new Set(hph.map(h => norm(h.title))), sT = new Set(hist.map(t => norm(t.title)));
const miss = hist.filter(t => !sH.has(norm(t.title)));
console.log(`\nTitres de trackHistory absents de HPH : ${miss.length}`);
for (const t of miss.slice(0, 10)) console.log(`   - ${t.title} — ${t.artist}`);
const dup = group(hph, h => norm(h.title)).filter(([, n]) => n > 1);
console.log(`Titres en double dans HPH : ${dup.length}`);

const aff = hph.filter(h => (h.title && h.title.trim()) || (h.artist && h.artist.trim()));
console.log(`\nTracks qui passeront le guard iOS : ${aff.length}/${hph.length}`);
if (pd.length) { const s = (Math.max(...pd) - Math.min(...pd)) / 1000; console.log(`Durée affichée : ${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`); }

await mongoose.disconnect();
