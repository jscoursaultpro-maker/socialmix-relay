// scripts/curation/hotfix_closing_memories_2026-10-03.mjs
// Doctrine Memories 01/10 — closing = feu d'artifice (energy ≥ 7, hymnes sing-along).
// Les tracks closing avec energy < 7 sont des "clôtures qui calment" → à ventiler ailleurs.
//
// 41 tracks (40 reclassements phase + 1 requalif intrinsèque Vangelis).
// Exclues : les 2 isVerified=true (Eminem Lose Yourself + Camila Cabello Havana) → revue manuelle.
//
// Chaque update :
// 1) Snapshot le doc complet dans MigrationBackup_CurationAuto (audit + rollback).
// 2) $set les champs qualif (phase, phaseAlternate, energy si bump, isBanger si corrigé, notes, bpm si half-time).
// 3) $set classifiedBy='claude_batch_auto_memories_2026-10-03', lastReviewedAt=now.
// Jamais touché : isVerified, isBlocked, suggestable, performance.*, votes, HPH.

import mongoose from 'mongoose';
import { connectMongo } from './lib.mjs';

const DRY = process.env.DRY_RUN === '1';
const CLASSIFIED_BY = 'claude_batch_auto_memories_2026-10-03';
const NOTE_PREFIX = '[hotfix doctrine Memories 2026-10-03] closing → ';

/**
 * Map des 41 updates. Chaque entrée :
 *   _id      : ObjectId str
 *   phase    : nouvelle phase
 *   phaseAlt : adjacent
 *   bumpEnergy: optionnel — nouvelle energy
 *   fixBanger: optionnel — nouvelle isBanger
 *   fixBpm   : optionnel — nouveau BPM (half-time)
 *   note     : résumé décision
 */
const FIXES = [
  // === VANGELIS (requalif intrinsèque, isBlocked NON touché) ===
  { _id: '6a311e6747123329cd452fa8', phase: 'arrival', phaseAlt: 'ambiance',
    bumpEnergy: 3, fixBanger: false, fixBpm: 77,
    note: 'Vangelis Love Theme — BO Blade Runner contemplative, pas feu d\'artifice. Hors scope AhOuai (banni Jean-Sé 2026-07-15).' },

  // === ARRIVAL (madeleine douce) — 35 tracks ===
  { _id: '6a311e7d47123329cd45315d', phase: 'arrival', phaseAlt: 'ambiance', note: 'Alberto Ciccarini Diamonds — ballade chill emo' },
  { _id: '6a19b86f391f5e1520f813ac', phase: 'arrival', phaseAlt: 'ambiance', note: 'Alicia Keys No One — ballade R&B 2000s' },
  { _id: '6a311e7047123329cd45305e', phase: 'arrival', phaseAlt: 'ambiance', note: 'Andy Bey Celestial Blues — downtempo jazz' },
  { _id: '6a311e6c47123329cd453010', phase: 'arrival', phaseAlt: 'ambiance', note: 'Bill Medley Time Of My Life — slow Dirty Dancing' },
  { _id: '6a311e6f47123329cd45303d', phase: 'arrival', phaseAlt: 'ambiance', fixBanger: false, note: 'Bill Withers Who Is He — soul 70s doux, pas banger' },
  { _id: '6a19c65f08bc2ea1d28887dc', phase: 'arrival', phaseAlt: 'ambiance', note: 'Bon Entendeur Le temps est bon — reprise chill FR' },
  { _id: '6a1ec8ad391f5e1520faf045', phase: 'arrival', phaseAlt: 'ambiance', note: 'Bruce Springsteen Streets of Philadelphia — ballade culte' },
  { _id: '6a311e6c47123329cd453007', phase: 'arrival', phaseAlt: 'ambiance', note: 'Bruno Mars Grenade — ballade pop emo' },
  { _id: '6a19b870391f5e1520f813d3', phase: 'arrival', phaseAlt: 'ambiance', note: 'CKay love nwantiti — afrobeat chill emo' },
  { _id: '6a19c65f08bc2ea1d28887da', phase: 'arrival', phaseAlt: 'ambiance', note: 'Camila Cabello Bam Bam — ballade latin pop' },
  { _id: '6a311e7047123329cd453051', phase: 'arrival', phaseAlt: 'ambiance', note: 'Ed Sheeran Thinking Out Loud — slow mariage' },
  { _id: '6a311e6f47123329cd453050', phase: 'arrival', phaseAlt: 'ambiance', note: 'Ed Sheeran Photograph — ballade acoustique' },
  { _id: '6a1cc867391f5e1520f95637', phase: 'arrival', phaseAlt: 'ambiance', note: 'Francis Cabrel La cabane du pêcheur — chanson FR 90s doux' },
  { _id: '6a1ee4e5391f5e1520fb0a8c', phase: 'arrival', phaseAlt: 'ambiance', note: 'Francis Cabrel Je t\'aimais — ballade culte FR' },
  { _id: '6a311e6f47123329cd453044', phase: 'arrival', phaseAlt: 'ambiance', note: 'Francis Cabrel Animal — ballade FR 2010s' },
  { _id: '6a19b86f391f5e1520f813a9', phase: 'arrival', phaseAlt: 'ambiance', note: 'Frank Ocean Nights — R&B contemplatif' },
  { _id: '6a1ede28391f5e1520fb05c2', phase: 'arrival', phaseAlt: 'ambiance', note: 'Henrique & Juliano Amigo Da Minha Saudade — sertanejo emo' },
  { _id: '6a1f1eef391f5e1520fb2b14', phase: 'arrival', phaseAlt: 'ambiance', note: 'Jean-Jacques Goldman Et l\'on n\'y peut rien — chanson FR 80s emo' },
  { _id: '6a1f360a391f5e1520fb32b9', phase: 'arrival', phaseAlt: 'ambiance', note: 'Juliette Armanet Qu\'importe — ballade FR 2020s' },
  { _id: '6a1f7e37391f5e1520fb52c7', phase: 'arrival', phaseAlt: 'ambiance', note: 'Julliany Souza Quem É Esse — gospel sertanejo emo' },
  { _id: '6a311e6547123329cd452f86', phase: 'arrival', phaseAlt: 'ambiance', note: 'L5 Toutes les femmes de ta vie — pop FR douce' },
  { _id: '6a1e01d5391f5e1520fa7335', phase: 'arrival', phaseAlt: 'ambiance', note: 'Lady Gaga Die With A Smile — ballade duo Bruno Mars' },
  { _id: '6a19b868391f5e1520f812a3', phase: 'arrival', phaseAlt: 'ambiance', note: 'Lewis Capaldi Wish You The Best — ballade pop emo' },
  { _id: '6a311e7447123329cd4530aa', phase: 'arrival', phaseAlt: 'ambiance', note: 'London Grammar Wasting My Young Years — indie emo' },
  { _id: '6a1e84af391f5e1520fabd7a', phase: 'arrival', phaseAlt: 'ambiance', note: 'Patrick Bruel Alors regarde — chanson FR 80s emo' },
  { _id: '6a311e7447123329cd4530ac', phase: 'arrival', phaseAlt: 'ambiance', note: 'Peter von Poehl Story of the Impossible — indie emo' },
  { _id: '6a311e7247123329cd45307e', phase: 'ambiance', phaseAlt: 'takeoff', note: 'Phil Collins You Can\'t Hurry Love — reprise Supremes mid-tempo fun' },
  { _id: '6a1ecb89391f5e1520faf1f1', phase: 'arrival', phaseAlt: 'ambiance', note: 'Robert Miles Children — trance ambient emo 90s' },
  { _id: '6a311e6c47123329cd453008', phase: 'arrival', phaseAlt: 'ambiance', fixBanger: false, note: 'Salif Keïta Yamore — mandingue emo, pas banger' },
  { _id: '6a311e6247123329cd452f49', phase: 'arrival', phaseAlt: 'ambiance', note: 'Sandy Beach Another Life — chill ambient (déjà vu lot d)' },
  { _id: '6a19c65f08bc2ea1d28887d7', phase: 'arrival', phaseAlt: 'ambiance', fixBanger: false, note: 'Shakira Copa Vacía — ballade latin emo, pas banger' },
  { _id: '6a311e7047123329cd45305d', phase: 'arrival', phaseAlt: 'ambiance', note: 'The Weeknd Earned It — Fifty Shades slow' },
  { _id: '6a2fb48e95c1a11a66caecb6', phase: 'arrival', phaseAlt: 'ambiance', note: 'Tom Odell Another Love — ballade piano culte' },
  { _id: '6a19b86e391f5e1520f81388', phase: 'arrival', phaseAlt: 'ambiance', note: 'Tyler The Creator See You Again feat Kali Uchis — hip-hop chill emo' },
  { _id: '6a311e7047123329cd453061', phase: 'arrival', phaseAlt: 'ambiance', note: 'Wiz Khalifa See You Again — ballade Furious 7' },

  // === GROOVE / TAKEOFF (pas closing, mais pas ballade non plus) — 3 tracks ===
  { _id: '6a19b86f391f5e1520f813b3', phase: 'groove', phaseAlt: 'takeoff', note: 'DJ Khaled Wild Thoughts — hip-hop groove mid-tempo' },
  { _id: '6a19b864391f5e1520f81202', phase: 'groove', phaseAlt: 'takeoff', note: 'Notorious B.I.G. Hypnotize — hip-hop classic groove' },
  { _id: '6a19b868391f5e1520f812b2', phase: 'takeoff', phaseAlt: 'groove', note: 'Stromae Tous Les Mêmes — french pop dansable' },

  // === PARTY / CLOSING hymnes feu d'artifice (disco banger bump energy) — 2 tracks ===
  { _id: '6a19b868391f5e1520f812be', phase: 'party', phaseAlt: 'closing', bumpEnergy: 8,
    note: 'Indeep Last Night a D.J. Saved My Life — hymne disco 80s culte, energy 8 feu d\'artifice OK closing' },
  { _id: '6a19b869391f5e1520f812c1', phase: 'party', phaseAlt: 'closing', bumpEnergy: 8,
    note: 'KC & The Sunshine Band That\'s the Way I Like It — hymne disco 70s, energy 8 feu d\'artifice OK closing' },
];

console.log(`\n=== HOTFIX CLOSING MEMORIES 2026-10-03 — ${FIXES.length} tracks ${DRY ? '(DRY RUN)' : ''} ===\n`);

const db = await connectMongo();
const tracks = db.collection('tracks');
const backup = db.collection('MigrationBackup_CurationAuto');

let applied = 0;
let skipped_notfound = 0;
let skipped_verified = 0;

for (const fix of FIXES) {
  const _id = new mongoose.Types.ObjectId(fix._id);
  const before = await tracks.findOne({ _id });
  if (!before) {
    console.log(`❌ NOT FOUND  ${fix._id}  ${fix.note.slice(0, 60)}`);
    skipped_notfound++;
    continue;
  }
  // Garde-fou absolu : jamais toucher à un verified
  if (before.isVerified === true) {
    console.log(`🛡️  VERIFIED skip  ${before.artist} — ${before.title}  (platine intouchable)`);
    skipped_verified++;
    continue;
  }

  // Construction du $set
  const set = {
    phase: fix.phase,
    phaseAlternate: fix.phaseAlt,
    classifiedBy: CLASSIFIED_BY,
    lastReviewedAt: new Date(),
  };
  if (typeof fix.bumpEnergy === 'number') set.energy = fix.bumpEnergy;
  if (typeof fix.fixBanger === 'boolean') set.isBanger = fix.fixBanger;
  if (typeof fix.fixBpm === 'number') set.bpm = fix.fixBpm;

  // Nouvelle note : conserver anciennes notes utiles + préfixe hotfix
  const prevNotes = (before.notes || '').trim();
  const marker = `${NOTE_PREFIX}${fix.phase} — ${fix.note}`;
  set.notes = prevNotes
    ? (prevNotes.includes(NOTE_PREFIX) ? prevNotes : `${prevNotes}\n${marker}`)
    : marker;

  if (DRY) {
    console.log(`[DRY] ${before.artist} — ${before.title}  |  phase ${before.phase}→${fix.phase}  energy ${before.energy}${set.energy !== undefined ? '→'+set.energy : ''}  banger ${before.isBanger}${set.isBanger !== undefined ? '→'+set.isBanger : ''}`);
    applied++;
    continue;
  }

  // 1. Backup snapshot complet
  await backup.insertOne({
    _snapshotAt: new Date(),
    _hotfix: 'closing_memories_2026-10-03',
    _originalId: before._id,
    doc: before,
  });
  // 2. Update
  await tracks.updateOne({ _id }, { $set: set });
  applied++;
  console.log(`✅ ${before.artist} — ${before.title}  |  ${before.phase}→${fix.phase}${set.energy !== undefined ? '  e='+before.energy+'→'+set.energy : ''}${set.isBanger !== undefined ? '  banger='+before.isBanger+'→'+set.isBanger : ''}${set.bpm !== undefined ? '  bpm='+before.bpm+'→'+set.bpm : ''}`);
}

console.log(`\n=== BILAN ===`);
console.log(`Appliqués                 : ${applied}`);
console.log(`Skippés (not found)       : ${skipped_notfound}`);
console.log(`Skippés (verified)        : ${skipped_verified}`);
console.log(`Total prévu               : ${FIXES.length}`);

await mongoose.disconnect();
