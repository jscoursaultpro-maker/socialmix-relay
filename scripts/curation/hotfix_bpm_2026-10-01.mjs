// scripts/curation/hotfix_bpm_2026-10-01.mjs
// One-shot : corrige les 4 BPM half-time que import_outbox.mjs a conservés
// à tort (bpm_confidence='deezer_api' bloquait l'override Claude).
// Lire scripts/curation/hotfix_bpm_2026-10-01.md pour le contexte.

import mongoose from 'mongoose';
import Track from '../../models/Track.js';
import { connectMongo } from './lib.mjs';

const FIXES = [
  { _id: '6abd7a5366f916ca34e9642c', artist: 'Bob Marley & The Wailers', title: 'One Love / People Get Ready', bpm: 76,  note: 'reggae roots 70s, Deezer 152 = double-time' },
  { _id: '6abb73b4563dadf27fc8ad59', artist: 'Thierry Cham',             title: 'Ocean',                        bpm: 90,  note: 'zouk 2000, Deezer 179.8 = double-time' },
  { _id: '6abb729f563dadf27fc8ac50', artist: 'Slaï',                     title: 'Flamme (Radio Edit)',          bpm: 87,  note: 'zouk uptempo 2004, Deezer 173.71 = double-time' },
  { _id: '6aba76149c7c780f083d9969', artist: 'L.E.J',                    title: 'Summer 2015',                  bpm: 97,  note: 'medley a cappella 2015, Deezer 193.2 = double-time' }
];

await connectMongo();
console.log(`\n=== HOTFIX BPM 2026-10-01 — ${FIXES.length} tracks ===\n`);

for (const f of FIXES) {
  const t = await Track.findById(f._id);
  if (!t) { console.log(`❌ NOT FOUND ${f._id} (${f.artist})`); continue; }
  const before = t.bpm;
  t.bpm = f.bpm;
  t.bpmSource = 'claude_half_time_correction_2026-10-01';
  t.bpm_confidence = 'manual';
  t.lastReviewedAt = new Date();
  await t.save();
  console.log(`✅ ${f.artist} — ${f.title} : ${before} → ${f.bpm} (${f.note})`);
}

await mongoose.disconnect();
console.log('\n🔌 Déconnecté');
