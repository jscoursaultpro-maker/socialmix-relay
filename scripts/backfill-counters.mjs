#!/usr/bin/env node
/**
 * backfill-counters.mjs — Recalcule trackCount / participantCount / photoCount.
 *
 * Contexte (audit 03/10/2026) : ces compteurs dénormalisés ne sont maintenus que par
 * le pre('save') de Party.js, qui ne se déclenche jamais sur les écritures atomiques
 * ($push / updateOne) utilisées en production. 158 soirées portent trackCount = 0
 * alors que trackHistory contient des dizaines de titres.
 *
 * Ce n'est pas qu'un défaut d'affichage. /api/host/parties/by-user (server.js L4032)
 * filtre sur les champs STOCKÉS avant de les recalculer :
 *
 *     { $match: { participantCount: { $gte: 3 }, trackCount: { $gte: 20 }, ... } }
 *
 * Une soirée à trackCount = 0 est donc exclue du rafraîchissement AfterGlow côté
 * serveur, quel que soit son contenu réel.
 *
 *   DRY-RUN (défaut) : node scripts/backfill-counters.mjs
 *   ÉCRITURE         : node scripts/backfill-counters.mjs --apply
 *
 * Les valeurs écrites sont recalculées depuis les tableaux eux-mêmes — aucune
 * estimation, aucune valeur inventée.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config({ quiet: true });

const APPLY = process.argv.includes('--apply');
const load = async (f, n) => { const m = await import(`../models/${f}`); return m.default || (n && m[n]) || Object.values(m).find(v => v && v.modelName); };

await mongoose.connect(process.env.MONGODB_URI, { readPreference: 'primary' });
const Party = await load('Party.js');
const Photo = await load('Photo.js', 'Photo');

const pad = (s, n) => String(s ?? '—').padEnd(n).slice(0, n);
const d10 = d => new Date(d).toISOString().slice(0, 10);

console.log(`\n${'='.repeat(74)}`);
console.log(APPLY ? '⚠️  MODE ÉCRITURE (--apply)' : '🔍 MODE DRY-RUN — aucune écriture');
console.log(`${'='.repeat(74)}\n`);

// Soirées dont au moins un compteur diverge du contenu réel
const divergentes = await Party.aggregate([
  { $project: {
      code: 1, createdAt: 1,
      trackCount: 1, participantCount: 1, photoCount: 1,
      realTracks: { $size: { $ifNull: ['$trackHistory', []] } },
      realParts:  { $size: { $ifNull: ['$participants', []] } }
  } },
  { $match: { $or: [
      { $expr: { $ne: ['$trackCount', '$realTracks'] } },
      { $expr: { $ne: ['$participantCount', '$realParts'] } }
  ] } },
  { $sort: { createdAt: -1 } }
]).allowDiskUse(true);

console.log(`${divergentes.length} soirée(s) avec au moins un compteur faux.\n`);
console.log(pad('code', 8) + pad('date', 12) + pad('tracks', 16) + pad('participants', 18) + 'visible AfterGlow');
console.log('─'.repeat(74));

let nbEcrits = 0, nbRedevientVisibles = 0;
const SEUIL_TRACKS = 20, SEUIL_PARTS = 3; // seuils du $match de by-user

for (const p of divergentes) {
  const photoReal = await Photo.countDocuments({ partyCode: p.code, deletedAt: null });

  // Visibilité dans /api/host/parties/by-user, avant puis après correction
  const avant  = (p.trackCount >= SEUIL_TRACKS) && (p.participantCount >= SEUIL_PARTS);
  const apres  = (p.realTracks >= SEUIL_TRACKS) && (p.realParts >= SEUIL_PARTS);
  if (!avant && apres) nbRedevientVisibles++;

  const vis = avant === apres ? (apres ? 'oui' : 'non')
            : (apres ? '✅ redevient visible' : '⚠️  deviendrait invisible');

  console.log(
    pad(p.code, 8) + pad(d10(p.createdAt), 12) +
    pad(`${p.trackCount ?? '—'} → ${p.realTracks}`, 16) +
    pad(`${p.participantCount ?? '—'} → ${p.realParts}`, 18) + vis
  );

  if (APPLY) {
    // updateOne : ne touche que ces trois champs, aucun autre document n'est relu
    await Party.updateOne({ _id: p._id }, { $set: {
      trackCount: p.realTracks,
      participantCount: p.realParts,
      photoCount: photoReal
    } });
    nbEcrits++;
  }
}

console.log('\n' + '─'.repeat(74));
console.log(`Soirées concernées            : ${divergentes.length}`);
console.log(`Redeviennent visibles AfterGlow : ${nbRedevientVisibles}  (seuils by-user : ${SEUIL_TRACKS} titres, ${SEUIL_PARTS} participants)`);
if (APPLY) console.log(`Documents mis à jour          : ${nbEcrits}`);
else console.log('\n🔍 DRY-RUN terminé — rien n\'a été écrit.\n   Pour appliquer : node scripts/backfill-counters.mjs --apply');

console.log('\nNote : lancer ce script APRÈS backfill-hph.mjs n\'change rien aux compteurs');
console.log('(ils comptent trackHistory, pas HostPlaybackHistory) — l\'ordre est libre.');

await mongoose.disconnect();
