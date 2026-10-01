// scripts/curation/hotfix_memories_2026-10-01.mjs
// One-shot : re-place Bob Marley "One Love" en phase=arrival (madeleine d'ouverture)
// suite à la clarification doctrine Memories du 01/10/2026.
//
// Bob Marley One Love était en closing/arrival avec energy=5, BPM=76. La nouvelle règle
// closing = feu d'artifice haute énergie (7-10) + hymnes chantés. Une ballade reggae roots
// émotionnelle à 76 BPM est exactement l'archétype "arrival" (apéro, madeleine douce)
// cf. DRAMATURGIE_MEMORIES.md §2 et DOCTRINE_PREMIUM_V2.md §7.1 réécrit.

import mongoose from 'mongoose';
import Track from '../../models/Track.js';
import { connectMongo } from './lib.mjs';

const FIXES = [
  {
    _id: '6abd7a5366f916ca34e9642c',
    artist: 'Bob Marley & The Wailers',
    title: 'One Love / People Get Ready',
    changes: {
      phase: 'arrival',
      phaseAlternate: 'ambiance',
      // energy, bpm, mood, isEmotional restent inchangés — ils étaient déjà cohérents arrival
      // mais la phase closing était fausse (feu d'artifice haute énergie seulement)
      notes: "Hymne reggae roots 1977 (album Exodus), ballade émotionnelle BPM 76. Doctrine Memories (01/10) : arrival = madeleine douce d'ouverture ; closing = feu d'artifice haute énergie. One Love est exactement le profil arrival (ouverture apéro émotionnelle, tempo lent, familière). phaseAlternate ambiance pour tempo mid-chill. CORRECTION BPM : Deezer renvoie 152 (double-time), vrai tempo reggae 76 BPM.",
      justification: "arrival doctrine Memories : ballade émotionnelle d'ouverture (Bill Withers 'Lovely Day' pattern)."
    }
  }
];

await connectMongo();
console.log('\n=== HOTFIX MEMORIES 2026-10-01 — ' + FIXES.length + ' tracks ===\n');

for (const f of FIXES) {
  const t = await Track.findById(f._id);
  if (!t) { console.log(`❌ NOT FOUND ${f._id} (${f.artist})`); continue; }
  const before = { phase: t.phase, phaseAlternate: t.phaseAlternate };
  Object.assign(t, f.changes);
  t.lastReviewedAt = new Date();
  await t.save();
  console.log(`✅ ${f.artist} — ${f.title}`);
  console.log(`   phase: ${before.phase} → ${t.phase}`);
  console.log(`   phaseAlternate: ${before.phaseAlternate} → ${t.phaseAlternate}`);
}

await mongoose.disconnect();
console.log('\n🔌 Déconnecté');
