#!/usr/bin/env node
/**
 * backfill-hph.mjs — Reconstruit HostPlaybackHistory depuis party.trackHistory.
 *
 * Contexte (audit 03/10/2026) : quatre causes ont empêché l'écriture des HPH —
 * enum provider divergent (appleMusic / youtube), compteurs non initialisés masquant
 * l'erreur, hostUserId non résolu quand hostProfile.email manque, et le chemin
 * host:liveTrackDetected qui n'écrivait aucun HPH. Résultat : 556 titres sur
 * 43 soirées absents de la source de vérité de la Fresh Rotation.
 *
 *   DRY-RUN (défaut) : node scripts/backfill-hph.mjs
 *   DRY-RUN ciblé    : node scripts/backfill-hph.mjs --code=FTMP63
 *   ÉCRITURE         : node scripts/backfill-hph.mjs --apply
 *   ÉCRITURE ciblée  : node scripts/backfill-hph.mjs --code=FTMP63 --apply
 *
 * Sans --apply, AUCUNE écriture n'est faite : le script affiche exactement ce qu'il
 * créerait. Les documents écrits portent backfilled:true pour rester distinguables
 * des enregistrements temps réel.
 *
 * Reprend de trackHistory les vraies valeurs : playedAt, phase, votes, suggestedBy,
 * identifiants provider. Aucune donnée n'est inventée : un champ absent reste null.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config({ quiet: true });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY  = (args.find(a => a.startsWith('--code=')) || '').split('=')[1]?.toUpperCase() || null;
const LIMIT = Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 200);

const load = async (f, n) => { const m = await import(`../models/${f}`); return m.default || (n && m[n]) || Object.values(m).find(v => v && v.modelName); };

await mongoose.connect(process.env.MONGODB_URI, { readPreference: 'primary' });
const Party = await load('Party.js');
const HPH   = await load('HostPlaybackHistory.js');
const Track = await load('Track.js');
const { normalizeProvider } = await import('../lib/providers.js');
const { resolveHostUserId } = await import('../lib/resolveHost.js');

const pad = (s, n) => String(s ?? '—').padEnd(n).slice(0, n);
const esc = s => (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const d10 = d => new Date(d).toISOString().slice(0, 10);

console.log(`\n${'='.repeat(78)}`);
console.log(APPLY ? '⚠️  MODE ÉCRITURE (--apply) — des documents vont être créés'
                  : '🔍 MODE DRY-RUN — aucune écriture, simulation seule');
console.log(`${'='.repeat(78)}\n`);

// Soirées candidates : au moins un titre joué
const match = ONLY ? { code: ONLY } : {};
const parties = await Party.aggregate([
  { $match: match },
  { $sort: { _id: -1 } },
  { $limit: LIMIT * 4 },
  { $project: { code: 1, createdAt: 1, hostUserId: 1, streamingProvider: 1, hostSecret: 1,
      participants: 1, hostProfile: 1,
      trackHistory: 1, nTracks: { $size: { $ifNull: ['$trackHistory', []] } } } },
  { $match: { nTracks: { $gt: 0 } } },
  { $limit: LIMIT }
]).allowDiskUse(true);

console.log(`${parties.length} soirée(s) avec au moins un titre joué.\n`);
console.log(pad('code', 8) + pad('date', 12) + pad('hist', 6) + pad('HPH', 6) + pad('à créer', 9) +
            pad('provider', 13) + pad('host', 6) + 'blocage');
console.log('─'.repeat(82));

let totalACreer = 0, totalEcrits = 0, totalBloques = 0, totalDejaOk = 0;
const viaCount = new Map();
const sansHost = [];

for (const p of parties) {
  const existants = await HPH.find({ $or: [{ partyId: p._id }, { partyCode: p.code }] })
    .select('title playedAt').lean();
  const vus = new Set(existants.map(h => `${(h.title || '').toLowerCase().trim()}|${new Date(h.playedAt).getTime()}`));

  const hist = [...(p.trackHistory || [])].reverse(); // chronologique
  const provider = normalizeProvider(p.streamingProvider);

  // Résolution du host par cascade : le champ direct, puis participants[isHost].userId,
  // puis hostProfile.email, puis le hostSecret d'une soirée sœur. On n'abandonne qu'après.
  const { userId: hostUserId, via } = await resolveHostUserId(p);
  viaCount.set(via, (viaCount.get(via) || 0) + 1);
  if (!hostUserId) {
    sansHost.push(p.code);
    totalBloques += hist.length;
    console.log(pad(p.code, 8) + pad(d10(p.createdAt), 12) + pad(hist.length, 6) + pad(existants.length, 6) +
                pad(0, 9) + pad(p.streamingProvider || '—', 13) + pad('NULL', 6) + 'host introuvable');
    continue;
  }

  const aCreer = [];
  for (const t of hist) {
    if (!t.title && !t.artist) continue;
    const playedAt = t.playedAt ? new Date(t.playedAt) : null;
    if (!playedAt || Number.isNaN(playedAt.getTime())) continue; // pas de date inventée
    if (vus.has(`${(t.title || '').toLowerCase().trim()}|${playedAt.getTime()}`)) continue;

    const deezerId = t.deezerId || t.deezerID || t.trackId;
    const numDeezer = (deezerId && !Number.isNaN(Number(deezerId))) ? Number(deezerId) : null;

    let trackId = null;
    if (numDeezer) trackId = (await Track.findOne({ 'providers.deezer.trackId': numDeezer }).select('_id').lean().catch(() => null))?._id || null;
    if (!trackId && t.title) {
      const q = { title: new RegExp('^' + esc(t.title.trim()) + '$', 'i') };
      const a = (t.artist || '').split(/[,&]/)[0].trim();
      if (a) q.artist = new RegExp(esc(a), 'i');
      trackId = (await Track.findOne(q).select('_id').lean().catch(() => null))?._id || null;
    }

    aCreer.push({
      hostUserId,
      trackId,
      partyId: p._id,
      partyCode: p.code,
      deezerTrackId: numDeezer,
      title:  t.title  || null,
      artist: t.artist || null,
      playedAt,                                   // ← vraie chronologie
      phase:  t.phase && t.phase !== 'unknown' ? t.phase : undefined,
      wasSuggestedByGuest: !!t.suggestedBy,
      suggestedBy: t.suggestedBy || null,
      provider,
      voteScore: { feu: t.fireCount || 0, cool: t.likeCount || 0, bof: t.mehCount || 0 },
      backfilled: true
    });
  }

  totalACreer += aCreer.length;
  if (aCreer.length === 0) totalDejaOk++;

  let note = '';
  if (APPLY && aCreer.length) {
    try {
      const r = await HPH.insertMany(aCreer, { ordered: false });
      totalEcrits += r.length;
      note = `✅ ${r.length} écrits`;
    } catch (e) {
      const ok = e.result?.result?.nInserted ?? e.insertedDocs?.length ?? 0;
      totalEcrits += ok;
      note = `⚠️  ${ok} écrits, ${(e.writeErrors || []).length} rejets`;
      for (const we of (e.writeErrors || []).slice(0, 2)) console.log(`      rejet: ${we.errmsg?.slice(0, 120)}`);
    }
  }

  console.log(pad(p.code, 8) + pad(d10(p.createdAt), 12) + pad(hist.length, 6) + pad(existants.length, 6) +
              pad(aCreer.length, 9) + pad(p.streamingProvider || '—', 13) + pad(via === 'party.hostUserId' ? 'ok' : '~', 6) + note);
}

console.log('\n' + '─'.repeat(82));
console.log(`Documents à créer      : ${totalACreer}`);
if (APPLY) console.log(`Documents écrits       : ${totalEcrits}`);
console.log(`Soirées déjà complètes : ${totalDejaOk}`);
console.log('\nRésolution du hostUserId par chemin :');
for (const [k, v] of [...viaCount.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${pad(k, 28)} ${v} soirée(s)`);
console.log(`\nTitres bloqués         : ${totalBloques}${sansHost.length ? ` (hostUserId absent sur ${sansHost.length} soirée(s) : ${sansHost.slice(0, 8).join(', ')}${sansHost.length > 8 ? '…' : ''})` : ''}`);

if (!APPLY) {
  console.log('\n🔍 DRY-RUN terminé — rien n\'a été écrit.');
  console.log('   Pour appliquer : node scripts/backfill-hph.mjs --apply');
} else {
  console.log('\n✅ Migration terminée. Vérification : node scripts/hph-check.mjs FTMP63');
}
if (sansHost.length) {
  console.log('\n⚠️  Soirées dont le host reste introuvable même après la cascade complète');
  console.log('   (hostUserId, participants[isHost].userId, hostProfile.email, hostSecret) :');
  console.log('   ' + sansHost.join(', '));
  console.log('   Leur rattacher un host est une décision à part — pas un backfill.');
}

await mongoose.disconnect();
