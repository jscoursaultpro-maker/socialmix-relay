// scripts/curation/fix_doctrine_breach_2026-10-09.mjs
// Script one-shot — Requalification des 11 tracks en violation doctrine
// détectées par l'audit du 2026-10-08 (closing avec energy < 7, party low).
//
// Chaque correction est backup-ée dans MigrationBackup_CurationAuto avant écriture.
// Les tracks platine (isVerified=true) ne sont touchées qu'avec le flag
// --include-platine (arbitrage manuel Jean-Sé requis).
//
// Usage :
//   # Dry run (voir ce qui serait fait sans toucher la BDD)
//   node scripts/curation/fix_doctrine_breach_2026-10-09.mjs --dry-run
//
//   # Appliquer les 9 complete (sans toucher aux platine)
//   node scripts/curation/fix_doctrine_breach_2026-10-09.mjs
//
//   # Appliquer les 9 complete + les 2 platine (arbitrage Jean-Sé)
//   node scripts/curation/fix_doctrine_breach_2026-10-09.mjs --include-platine

import mongoose from 'mongoose';
import Track from '../../models/Track.js';
import { connectMongo } from './lib.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const DRY = arg('dry-run', false) === true;
const INCLUDE_PLATINE = arg('include-platine', false) === true;
const BACKUP_COLLECTION = 'MigrationBackup_CurationAuto';
const CLASSIFIED_BY = 'claude_doctrine_breach_fix_2026-10-09';

// ─── Corrections à appliquer ──────────────────────────────────────────
// Chaque entrée nomme uniquement les champs à modifier (pas d'écrasement
// des 25 champs curatoriaux). Mongoose n'écrit que les paths modifiés.
const FIXES = [
  // ─── CLOSING avec energy < 7 (5 tracks) ────────────────────────────
  {
    _id: '6a19b863391f5e1520f811e6', artist: 'Eminem', title: 'Lose Yourself',
    platine: true,  // isVerified=true, nécessite --include-platine
    changes: { energy: 8 },
    reason: 'Closing exige energy ≥ 7 (doctrine Memories). Hymne hip-hop intergénérationnel, energy réelle 8.',
  },
  {
    _id: '6a19b865391f5e1520f81248', artist: 'Camila Cabello', title: 'Havana',
    platine: true,
    changes: { phase: 'party', phaseAlternate: 'closing', energy: 8 },
    reason: 'Tube pop latin plus adapté party (peak) que closing (feu d\'artifice).',
  },
  {
    _id: '6a1e82bc391f5e1520fabc4e', artist: 'Karaoké Playback Français', title: 'Place des grands hommes (Karaoké playback instrumental)',
    changes: { phase: 'arrival', phaseAlternate: 'ambiance', isFiller: true, suggestable: false },
    reason: 'Instrumental karaoké : jamais closing (doctrine 8.2 covers). Arrival+isFiller+suggestable=false.',
  },
  {
    _id: '6a1f4178391f5e1520fb379f', artist: 'LINKIN PARK', title: 'Friendly Fire (Instrumental)',
    changes: { phase: 'takeoff', phaseAlternate: 'groove', isFiller: true, suggestable: false },
    reason: 'Instrumental : jamais closing (doctrine 8.2). Takeoff + isFiller + suggestable=false.',
  },
  {
    _id: '6a5647dc6da503a4c64e6880', artist: 'Luis Fonsi', title: 'Despacito',
    changes: { energy: 8 },
    reason: 'Notes DJ disent "feu d\'artifice sing-along garanti" mais energy=3 erreur : vraie energy 8.',
  },

  // ─── PARTY avec energy ≤ 6 (6 tracks) ──────────────────────────────
  {
    _id: '6a19b868391f5e1520f812be', artist: 'Indeep', title: 'Last Night a D.J. Saved My Life',
    changes: { energy: 8 },
    reason: 'Hotfix 03/10 dit "energy 8 feu d\'artifice", mais energy BDD à 6 : incohérence hotfix.',
  },
  {
    _id: '6a19b869391f5e1520f812c1', artist: 'KC & The Sunshine Band', title: 'That\'s the Way (I Like It)',
    changes: { energy: 8 },
    reason: 'Hotfix 03/10 dit "energy 8 feu d\'artifice", mais energy BDD à 6 : incohérence hotfix.',
  },
  {
    _id: '6a311e6e47123329cd45302d', artist: 'Bruno Mars', title: 'Treasure',
    changes: { energy: 7 },
    reason: 'Vrai party, energy réelle 7 (funk disco revival dansant).',
  },
  {
    _id: '6a19b865391f5e1520f81243', artist: 'Black Eyed Peas', title: 'Let\'s Get It Started',
    changes: { phase: 'takeoff', phaseAlternate: 'groove' },
    reason: 'Notes DJ dit "Warm-up efficace" → takeoff, pas party.',
  },
  {
    _id: '6a19b863391f5e1520f811f7', artist: 'Kris Kross', title: 'Jump',
    changes: { phase: 'groove', phaseAlternate: 'party' },
    reason: 'Old school rap warm-up : groove avec party en alternate.',
  },
  {
    _id: '6a1ea32d391f5e1520fad1af', artist: 'Alan Braxe & Fred Falke', title: 'Intro',
    changes: { qualityLevel: 'partielle', suggestable: false },
    reason: 'Anomalie structurelle (energy=0 mais qualityLevel=complete). Dé-promouvoir en partielle.',
  },
];

// ─── Main ─────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  console.log(`\n=== FIX DOCTRINE BREACH 2026-10-09 ===`);
  console.log(`Mode : ${DRY ? 'DRY RUN (aucune écriture)' : 'LIVE'}`);
  console.log(`Platine : ${INCLUDE_PLATINE ? 'INCLUS (--include-platine)' : 'EXCLU (par défaut)'}`);
  console.log(`Corrections prévues : ${FIXES.length}\n`);

  const db = await connectMongo();
  const backups = db.collection(BACKUP_COLLECTION);

  let applied = 0, skipped = 0, errored = 0;

  for (const fix of FIXES) {
    const prefix = `[${fix.artist}] ${fix.title}`;
    const track = await Track.findById(fix._id);
    if (!track) {
      console.log(`  ❌ NOT FOUND ${prefix} (_id ${fix._id})`);
      errored++;
      continue;
    }
    const isPlatine = track.isVerified === true;
    if (isPlatine && !INCLUDE_PLATINE) {
      console.log(`  ⏭️  SKIP ${prefix} : platine (isVerified=true) — relancer avec --include-platine`);
      skipped++;
      continue;
    }

    // Vérifier que les corrections prévues sont encore pertinentes
    const relevant = Object.entries(fix.changes).filter(([k, v]) => track[k] !== v);
    if (!relevant.length) {
      console.log(`  ✅ ALREADY OK ${prefix} : corrections déjà en BDD`);
      skipped++;
      continue;
    }

    // Backup des valeurs d'origine
    const before = {};
    for (const [k] of relevant) before[k] = track[k];

    const changesStr = relevant.map(([k, v]) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(v)}`).join(' ; ');

    if (DRY) {
      console.log(`  [DRY] ${isPlatine ? '🔒 ' : ''}${prefix} — ${changesStr}`);
    } else {
      try {
        await backups.insertOne({
          trackId: track._id,
          at: new Date(),
          classifiedBy: CLASSIFIED_BY,
          before,
          reason: `fix doctrine breach 2026-10-09 : ${fix.reason}`,
        });
        for (const [k, v] of relevant) track[k] = v;
        track.lastReviewedAt = new Date();
        await track.save();
        console.log(`  ✅ ${isPlatine ? '🔒 ' : ''}${prefix} — ${changesStr}`);
        applied++;
      } catch (err) {
        console.log(`  ❌ ERROR ${prefix} : ${err.message}`);
        errored++;
      }
    }
    if (DRY) applied++;
  }

  console.log(`\n→ Appliquées : ${applied} | Skippées : ${skipped} | Erreurs : ${errored}`);
  await mongoose.disconnect();
}
