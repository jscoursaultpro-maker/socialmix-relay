#!/usr/bin/env node
/**
 * votes-check.mjs — Où passent les votes ? READ-ONLY STRICT.
 * Usage : node scripts/votes-check.mjs FTMP63
 *
 * Compare trois endroits où un vote peut exister :
 *   1. party.guestVotes          — ce que le serveur a REÇU et stocké (clé = titre)
 *   2. trackHistory[].fireCount  — ce qui a été COMMITÉ sur la piste (commitVotesForTrack)
 *   3. EventLog eventType=vote   — ce qui a été TRACÉ à la réception
 *
 * Un écart entre 1 et 2 prouve une perte à l'agrégation. commitVotesForTrack lit
 * party.guestVotes[guestId][titreExact] : toute différence de casse, d'apostrophe ou
 * d'espace entre le titre vu par l'invité et celui de l'historique perd le vote.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config({ quiet: true });

const CODE = (process.argv[2] || 'FTMP63').toUpperCase();
const load = async (f, n) => { const m = await import(`../models/${f}`); return m.default || (n && m[n]) || Object.values(m).find(v => v && v.modelName); };

await mongoose.connect(process.env.MONGODB_URI, { readPreference: 'primary' });
const Party = await load('Party.js');
const EventLg = await load('EventLog.js', 'EventLog');

const party = await Party.findOne({ code: CODE }).lean();
if (!party) { console.error(`Soirée ${CODE} introuvable`); await mongoose.disconnect(); process.exit(1); }

const pad = (s, n) => String(s ?? '—').padEnd(n).slice(0, n);
const gv = party.guestVotes || {};
const hist = [...(party.trackHistory || [])].reverse();

console.log(`\n══ ${CODE} — où sont les votes ? ══\n`);

// ── 1. Ce qui est STOCKÉ dans guestVotes ──
let totalStockes = 0;
const parVotant = [];
const titresVotes = new Map(); // titre -> [types]
for (const [gid, votes] of Object.entries(gv)) {
  if (!votes || typeof votes !== 'object') continue;
  const entrees = Object.entries(votes).filter(([k]) => !k.startsWith('_'));
  totalStockes += entrees.length;
  parVotant.push({ gid, nom: votes._guestName || '(sans nom)', n: entrees.length, détail: entrees });
  for (const [titre, type] of entrees) {
    if (!titresVotes.has(titre)) titresVotes.set(titre, []);
    titresVotes.get(titre).push({ gid, type });
  }
}

console.log(`1. STOCKÉS dans party.guestVotes : ${totalStockes} vote(s) par ${parVotant.length} votant(s)\n`);
console.log(pad('votant', 30) + pad('id', 28) + 'votes');
console.log('─'.repeat(70));
for (const v of parVotant.sort((a, b) => b.n - a.n)) {
  console.log(pad(v.nom, 30) + pad(v.gid, 28) + v.n);
}

// ── 2. Ce qui est COMMITÉ dans trackHistory ──
const commites = hist.filter(t => (t.fireCount || 0) + (t.likeCount || 0) + (t.mehCount || 0) > 0);
const totalCommites = commites.reduce((a, t) => a + (t.fireCount || 0) + (t.likeCount || 0) + (t.mehCount || 0), 0);
console.log(`\n2. COMMITÉS dans trackHistory : ${totalCommites} vote(s) sur ${commites.length} titre(s)\n`);
for (const t of commites) console.log(`   ${pad(t.title, 42)} 🔥${t.fireCount || 0} 👍${t.likeCount || 0} 👎${t.mehCount || 0}`);

// ── 3. Ce qui est TRACÉ dans EventLog ──
let evVotes = 0, evNote = '';
try {
  const ev = await EventLg.find({ partyCode: CODE, eventType: 'vote' }).lean();
  evVotes = ev.length;
  const dec = {};
  for (const e of ev) dec[e.decision || '(absent)'] = (dec[e.decision || '(absent)'] || 0) + 1;
  evNote = Object.entries(dec).map(([k, v]) => `${k}=${v}`).join(' · ');
} catch (e) { evNote = 'lecture impossible : ' + e.message; }
console.log(`\n3. TRACÉS dans EventLog : ${evVotes} événement(s) — ${evNote}`);
const age = Math.round((Date.now() - new Date(party.createdAt).getTime()) / 86400000);
if (evVotes === 0 && age > 30) console.log(`   (EventLog a un TTL de 30 jours, la soirée date de ${age} jours)`);

// ── VERDICT : écart stocké vs commité ──
console.log('\n' + '═'.repeat(70));
console.log(`STOCKÉS ${totalStockes}  →  COMMITÉS ${totalCommites}  →  ÉCART ${totalStockes - totalCommites}`);
console.log('═'.repeat(70));

if (totalStockes > totalCommites) {
  console.log('\n🚨 DES VOTES SE PERDENT À L\'AGRÉGATION.\n');
  console.log('Titre par titre — le vote est stocké sous ce libellé, et relu sous le titre');
  console.log('exact de l\'historique. S\'ils diffèrent, le vote n\'est jamais compté :\n');
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  for (const [titre, votes] of titresVotes) {
    const exact = hist.find(t => t.title === titre);
    const insensible = hist.find(t => (t.title || '').toLowerCase() === (titre || '').toLowerCase());
    const normalise = hist.find(t => norm(t.title) === norm(titre));
    let verdict;
    if (exact) {
      const c = (exact.fireCount || 0) + (exact.likeCount || 0) + (exact.mehCount || 0);
      verdict = c > 0 ? `✅ compté (${c})` : '🚨 titre exact trouvé mais 0 vote commité';
    } else if (insensible) verdict = `🚨 PERDU — diffère par la CASSE : historique = "${insensible.title}"`;
    else if (normalise) verdict = `🚨 PERDU — diffère par ponctuation/accent : historique = "${normalise.title}"`;
    else verdict = '🚨 PERDU — aucun titre correspondant dans l\'historique';
    console.log(`   "${titre}"`);
    console.log(`      ${votes.length} vote(s) [${votes.map(v => v.type).join(', ')}] → ${verdict}`);
  }
} else if (totalStockes === totalCommites && totalStockes > 0) {
  console.log('\n✅ Aucune perte : tout ce qui est stocké est commité.');
  console.log('   Le faible nombre de votes vient donc de ce qui a été ÉMIS, pas du serveur.');
} else if (totalStockes === 0) {
  console.log('\nAucun vote stocké : rien n\'a atteint le serveur.');
}

// ── Contexte : opportunités de vote ──
console.log(`\nContexte : ${hist.length} titres joués · ${(party.participants || []).filter(p => !p.isHost).length} invités`);
console.log(`Taux de participation au vote : ${hist.length ? ((commites.length / hist.length) * 100).toFixed(1) : 0}% des titres ont reçu au moins un vote`);

await mongoose.disconnect();
