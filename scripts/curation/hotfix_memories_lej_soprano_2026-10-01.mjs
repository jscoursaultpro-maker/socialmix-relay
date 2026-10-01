// scripts/curation/hotfix_memories_lej_soprano_2026-10-01.mjs
// One-shot : 2 corrections post-doctrine Memories, décidées par Jean-Sé 01/10/2026.
//
// L.E.J "Summer 2015" : was takeoff e7 BPM 97 → ambiance e6 (on ne danse pas,
//   on écoute/chante le medley a cappella viral FR 2015). BPM 97 cohérent avec
//   bande ambiance 80-115. Energy 6 cohérent avec bande 5-6.5.
//
// Soprano "En feu" : was takeoff e7 BPM 118 → closing (phaseAlternate party).
//   BPM 118 est trop bas pour party (bande 120-135) mais la doctrine Memories
//   accepte BPM flexible en closing. Hit radio FR 2016 singalong = Memories.

import mongoose from 'mongoose';
import Track from '../../models/Track.js';
import { connectMongo } from './lib.mjs';

const FIXES = [
  {
    _id: '6aba76149c7c780f083d9969',
    artist: 'L.E.J',
    title: 'Summer 2015',
    changes: {
      phase: 'ambiance',
      phaseAlternate: 'takeoff',
      energy: 6,
      isBanger: false,  // was true. Reclassement MOMENT : en ambiance, pas un banger (banger = +80 dans sa phase)
      tags: ['warm-up', 'sing-along', 'memory-lane'],  // était closing/singalong
      partyMoment: 'warm-up',
      notes: "L.E.J 'Summer 2015' = medley a cappella viral FR été 2015 (Avicii/Fetty Wap/Major Lazer). Reconnu par toute une génération FR, repris en chœur. Doctrine Memories (01/10) : ambiance = warm-up chaleureux car on écoute/chante, on ne danse pas (medley a cappella sans drop techno). BPM 97 cohérent ambiance 80-115, energy 6 cohérent 5-6.5. CORRECTION BPM : Deezer 193.2 = double-time, vrai 97 (medley a cappella).",
      justification: "ambiance medley a cappella FR singalong, pas banger (on chante, pas on danse)."
    }
  },
  {
    _id: '6ab983fd9c7c780f083c828f',
    artist: 'Soprano',
    title: 'En feu',
    changes: {
      phase: 'closing',
      phaseAlternate: 'party',
      // energy 7 et BPM 118 restent — doctrine Memories accepte BPM flexible en closing
      tags: ['closing', 'sing-along', 'banger-crowd', 'memory-lane', 'danceable'],
      partyMoment: 'closing',
      notes: "Soprano 'En feu' extrait L'Everest Deluxe (2016). Hit radio FR 2016-2017 platine, refrain 'en feu' repris en salle. Doctrine Memories (01/10) : closing = feu d'artifice hymnes chantés — Soprano En feu coche sing-along + banger-crowd FR. BPM 118 un peu bas pour party (120-135) mais closing accepte BPM flexible. phaseAlternate party pour fin de peak.",
      justification: "closing Memories FR : hymne singalong 2016, memory-lane FR mixte 20-45."
    }
  }
];

await connectMongo();
console.log('\n=== HOTFIX MEMORIES L.E.J + Soprano 2026-10-01 — ' + FIXES.length + ' tracks ===\n');

for (const f of FIXES) {
  const t = await Track.findById(f._id);
  if (!t) { console.log(`❌ NOT FOUND ${f._id} (${f.artist})`); continue; }
  const before = { phase: t.phase, phaseAlternate: t.phaseAlternate, energy: t.energy, isBanger: t.isBanger };
  Object.assign(t, f.changes);
  t.lastReviewedAt = new Date();
  await t.save();
  console.log(`✅ ${f.artist} — ${f.title}`);
  console.log(`   phase: ${before.phase}/${before.phaseAlternate} → ${t.phase}/${t.phaseAlternate}`);
  console.log(`   energy: ${before.energy} → ${t.energy}`);
  console.log(`   isBanger: ${before.isBanger} → ${t.isBanger}`);
}

await mongoose.disconnect();
console.log('\n🔌 Déconnecté');
