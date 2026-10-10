// scripts/curation/fix_boom_elea_2026-10-10.mjs
// Script one-shot — Corrections BDD en préparation de la boom Eléa 11/10/2026
//
// Cible 10 tracks :
//   - 3 "vide" à qualifier (Birds of a Feather, Houdini, Uptown Funk Mark Ronson)
//   - 3 corrections de classif (Espresso, Sur la lune bpm, APT phaseAlternate)
//   - 2 doublons à neutraliser (APT ROSÉ&Bruno, Sapés Niska Pilule Bleue)
//   - 1 flag anomalie platine (Blinding Lights energy=5 incohérent → log seulement)
//   - 1 OK Golden (déjà bien)
//
// isVerified=true (platine) non-touchable auto (doctrine qualityLevel).
// Backup intégral dans MigrationBackup_CurationAuto.
//
// Usage :
//   node scripts/curation/fix_boom_elea_2026-10-10.mjs --dry-run
//   node scripts/curation/fix_boom_elea_2026-10-10.mjs
//   node scripts/curation/fix_boom_elea_2026-10-10.mjs --include-platine

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
const CLASSIFIED_BY = 'claude_boom_elea_fix_2026-10-10';

const FIXES = [
  // ─── Tracks vides à qualifier (3) ───────────────────────────────────
  {
    _id: '6a30a67295c1a11a66cbafdc', artist: 'Billie Eilish', title: 'Birds of a Feather',
    changes: {
      qualityLevel: 'complete', phase: 'ambiance', phaseAlternate: 'arrival',
      energy: 5, bpm: 104, danceability: 0.56, mood: 'emotional', language: 'EN',
      hasLyrics: true, explicit: false, isBanger: false, isSingalong: true, isEmotional: true,
      isCaliente: false, isHardcore: false, isFiller: false, suggestable: true,
      era: '2020s', releaseYear: 2024, uiCategoryPrimary: 'Pop', uiCategoriesSecondary: ['Chill'],
      genre: 'Pop', tags: ['sing-along', 'memory-lane'], partyMoment: 'warm-up',
      cooldownDays: 14, confidence: 'high',
      confidence_notes: 'Viral TikTok 2024 ultra-connu pré-ados, ambiance mélancolique dansante safe pour ouverture ou respiration.',
    },
    reason: 'Track vide à qualifier — pop ballade virale TikTok, pile ambiance pour pré-ados 11 ans.',
  },
  {
    _id: '6abb70e8563dadf27fc8a9b2', artist: 'Dua Lipa', title: 'Houdini',
    changes: {
      qualityLevel: 'complete', phase: 'groove', phaseAlternate: 'party',
      energy: 7, bpm: 103, danceability: 0.78, mood: 'fun', language: 'EN',
      hasLyrics: true, explicit: false, isBanger: true, isSingalong: true, isEmotional: false,
      isCaliente: false, isHardcore: false, isFiller: false, suggestable: true,
      era: '2020s', releaseYear: 2023, uiCategoryPrimary: 'Dance', uiCategoriesSecondary: ['Pop'],
      genre: 'Pop', tags: ['danceable', 'sing-along'], partyMoment: 'peak',
      cooldownDays: 14, confidence: 'high',
      confidence_notes: 'Dance-pop Dua Lipa 2023, refrain fédérateur, piste pleine garantie en groove-party.',
    },
    reason: 'Track vide à qualifier — Dua Lipa Houdini, pile groove-party pour boom pré-ados.',
  },
  {
    _id: '6a23260dea5dec16b311907c', artist: 'Mark Ronson', title: 'Uptown Funk (feat. Bruno Mars)',
    changes: {
      qualityLevel: 'complete', phase: 'party', phaseAlternate: 'groove',
      energy: 8, bpm: 115, danceability: 0.86, mood: 'fun', language: 'EN',
      hasLyrics: true, explicit: false, isBanger: true, isSingalong: true, isEmotional: false,
      isCaliente: false, isHardcore: false, isFiller: false, suggestable: true,
      era: '2010s', releaseYear: 2014, uiCategoryPrimary: 'Disco', uiCategoriesSecondary: ['Pop'],
      genre: 'Disco', tags: ['banger-crowd', 'sing-along', 'danceable'], partyMoment: 'peak',
      cooldownDays: 14, confidence: 'high',
      confidence_notes: 'Mega-tube funk-pop intemporel Bruno Mars, "Don\'t believe me just watch" refrain massif, party peak.',
    },
    reason: 'Track vide à qualifier — Uptown Funk banger funky multi-générationnel.',
  },

  // ─── Correction classification (3) ───────────────────────────────────
  {
    _id: '6a311e7847123329cd4530fd', artist: 'Sabrina Carpenter', title: 'Espresso',
    changes: {
      phase: 'groove', phaseAlternate: 'party', energy: 7,
      isSingalong: true, isBanger: true, partyMoment: 'peak',
    },
    reason: 'Classification arrival e4 incohérente avec le tube pop-dance ultra-viral 2024, remonter en groove e7.',
  },
  {
    _id: '6a311e7a47123329cd453126', artist: 'ROSÉ', title: 'APT.',
    platine: true,
    changes: { phaseAlternate: 'party' },
    reason: 'phaseAlternate=groove = phase, invalide (doit être adjacent) → corriger à party.',
  },
  {
    _id: '6a61fef20ecc3ba504e8aaf2', artist: 'Bigflo & Oli', title: 'Sur la lune',
    changes: { bpm: 90, bpmSource: 'claude_half_time_correction', bpm_confidence: 'manual' },
    reason: 'BPM 180 = double-time, correction half-time à 90 BPM (doctrine §3).',
  },

  // ─── Doublons à neutraliser (2) ──────────────────────────────────────
  {
    _id: '6a35d5dfeaf607dcb66822b4', artist: 'ROSÉ & Bruno Mars', title: 'APT.',
    changes: { suggestable: false, isFiller: true },
    reason: 'Doublon vide de #6 (ROSÉ APT. platine) — rendre non-suggestable pour éviter conflit DJ Brain.',
  },
  {
    _id: '6a4704f7f34299d1d0c24187', artist: 'GIMS', title: 'Sapés comme jamais (feat. Niska) [Pilule Bleue]',
    changes: { suggestable: false, isFiller: true },
    reason: 'Doublon vide de Maître Gims Sapés Comme Jamais (version complete) — rendre non-suggestable.',
  },

  // ─── Platine à flagger si INCLUDE_PLATINE (1) ────────────────────────
  {
    _id: '6a19b867391f5e1520f8127d', artist: 'The Weeknd', title: 'Blinding Lights',
    platine: true,
    changes: { energy: 8 },
    reason: 'Energy=5 clairement incohérent avec le tube synth-pop driving 2019-2020 (devrait être 8).',
  },
];

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  console.log(`\n=== FIX BOOM ELEA 2026-10-10 ===`);
  console.log(`Mode : ${DRY ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Platine : ${INCLUDE_PLATINE ? 'INCLUS' : 'EXCLU'}`);
  console.log(`Corrections prévues : ${FIXES.length}\n`);

  const db = await connectMongo();
  const backups = db.collection(BACKUP_COLLECTION);

  let applied = 0, skipped = 0, errored = 0;

  for (const fix of FIXES) {
    const prefix = `[${fix.artist}] ${fix.title}`;
    const track = await Track.findById(fix._id);
    if (!track) {
      console.log(`  ❌ NOT FOUND ${prefix}`);
      errored++;
      continue;
    }
    const isPlatine = track.isVerified === true;
    if (isPlatine && !INCLUDE_PLATINE) {
      console.log(`  ⏭️  SKIP ${prefix} : platine — relancer avec --include-platine`);
      skipped++;
      continue;
    }

    const relevant = Object.entries(fix.changes).filter(([k, v]) => JSON.stringify(track[k]) !== JSON.stringify(v));
    if (!relevant.length) {
      console.log(`  ✅ ALREADY OK ${prefix}`);
      skipped++;
      continue;
    }

    const before = {};
    for (const [k] of relevant) before[k] = track[k];
    const changesStr = relevant.map(([k, v]) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(v)}`).join(' ; ');

    if (DRY) {
      console.log(`  [DRY] ${isPlatine ? '🔒 ' : ''}${prefix} — ${changesStr}`);
      applied++;
    } else {
      try {
        await backups.insertOne({
          trackId: track._id,
          at: new Date(),
          classifiedBy: CLASSIFIED_BY,
          before,
          reason: `fix boom elea 2026-10-10 : ${fix.reason}`,
        });
        for (const [k, v] of relevant) track[k] = v;
        track.classifiedBy = CLASSIFIED_BY;
        track.classifiedAt = new Date();
        track.lastReviewedAt = new Date();
        await track.save();
        console.log(`  ✅ ${isPlatine ? '🔒 ' : ''}${prefix} — ${changesStr}`);
        applied++;
      } catch (err) {
        console.log(`  ❌ ERROR ${prefix} : ${err.message}`);
        errored++;
      }
    }
  }

  console.log(`\n→ Appliquées : ${applied} | Skippées : ${skipped} | Erreurs : ${errored}`);
  await mongoose.disconnect();
}
