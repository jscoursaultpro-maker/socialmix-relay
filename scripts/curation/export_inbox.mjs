// scripts/curation/export_inbox.mjs
// Étape 1 du pipeline : sélectionne N tracks vide/partielle, vérifie leur identité sur Deezer
// (titre / artiste / durée / ISRC), et écrit un fichier inbox prêt à être qualifié par Claude.
//
// Usage :
//   node scripts/curation/export_inbox.mjs --limit 150 --mode stock|flux [--data-dir ./curation-data] [--dry-run]
//
// Sorties (dans DATA_DIR) :
//   inbox/<YYYY-MM-DD>-<run>.json       tracks vérifiées, à qualifier
//   sidelined/<YYYY-MM-DD>-<run>.json   tracks écartées (mismatch / not_found / error) → revue Jean-Sé
//   state.json                          ids en attente (pending) pour ne jamais exporter 2 fois
//
// Jamais écrit en BDD. Lecture seule.

import path from 'path';
import mongoose from 'mongoose';
import { connectMongo, todayStamp, verifyWithDeezer, readJson, writeJson } from './lib.mjs';

export const CANDIDATE_QUERY = {
  // vide / partielle, ou qualityLevel jamais calculé (doc créé sans passer par le hook pre-save)
  $or: [{ qualityLevel: { $in: ['vide', 'partielle'] } }, { qualityLevel: null }],
  isVerified: { $ne: true },
  isBlocked: { $ne: true },
  suggestable: { $ne: false },
  title: { $nin: [null, ''] },
  artist: { $nin: [null, ''] }
};

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;

if (isMain) {
  const LIMIT = Number(arg('limit', process.env.CURATION_LIMIT || 150));
  const MODE = String(arg('mode', process.env.CURATION_MODE || 'stock'));       // stock | flux
  const DATA_DIR = path.resolve(String(arg('data-dir', process.env.CURATION_DATA_DIR || './curation-data')));
  const DRY = arg('dry-run', false) === true || process.env.DRY_RUN === '1';
  const RUN = String(arg('run', process.env.CURATION_RUN || 'a'));
  const STAMP = todayStamp();
  const fileBase = `${STAMP}-${RUN}`;

  const state = readJson(path.join(DATA_DIR, 'state.json'), { pending: {}, imported: {} });
  const pendingIds = Object.keys(state.pending || {}).map(id => new mongoose.Types.ObjectId(id));

  const db = await connectMongo();
  const tracks = db.collection('tracks');

  const query = { ...CANDIDATE_QUERY, _id: { $nin: pendingIds } };
  if (MODE === 'flux') query.createdAt = { $gte: new Date(Date.now() - 36 * 3600 * 1000) };

  // Priorité : popularité Deezer décroissante (convention des batches V2), puis plus récent.
  const selected = await tracks.find(query)
    .sort({ deezerRank: -1, createdAt: -1 })
    .limit(LIMIT)
    .toArray();

  console.log(`\n=== EXPORT INBOX ${fileBase} — mode=${MODE} limit=${LIMIT} dry=${DRY} ===`);
  console.log(`Candidats sélectionnés : ${selected.length} (pending exclus : ${pendingIds.length})`);

  const inbox = [];
  const sidelined = [];
  let i = 0;
  for (const t of selected) {
    i++;
    const v = await verifyWithDeezer(t);
    const base = {
      _id: t._id.toString(),
      title: t.title,
      artist: t.artist,
      album: t.album || null,
      duration_sec: t.duration || null,
      isrc: t.isrc || null,
      deezerTrackId: t.providers?.deezer?.trackId || null,
      deezerRank: t.deezerRank || null,
      qualityLevel: t.qualityLevel || null,
      source: t.source || null,
      createdAt: t.createdAt || null,
      current: {
        genre: t.genre || null, phase: t.phase || null, bpm: t.bpm || null, bpmSource: t.bpmSource || null,
        energy: t.energy || null, uiCategoryPrimary: t.uiCategoryPrimary || null, era: t.era || null,
        releaseYear: t.releaseYear || null, language: t.language || null, mood: t.mood || null
      },
      appleMusicMetadata: t.appleMusicMetadata?.genreNames?.length ? {
        genreNames: t.appleMusicMetadata.genreNames,
        releaseDate: t.appleMusicMetadata.releaseDate || null
      } : null,
      deezer_verification: v
    };
    if (v.status === 'verified') {
      inbox.push(base);
      console.log(`  ✅ ${String(i).padStart(3)} ${t.artist} — ${t.title}  (${v.via}, Δdurée=${v.cmp?.durationDelta ?? 'n/a'}s)`);
    } else {
      sidelined.push(base);
      console.log(`  ⚠️  ${String(i).padStart(3)} ${t.artist} — ${t.title}  → ${v.status} ${v.reason || ''}`);
    }
  }

  const doc = {
    _meta: {
      file: fileBase,
      created_at: new Date().toISOString(),
      mode: MODE,
      total: inbox.length,
      sidelined: sidelined.length,
      doctrine: 'scripts/curation/DOCTRINE_PREMIUM_V2.md',
      instructions: 'scripts/curation/CLAUDE_CURATION_PROMPT.md',
      output_expected: `outbox/${fileBase}.json`
    },
    tracks: inbox
  };

  if (DRY) {
    console.log(`\n[DRY-RUN] ${inbox.length} tracks vérifiées, ${sidelined.length} écartées. Rien d'écrit.`);
  } else {
    writeJson(path.join(DATA_DIR, 'inbox', `${fileBase}.json`), doc);
    if (sidelined.length) writeJson(path.join(DATA_DIR, 'sidelined', `${fileBase}.json`), { _meta: doc._meta, tracks: sidelined });
    for (const t of inbox) state.pending[t._id] = { inbox: `${fileBase}.json`, exportedAt: new Date().toISOString() };
    writeJson(path.join(DATA_DIR, 'state.json'), state);
    console.log(`\n✅ inbox/${fileBase}.json : ${inbox.length} tracks | sidelined : ${sidelined.length}`);
  }

  await mongoose.disconnect();
}
