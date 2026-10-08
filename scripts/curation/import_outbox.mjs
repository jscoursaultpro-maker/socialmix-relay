// scripts/curation/import_outbox.mjs
// Étape 3 du pipeline : importe les classifications produites par Claude (outbox/*.json) en BDD.
//
// Garde-fous (non négociables) :
//   - validation stricte de chaque classification (enums, bornes, cohérences doctrine)
//   - détection de "templates" (valeurs répétées) → fichier rejeté en bloc
//   - isVerified=true (platine) : JAMAIS touché
//   - seuls les 25 champs curatoriaux (+ confidence) sont écrits ; performance.*, suggestCount,
//     boostedByUsers, votes, HPH… ne sont jamais lus ni modifiés (Mongoose n'écrit que les paths modifiés)
//   - backup des valeurs d'origine dans la collection MigrationBackup_CurationAuto avant toute écriture
//   - gate de confiance : APPLY_MIN_CONFIDENCE = none | high | medium | low
//       none   → rien n'est écrit (rapport seulement)
//       high   → seules les classifications confidence=high sont appliquées (défaut)
//       medium → high + medium
//       low    → tout
//     Les classifications non appliquées restent "pending" dans state.json et sont listées dans
//     review/<file>.md pour relecture ; un run ultérieur avec un seuil plus bas les applique.
//
// Usage :
//   APPLY_MIN_CONFIDENCE=high node scripts/curation/import_outbox.mjs [--data-dir ./curation-data] [--dry-run] [--file 2026-10-02-a]

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Track from '../../models/Track.js';
import {
  connectMongo, readJson, writeJson, todayStamp,
  PHASES, GENRES_BDD, UI_CATEGORIES, ERAS, MOODS, LANGUAGES, PARTY_MOMENTS, CONFIDENCES
} from './lib.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const DATA_DIR = path.resolve(String(arg('data-dir', process.env.CURATION_DATA_DIR || './curation-data')));
const DRY = arg('dry-run', false) === true || process.env.DRY_RUN === '1';
const ONLY_FILE = arg('file', null);
const MIN_CONF = String(process.env.APPLY_MIN_CONFIDENCE || 'high').toLowerCase();
const FORCE_RECLASSIFY = process.env.FORCE_RECLASSIFY === '1';
const CONF_RANK = { low: 1, medium: 2, high: 3 };
const MIN_RANK = MIN_CONF === 'none' ? 99 : (CONF_RANK[MIN_CONF] || 3);
const CLASSIFIED_BY = `claude_batch_auto_v3_${todayStamp()}`;
const DOCTRINE_VERSION = 'premium_v2_auto_2026-10';
const BACKUP_COLLECTION = 'MigrationBackup_CurationAuto';

const CURATED_FIELDS = [
  'uiCategoryPrimary', 'uiCategoriesSecondary', 'phase', 'phaseAlternate',
  'energy', 'bpm', 'bpmSource', 'bpm_confidence', 'danceability', 'isBanger', 'isSingalong', 'isEmotional',
  'isCaliente', 'isHardcore', 'isFiller', 'era', 'releaseYear', 'mood',
  'language', 'hasLyrics', 'explicit', 'tags', 'partyMoment', 'cooldownDays', 'notes',
  'suggestable', 'confidence', 'confidence_notes', 'genre', 'classifiedBy', 'classifiedAt', 'doctrineVersion', 'qualityLevel'
];

// ─── Patch A (2026-10-08) — Auto-fix enums ambigus ────────────────────
// Quand Claude renvoie une valeur plausible mais hors de l'enum stricte, on
// remappe silencieusement vers la valeur canonique au lieu d'invalider la
// classification. Évite les hotfixes manuels récurrents (ex: "R&B" est valide
// en genreBDD mais pas en uiCategory → on remappe vers "Urban Groove").
// Chaque remapping est journalisé dans report.auto_fixed pour traçabilité.
const UI_CATEGORY_AUTO_FIX = {
  'R&B': 'Urban Groove', 'RnB': 'Urban Groove', 'R and B': 'Urban Groove',
  'Variété': 'COCOVARIET', 'Variété FR': 'COCOVARIET', 'Variete': 'COCOVARIET', 'Variete FR': 'COCOVARIET',
  'Hip-Hop': 'Rap', 'Hip Hop': 'Rap', 'HipHop': 'Rap',
  'Electro': 'Électro', 'Electronic': 'Électro', 'Electronique': 'Électro',
};
const GENRE_BDD_AUTO_FIX = {
  'Rap': 'Hip-Hop', 'HipHop': 'Hip-Hop', 'Hip Hop': 'Hip-Hop',
  'Variété': 'COCOVARIET', 'Variété FR': 'COCOVARIET', 'Variete': 'COCOVARIET', 'Variete FR': 'COCOVARIET',
  'Électro': 'Electro', 'Electronic': 'Electro', 'Electronique': 'Electro',
  'Urban Groove': 'R&B', 'RnB': 'R&B', 'R and B': 'R&B',
};

/**
 * Applique les auto-fixes d'enums en place (mutate la classification).
 * Retourne la liste des remappings appliqués pour log.
 */
export function autoFixEnums(c) {
  const fixes = [];
  if (c.uiCategoryPrimary && UI_CATEGORY_AUTO_FIX[c.uiCategoryPrimary] && !UI_CATEGORIES.includes(c.uiCategoryPrimary)) {
    fixes.push(`uiCategoryPrimary: "${c.uiCategoryPrimary}" → "${UI_CATEGORY_AUTO_FIX[c.uiCategoryPrimary]}"`);
    c.uiCategoryPrimary = UI_CATEGORY_AUTO_FIX[c.uiCategoryPrimary];
  }
  if (Array.isArray(c.uiCategoriesSecondary)) {
    c.uiCategoriesSecondary = c.uiCategoriesSecondary.map(s => {
      if (s && UI_CATEGORY_AUTO_FIX[s] && !UI_CATEGORIES.includes(s)) {
        fixes.push(`uiCategoriesSecondary: "${s}" → "${UI_CATEGORY_AUTO_FIX[s]}"`);
        return UI_CATEGORY_AUTO_FIX[s];
      }
      return s;
    });
    // Dédoublonnage + suppression de la primaire si elle a atterri dans secondary
    c.uiCategoriesSecondary = [...new Set(c.uiCategoriesSecondary)].filter(s => s !== c.uiCategoryPrimary);
  }
  if (c.genreBDD && GENRE_BDD_AUTO_FIX[c.genreBDD] && !GENRES_BDD.includes(c.genreBDD)) {
    fixes.push(`genreBDD: "${c.genreBDD}" → "${GENRE_BDD_AUTO_FIX[c.genreBDD]}"`);
    c.genreBDD = GENRE_BDD_AUTO_FIX[c.genreBDD];
  }
  return fixes;
}

// ─── Validation d'une classification ──────────────────────────────────
const ADJACENT = {
  arrival: ['ambiance', 'closing'], ambiance: ['arrival', 'takeoff'], takeoff: ['ambiance', 'groove'],
  groove: ['takeoff', 'party'], party: ['groove', 'closing'], closing: ['party', 'arrival']
};
const isBool = v => typeof v === 'boolean';
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export function validateClassification(c) {
  const errors = [];
  if (!c._id || !/^[a-f0-9]{24}$/.test(String(c._id))) errors.push('_id manquant ou invalide');
  if (!GENRES_BDD.includes(c.genreBDD)) errors.push(`genreBDD "${c.genreBDD}" hors liste`);
  if (!UI_CATEGORIES.includes(c.uiCategoryPrimary)) errors.push(`uiCategoryPrimary "${c.uiCategoryPrimary}" hors liste`);
  if (!Array.isArray(c.uiCategoriesSecondary) || c.uiCategoriesSecondary.length > 4) errors.push('uiCategoriesSecondary doit être un array (max 4)');
  else {
    if (c.uiCategoriesSecondary.includes(c.uiCategoryPrimary)) errors.push('uiCategoriesSecondary contient uiCategoryPrimary');
    for (const s of c.uiCategoriesSecondary) if (!UI_CATEGORIES.includes(s)) errors.push(`uiCategoriesSecondary "${s}" hors liste`);
  }
  if (!PHASES.includes(c.phase)) errors.push(`phase "${c.phase}" invalide`);
  if (!PHASES.includes(c.phaseAlternate)) errors.push(`phaseAlternate "${c.phaseAlternate}" invalide`);
  else if (PHASES.includes(c.phase) && !ADJACENT[c.phase].includes(c.phaseAlternate)) errors.push(`phaseAlternate "${c.phaseAlternate}" non adjacente à "${c.phase}"`);
  if (!isInt(c.energy, 1, 10)) errors.push(`energy ${c.energy} hors 1-10`);
  if (!isInt(c.bpm, 60, 220)) errors.push(`bpm ${c.bpm} hors 60-220`);
  if (typeof c.danceability !== 'number' || c.danceability < 0 || c.danceability > 1) errors.push(`danceability ${c.danceability} hors 0.0-1.0`);
  for (const b of ['isBanger', 'isSingalong', 'isEmotional', 'isCaliente', 'isHardcore', 'isFiller', 'hasLyrics', 'explicit', 'suggestable']) {
    if (!isBool(c[b])) errors.push(`${b} doit être booléen`);
  }
  if (c.isFiller === true && c.isBanger === true) errors.push('isFiller et isBanger mutuellement exclusifs');
  if (!ERAS.includes(c.era)) errors.push(`era "${c.era}" invalide`);
  if (c.releaseYear !== null && !isInt(c.releaseYear, 1900, 2027)) errors.push(`releaseYear ${c.releaseYear} invalide`);
  if (!MOODS.includes(c.mood)) errors.push(`mood "${c.mood}" invalide`);
  if (!LANGUAGES.includes(c.language)) errors.push(`language "${c.language}" invalide`);
  if (!Array.isArray(c.tags) || c.tags.length < 1 || !c.tags.every(t => typeof t === 'string')) errors.push('tags doit contenir au moins 1 string');
  if (!PARTY_MOMENTS.includes(c.partyMoment)) errors.push(`partyMoment "${c.partyMoment}" invalide`);
  if (!isInt(c.cooldownDays, 1, 90)) errors.push(`cooldownDays ${c.cooldownDays} hors 1-90`);
  if (!CONFIDENCES.includes(c.confidence)) errors.push(`confidence "${c.confidence}" invalide`);
  if (typeof c.confidence_notes !== 'string' || c.confidence_notes.length < 10) errors.push('confidence_notes trop court');
  if (typeof c.notes !== 'string' || c.notes.length < 40) errors.push('notes DJ trop courte (<40 car.) — doctrine 3 éléments');
  if (typeof c.justification !== 'string' || c.justification.length < 10) errors.push('justification manquante');
  if (c.confidence === 'low' && c.isBanger === true) errors.push('isBanger=true interdit en confidence=low');
  return errors;
}

/** Détection "template" : trop de triplets (bpm, energy, danceability) identiques ou de notes dupliquées. */
export function detectTemplate(list) {
  if (list.length < 8) return null;
  const triplets = new Map();
  const notes = new Map();
  for (const c of list) {
    const k = `${c.bpm}|${c.energy}|${c.danceability}`;
    triplets.set(k, (triplets.get(k) || 0) + 1);
    const n = String(c.notes || '').slice(0, 60);
    notes.set(n, (notes.get(n) || 0) + 1);
  }
  const maxTriplet = Math.max(...triplets.values());
  const maxNote = Math.max(...notes.values());
  if (maxTriplet / list.length > 0.3) return `${maxTriplet}/${list.length} classifications partagent le même triplet bpm/energy/danceability`;
  if (maxNote / list.length > 0.2) return `${maxNote}/${list.length} notes DJ commencent à l'identique`;
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const outboxDir = path.join(DATA_DIR, 'outbox');
  const state = readJson(path.join(DATA_DIR, 'state.json'), { pending: {}, imported: {}, files: {} });
  state.files = state.files || {};
  const files = fs.existsSync(outboxDir)
    ? fs.readdirSync(outboxDir).filter(f => f.endsWith('.json') && (!ONLY_FILE || f.startsWith(String(ONLY_FILE)))).sort()
    : [];

  console.log(`\n=== IMPORT OUTBOX — min_confidence=${MIN_CONF} dry=${DRY} data=${DATA_DIR} ===`);
  if (!files.length) { console.log('Aucun fichier outbox à traiter.'); process.exit(0); }

  const db = await connectMongo();
  const backups = db.collection(BACKUP_COLLECTION);

  for (const file of files) {
    const fileKey = file.replace(/\.json$/, '');
    const prev = state.files[fileKey];
    if (prev?.status === 'done' && !FORCE_RECLASSIFY) { console.log(`⏭️  ${file} déjà importé intégralement`); continue; }

    let data;
    try { data = readJson(path.join(outboxDir, file)); } catch (e) { console.log(`❌ ${file} JSON illisible : ${e.message}`); continue; }
    const list = Array.isArray(data?.classifications) ? data.classifications : [];
    const inbox = readJson(path.join(DATA_DIR, 'inbox', file), null);
    const inboxById = new Map((inbox?.tracks || []).map(t => [t._id, t]));

    console.log(`\n--- ${file} : ${list.length} classifications`);
    const report = { file, at: new Date().toISOString(), min_confidence: MIN_CONF, dry_run: DRY, applied: [], deferred: [], invalid: [], skipped: [], auto_fixed: [], rejected: null };

    // 1) auto-fix enums ambigus (Patch A) + validation
    const valid = [];
    for (const c of list) {
      const fixes = autoFixEnums(c);
      if (fixes.length) {
        report.auto_fixed.push({ _id: c._id, title: c.title, artist: c.artist, fixes });
        console.log(`  🔧 AUTO-FIX ${c.artist} — ${c.title} : ${fixes.join(' ; ')}`);
      }
      const errs = validateClassification(c);
      if (!inboxById.has(String(c._id))) errs.push('_id absent de l\'inbox correspondante (track non exportée)');
      if (errs.length) report.invalid.push({ _id: c._id, title: c.title, artist: c.artist, errors: errs });
      else valid.push(c);
    }
    const tpl = detectTemplate(valid);
    if (tpl) {
      report.rejected = `TEMPLATE DÉTECTÉ — ${tpl}`;
      console.log(`❌ ${file} REJETÉ : ${report.rejected}`);
      writeReport(report);
      state.files[fileKey] = { status: 'rejected', reason: report.rejected, at: report.at };
      continue;
    }
    if (list.length && report.invalid.length / list.length > 0.15) {
      report.rejected = `${report.invalid.length}/${list.length} classifications invalides (>15 %)`;
      console.log(`❌ ${file} REJETÉ : ${report.rejected}`);
      writeReport(report);
      state.files[fileKey] = { status: 'rejected', reason: report.rejected, at: report.at };
      continue;
    }

    // 2) application avec gate de confiance
    for (const c of valid) {
      const id = String(c._id);
      if (state.imported[id] && !FORCE_RECLASSIFY) { report.skipped.push({ _id: id, title: c.title, reason: 'déjà importée' }); continue; }
      if ((CONF_RANK[c.confidence] || 0) < MIN_RANK) {
        report.deferred.push(summarize(c));
        if (state.pending[id]) state.pending[id].status = 'awaiting_review';
        continue;
      }
      const track = await Track.findById(id);
      if (!track) { report.skipped.push({ _id: id, title: c.title, reason: 'NOT FOUND en BDD' }); continue; }
      if (track.isVerified === true) { report.skipped.push({ _id: id, title: c.title, reason: 'isVerified=true (platine) — intouchable' }); continue; }
      if (['complete', 'platine'].includes(track.qualityLevel) && !FORCE_RECLASSIFY) { report.skipped.push({ _id: id, title: c.title, reason: `qualityLevel=${track.qualityLevel} depuis l'export` }); continue; }

      const before = {};
      for (const f of CURATED_FIELDS) before[f] = track[f] === undefined ? undefined : JSON.parse(JSON.stringify(track[f]));

      // BPM : Deezer (vérifié) > Claude estimé ; un bpm_confidence=deezer_api existant n'est jamais écrasé
      const dzBpm = inboxById.get(id)?.deezer_verification?.match?.bpm;
      let bpmNote;
      // Détection d'un override half-time / double-time explicite dans les notes.
      // Si Claude a corrigé un BPM Deezer (half-time ou double-time), son override prime :
      // Deezer peut se tromper d'un facteur 2 sur reggae, zouk, a cappella, DnB…
      const notesTxt = String(c.notes || '').toLowerCase();
      const hasBpmCorrection = /correction\s*bpm|half-?time|double-?time/.test(notesTxt);
      if (hasBpmCorrection && c.confidence === 'high') {
        track.bpm = c.bpm;
        track.bpmSource = 'claude_half_time_correction';
        track.bpm_confidence = 'manual';
        bpmNote = `bpm override Claude ${c.bpm} (correction half/double-time, override Deezer)`;
      }
      else if (track.bpm > 0 && track.bpm_confidence === 'deezer_api') { bpmNote = `bpm BDD conservé (${track.bpm}, deezer_api)`; }
      else if (dzBpm && dzBpm >= 60 && dzBpm <= 220) { track.bpm = Math.round(dzBpm); track.bpmSource = 'deezer_api_v3_curation'; track.bpm_confidence = 'deezer_api'; bpmNote = `bpm Deezer ${track.bpm}`; }
      else { track.bpm = c.bpm; track.bpmSource = 'claude_auto_v3'; track.bpm_confidence = 'estimated'; bpmNote = `bpm estimé ${c.bpm}`; }

      track.genre = c.genreBDD;
      for (const f of ['uiCategoryPrimary', 'uiCategoriesSecondary', 'phase', 'phaseAlternate', 'energy', 'danceability',
        'isBanger', 'isSingalong', 'isEmotional', 'isCaliente', 'isHardcore', 'isFiller', 'era', 'releaseYear', 'mood',
        'language', 'hasLyrics', 'explicit', 'tags', 'partyMoment', 'cooldownDays', 'notes', 'suggestable', 'confidence', 'confidence_notes']) {
        track[f] = c[f];
      }
      // Propagation ISRC depuis vérification Deezer de l'inbox (06/10/2026)
      // Permet la résolution cross-platform (Apple Music, Spotify) via ISRC exact.
      // Jamais d'écrasement d'un ISRC existant.
      const inboxIsrc = inboxById.get(id)?.deezer_verification?.match?.isrc;
      if (!track.isrc && inboxIsrc && typeof inboxIsrc === 'string' && inboxIsrc.length >= 10) {
        track.isrc = inboxIsrc.toUpperCase();
      }

      track.classifiedBy = CLASSIFIED_BY;
      track.classifiedAt = new Date();
      track.doctrineVersion = DOCTRINE_VERSION;
      track.lastReviewedAt = new Date();

      if (DRY) {
        console.log(`  [DRY] ${c.artist} — ${c.title} → ${c.phase}/${c.phaseAlternate} e${c.energy} ${bpmNote} (${c.confidence})`);
        report.applied.push({ ...summarize(c), bpmNote });
      } else {
        try {
          await backups.insertOne({ trackId: track._id, file, at: new Date(), classifiedBy: CLASSIFIED_BY, before });
          await track.save();
          state.imported[id] = { file, at: new Date().toISOString(), confidence: c.confidence };
          delete state.pending[id];
          console.log(`  ✅ ${c.artist} — ${c.title} → ${c.phase} e${c.energy} ${bpmNote} (${c.confidence})`);
          report.applied.push({ ...summarize(c), bpmNote });
        } catch (err) {
          // Ne pas crasher le batch sur une erreur ponctuelle.
          // Patch B (2026-10-08) — Sur duplicate ISRC, tenter un auto-merge
          // intelligent : si la track `existing` qui bloque est de qualité
          // basse (empty/partielle) et non-platine (isVerified=false), on y
          // applique la curation à la place. Les champs comportementaux
          // (votes, suggestions, HPH, etc.) restent intacts : Mongoose
          // n'écrit que les paths modifiés.
          if (err?.code === 11000 && err.keyValue?.isrc) {
            const dupIsrc = err.keyValue.isrc;
            try {
              const existing = await Track.findOne({ isrc: dupIsrc });
              if (existing && String(existing._id) !== id && !existing.isVerified
                  && ['empty', 'partielle', undefined, null].includes(existing.qualityLevel)) {
                // Appliquer la même curation sur `existing`
                const existingBefore = {};
                for (const f of CURATED_FIELDS) existingBefore[f] = existing[f] === undefined ? undefined : JSON.parse(JSON.stringify(existing[f]));
                existing.genre = c.genreBDD;
                for (const f of ['uiCategoryPrimary', 'uiCategoriesSecondary', 'phase', 'phaseAlternate', 'energy', 'danceability',
                  'isBanger', 'isSingalong', 'isEmotional', 'isCaliente', 'isHardcore', 'isFiller', 'era', 'releaseYear', 'mood',
                  'language', 'hasLyrics', 'explicit', 'tags', 'partyMoment', 'cooldownDays', 'notes', 'suggestable', 'confidence', 'confidence_notes']) {
                  existing[f] = c[f];
                }
                // BPM : même règles que track principale
                if (hasBpmCorrection && c.confidence === 'high') {
                  existing.bpm = c.bpm; existing.bpmSource = 'claude_half_time_correction'; existing.bpm_confidence = 'manual';
                } else if (!(existing.bpm > 0 && existing.bpm_confidence === 'deezer_api')) {
                  if (dzBpm && dzBpm >= 60 && dzBpm <= 220) {
                    existing.bpm = Math.round(dzBpm); existing.bpmSource = 'deezer_api_v3_curation'; existing.bpm_confidence = 'deezer_api';
                  } else {
                    existing.bpm = c.bpm; existing.bpmSource = 'claude_auto_v3'; existing.bpm_confidence = 'estimated';
                  }
                }
                existing.classifiedBy = CLASSIFIED_BY;
                existing.classifiedAt = new Date();
                existing.doctrineVersion = DOCTRINE_VERSION;
                existing.lastReviewedAt = new Date();
                await backups.insertOne({ trackId: existing._id, file, at: new Date(), classifiedBy: CLASSIFIED_BY, before: existingBefore, mergedFrom: track._id, reason: 'duplicate_isrc_auto_merge' });
                await existing.save();
                state.imported[id] = { file, at: new Date().toISOString(), confidence: c.confidence, mergedInto: String(existing._id) };
                delete state.pending[id];
                console.log(`  🔀 MERGE ${c.artist} — ${c.title} → curation appliquée sur ${existing._id} (duplicate isrc ${dupIsrc})`);
                report.applied.push({ ...summarize(c), bpmNote, mergedInto: String(existing._id), reason: `auto-merged into ${existing._id} (duplicate isrc)` });
                continue;
              }
              // existing introuvable, ou isVerified, ou qualityLevel haut → skip classique
              console.warn(`  ⚠️  SKIP ${c.artist} — ${c.title} : duplicate isrc ${dupIsrc} (existing non éligible au merge)`);
              report.skipped.push({ _id: id, title: c.title, reason: `duplicate isrc ${dupIsrc}, existing ${existing?._id || 'inconnu'} non éligible au merge (qualityLevel=${existing?.qualityLevel}, isVerified=${existing?.isVerified})` });
            } catch (mergeErr) {
              console.warn(`  ⚠️  SKIP ${c.artist} — ${c.title} : duplicate isrc + échec merge : ${mergeErr.message}`);
              report.skipped.push({ _id: id, title: c.title, reason: `duplicate isrc + merge failed: ${mergeErr.message}` });
            }
          } else if (err?.code === 11000) {
            console.warn(`  ⚠️  SKIP ${c.artist} — ${c.title} : duplicate key ${JSON.stringify(err.keyValue || {})}`);
            report.skipped.push({ _id: id, title: c.title, reason: `duplicate key: ${JSON.stringify(err.keyValue || {})}` });
          } else {
            console.error(`  ❌ ERREUR ${c.artist} — ${c.title} : ${err.message}`);
            report.skipped.push({ _id: id, title: c.title, reason: `save error: ${err.message}` });
          }
          continue;
        }
      }
    }

    const remaining = report.deferred.length;
    state.files[fileKey] = { status: DRY ? 'dry_run' : (remaining ? 'partial' : 'done'), applied: report.applied.length, deferred: remaining, invalid: report.invalid.length, at: report.at };
    writeReport(report);
    const mergedCount = report.applied.filter(a => a.mergedInto).length;
    const autoFixCount = report.auto_fixed?.length || 0;
    console.log(`→ ${file} : appliquées ${report.applied.length} (dont ${mergedCount} auto-mergées) | auto-fix enums ${autoFixCount} | en attente ${remaining} | invalides ${report.invalid.length} | skip ${report.skipped.length}`);
  }

  if (!DRY) writeJson(path.join(DATA_DIR, 'state.json'), state);
  await mongoose.disconnect();
}

function summarize(c) {
  return { _id: c._id, title: c.title, artist: c.artist, phase: c.phase, phaseAlternate: c.phaseAlternate, energy: c.energy, bpm: c.bpm,
    isBanger: c.isBanger, confidence: c.confidence, confidence_notes: c.confidence_notes, justification: c.justification };
}

function writeReport(r) {
  const lines = [];
  lines.push(`# Import curation — ${r.file}`);
  lines.push('');
  lines.push(`- Date : ${r.at}  ·  seuil : **${r.min_confidence}**  ·  dry-run : ${r.dry_run}`);
  if (r.rejected) lines.push(`- ❌ **FICHIER REJETÉ** : ${r.rejected}`);
  lines.push(`- Appliquées : **${r.applied.length}** · En attente de relecture : **${r.deferred.length}** · Invalides : **${r.invalid.length}** · Ignorées : ${r.skipped.length}`);
  lines.push('');
  const table = (rows) => {
    lines.push('| Artiste — Titre | Phase / alt | E | BPM | Banger | Conf. | Pourquoi |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const x of rows) lines.push(`| ${x.artist} — ${x.title} | ${x.phase} / ${x.phaseAlternate} | ${x.energy} | ${x.bpm} | ${x.isBanger ? '🔥' : ''} | ${x.confidence} | ${String(x.confidence_notes || '').replace(/\|/g, '/')} |`);
    lines.push('');
  };
  if (r.deferred.length) { lines.push(`## À relire (${r.deferred.length}) — non appliquées, seuil ${r.min_confidence}`); lines.push(''); table(r.deferred); }
  if (r.applied.length) { lines.push(`## Appliquées (${r.applied.length})`); lines.push(''); table(r.applied); }
  if (r.invalid.length) { lines.push(`## Invalides (${r.invalid.length})`); lines.push(''); for (const x of r.invalid) lines.push(`- ${x.artist} — ${x.title} (${x._id}) : ${x.errors.join(' ; ')}`); lines.push(''); }
  if (r.auto_fixed && r.auto_fixed.length) { lines.push(`## Auto-fix enums (${r.auto_fixed.length})`); lines.push(''); for (const x of r.auto_fixed) lines.push(`- ${x.artist} — ${x.title} : ${x.fixes.join(' ; ')}`); lines.push(''); }
  if (r.skipped.length) { lines.push(`## Ignorées (${r.skipped.length})`); lines.push(''); for (const x of r.skipped) lines.push(`- ${x.title} (${x._id}) : ${x.reason}`); lines.push(''); }
  writeMd(path.join(DATA_DIR, 'review', `${r.file.replace(/\.json$/, '')}.md`), lines.join('\n'));
}
function writeMd(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s + '\n', 'utf8'); }
