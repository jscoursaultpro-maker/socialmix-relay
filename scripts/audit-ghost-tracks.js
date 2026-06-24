#!/usr/bin/env node
/**
 * audit-ghost-tracks.js — Audit BDD Ghost Tracks AhOuai
 * ─────────────────────────────────────────────────────────────────────────────
 * Identifie les tracks de la BDD qui sont probablement JAMAIS jouées
 * par DJ Brain (ROI nul) — 5 catégories d'anomalies.
 *
 * Usage (toujours avec --env-file=.env pour charger MONGODB_URI) :
 *   node --env-file=.env scripts/audit-ghost-tracks.js              # dry-run (défaut)
 *   node --env-file=.env scripts/audit-ghost-tracks.js --export-csv # + export CSV
 *
 * ⚠️  Mode PUREMENT INFORMATIF — aucune écriture BDD
 *
 * Doctrine sécurité :
 *   - AUCUN mot de passe dans ce fichier
 *   - process.env.MONGODB_URI est lu depuis le contexte de lancement (--env-file=.env)
 *   - Ce script ne modifie RIEN en base
 */

import mongoose from 'mongoose';
import fs       from 'fs';
import path     from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const EXPORT_CSV = args.includes('--export-csv');
const CSV_PATH   = '/tmp/ghost-tracks-audit-2026-06-24.csv';
const MAX_DISPLAY = 20; // max tracks affichées par catégorie

// ─── MongoDB connection (no secrets in code) ───────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI manquant. Lance avec : node --env-file=.env scripts/audit-ghost-tracks.js');
  process.exit(1);
}

// ─── Track Schema (minimal — lit les champs existants) ────────────────────
const trackSchema = new mongoose.Schema({
  isrc:          String,
  fallbackHash:  String,
  title:         String,
  artist:        String,
  genre:         String,
  phase:         String,
  phaseAlternate:String,
  bpm:           Number,
  energy:        Number,
  danceability:  Number,
  popularity:    Number,
  deezerRank:    Number,
  adminQualified:Boolean,
  isBlocked:     Boolean,
  blockedBy:     String,
  blockedReason: String,
  tags:          [String],
  source:        String,
  'performance.totalPlays': Number,
  'performance.feuRatio':   Number,
  'performance.avgVibeAtPlay': Number,
  providers: mongoose.Schema.Types.Mixed,
}, { strict: false, collection: 'tracks' });

const Track = mongoose.model('Track', trackSchema);

// ─── Normalisation titre (réutilise logique clean-covers) ─────────────────
function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')   // supprime (...)
    .replace(/\[.*?\]/g, '')   // supprime [...]
    .replace(/[^\w\s]/g, '')   // supprime ponctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Formatage rapport ─────────────────────────────────────────────────────
const SEP = '═'.repeat(55);

function trackLine(t, extra = '') {
  const title  = (t.title  || '(no title)').substring(0, 40);
  const artist = (t.artist || '(no artist)').substring(0, 30);
  return `"${title}" — ${artist}${extra}`;
}

function printCategory(label, tracks, extraFn = null) {
  console.log(`\n📋 ${label}`);
  console.log(`   Total : ${tracks.length} tracks`);
  const display = tracks.slice(0, MAX_DISPLAY);
  display.forEach((t, i) => {
    const extra = extraFn ? extraFn(t) : '';
    console.log(`   [${String(i + 1).padStart(2)}] ${trackLine(t, extra)}`);
  });
  if (tracks.length > MAX_DISPLAY) {
    console.log(`   ... et ${tracks.length - MAX_DISPLAY} autres`);
  }
}

// ─── CSV export ────────────────────────────────────────────────────────────
function escapeCSV(v) {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
}

function buildCSVRows(results) {
  const rows = [
    ['categorie', 'title', 'artist', 'genre', 'phase', 'energy', 'bpm', 'deezerRank', 'isBlocked', 'blockedBy', 'isrc', 'fallbackHash', 'note'].join(',')
  ];

  const addRows = (cat, tracks, noteFn) => {
    for (const t of tracks) {
      rows.push([
        escapeCSV(cat),
        escapeCSV(t.title),
        escapeCSV(t.artist),
        escapeCSV(t.genre),
        escapeCSV(t.phase),
        escapeCSV(t.energy),
        escapeCSV(t.bpm),
        escapeCSV(t.deezerRank),
        escapeCSV(t.isBlocked),
        escapeCSV(t.blockedBy),
        escapeCSV(t.isrc),
        escapeCSV(t.fallbackHash),
        escapeCSV(noteFn ? noteFn(t) : '')
      ].join(','));
    }
  };

  addRows('1-orpheline',          results.cat1, null);
  addRows('2a-incoherente-trop-chaud', results.cat2a, t => `phase:${t.phase} energy:${t.energy}`);
  addRows('2b-incoherente-trop-calme', results.cat2b, t => `phase:${t.phase} energy:${t.energy}`);
  addRows('2c-closing-hard',      results.cat2c, t => `bpm:${t.bpm}`);
  addRows('3-sans-bpm',           results.cat3_bpm, null);
  addRows('3-sans-genre',         results.cat3_genre, null);
  addRows('3-sans-title',         results.cat3_title, null);
  addRows('3-sans-artist',        results.cat3_artist, null);
  addRows('3-sans-rank',          results.cat3_rank, null);
  addRows('5-bloquees',           results.cat5, t => t.blockedBy || '');

  // Doublons (cat 4) — une ligne par doublon dans chaque groupe
  for (const group of results.cat4) {
    for (const t of group.tracks) {
      rows.push([
        escapeCSV('4-doublon'),
        escapeCSV(t.title),
        escapeCSV(t.artist),
        escapeCSV(t.genre),
        escapeCSV(t.phase),
        escapeCSV(t.energy),
        escapeCSV(t.bpm),
        escapeCSV(t.deezerRank),
        escapeCSV(t.isBlocked),
        escapeCSV(t.blockedBy),
        escapeCSV(t.isrc),
        escapeCSV(t.fallbackHash),
        escapeCSV(`groupe:"${group.normalizedTitle}"`)
      ].join(','));
    }
  }

  return rows.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  // Connect
  await mongoose.connect(MONGODB_URI, { dbName: 'socialmix', serverSelectionTimeoutMS: 8000 });
  console.log('✅ MongoDB connecté');

  // Fetch all tracks (projection: only needed fields)
  const allTracks = await Track.find({}).select(
    'title artist genre phase phaseAlternate bpm energy deezerRank isBlocked blockedBy blockedReason adminQualified isrc fallbackHash tags source'
  ).lean();

  const total = allTracks.length;

  console.log('\n');
  console.log('🔍 AUDIT GHOST TRACKS — DRY RUN');
  if (EXPORT_CSV) console.log('   + Export CSV activé');
  console.log(SEP);
  console.log(`📊 Total tracks scannées    : ${total}`);

  // ── CAT 1 — ORPHELINES (no phaseTag) ────────────────────────────────────
  const cat1 = allTracks.filter(t =>
    !t.phase || t.phase.trim() === '' || t.phase === 'undefined'
  );

  // ── CAT 2a — arrival/ambiance + energy > 7 ──────────────────────────────
  const cat2a = allTracks.filter(t =>
    ['arrival', 'ambiance'].includes((t.phase || '').toLowerCase()) &&
    typeof t.energy === 'number' && t.energy > 7
  );

  // ── CAT 2b — groove/party + energy < 4 ──────────────────────────────────
  const cat2b = allTracks.filter(t =>
    ['groove', 'party'].includes((t.phase || '').toLowerCase()) &&
    typeof t.energy === 'number' && t.energy < 4
  );

  // ── CAT 2c — closing + genre electro hard + bpm > 150 ───────────────────
  const ELECTRO_HARD_GENRES = ['electro hard', 'hardstyle', 'hardcore', 'industrial', 'techno hard', 'hard techno'];
  const cat2c = allTracks.filter(t => {
    const phase = (t.phase || '').toLowerCase();
    const genre = (t.genre || '').toLowerCase();
    return phase === 'closing' &&
           ELECTRO_HARD_GENRES.some(g => genre.includes(g)) &&
           typeof t.bpm === 'number' && t.bpm > 150;
  });

  // ── CAT 3 — DONNÉES MANQUANTES ───────────────────────────────────────────
  const cat3_bpm    = allTracks.filter(t => !t.bpm    || t.bpm    === 0);
  const cat3_genre  = allTracks.filter(t => !t.genre  || t.genre.trim() === '');
  const cat3_title  = allTracks.filter(t => !t.title  || t.title.trim() === '');
  const cat3_artist = allTracks.filter(t => !t.artist || t.artist.trim() === '');
  const cat3_rank   = allTracks.filter(t => !t.deezerRank || t.deezerRank === 0);

  // ── CAT 4 — DOUBLONS POTENTIELS ─────────────────────────────────────────
  const titleMap = new Map(); // normalizedTitle → [tracks]
  for (const t of allTracks) {
    const norm = normalizeTitle(t.title);
    if (!norm) continue;
    if (!titleMap.has(norm)) titleMap.set(norm, []);
    titleMap.get(norm).push(t);
  }
  // Garder uniquement les groupes avec 2+ artistes DIFFÉRENTS
  const cat4 = [];
  for (const [normTitle, tracks] of titleMap.entries()) {
    const artists = new Set(tracks.map(t => (t.artist || '').toLowerCase().trim()));
    if (artists.size >= 2) {
      // Trier par deezerRank DESC (meilleur rank = plus gros chiffre = plus populaire)
      const sorted = [...tracks].sort((a, b) => (b.deezerRank || 0) - (a.deezerRank || 0));
      cat4.push({ normalizedTitle: normTitle, artistCount: artists.size, tracks: sorted });
    }
  }
  cat4.sort((a, b) => b.tracks.length - a.tracks.length); // plus gros groupes en premier

  // ── CAT 5 — BLOQUÉES ────────────────────────────────────────────────────
  const cat5 = allTracks.filter(t => t.isBlocked === true);

  // ── RAPPORT ─────────────────────────────────────────────────────────────

  // Cat 1
  printCategory('CATÉGORIE 1 — ORPHELINES (no phaseTag)', cat1,
    t => ` (energy:${t.energy ?? 'null'}, bpm:${t.bpm ?? 'null'}, genre:${t.genre || 'null'})`
  );

  // Cat 2a
  printCategory('CATÉGORIE 2a — INCOHÉRENTES arrival/ambiance + energy>7', cat2a,
    t => ` (phase:${t.phase}, energy:${t.energy}, bpm:${t.bpm ?? 'null'})`
  );

  // Cat 2b
  printCategory('CATÉGORIE 2b — INCOHÉRENTES groove/party + energy<4', cat2b,
    t => ` (phase:${t.phase}, energy:${t.energy}, bpm:${t.bpm ?? 'null'})`
  );

  // Cat 2c
  printCategory('CATÉGORIE 2c — INCOHÉRENTES closing + electro hard + bpm>150', cat2c,
    t => ` (phase:${t.phase}, genre:${t.genre}, bpm:${t.bpm})`
  );

  // Cat 3
  console.log('\n📋 CATÉGORIE 3 — DONNÉES MANQUANTES');
  console.log(`   Sans bpm      : ${cat3_bpm.length} tracks`);
  console.log(`   Sans genre    : ${cat3_genre.length} tracks`);
  console.log(`   Sans title    : ${cat3_title.length} tracks`);
  console.log(`   Sans artist   : ${cat3_artist.length} tracks`);
  console.log(`   Sans rank     : ${cat3_rank.length} tracks`);

  const showMissing = (label, tracks) => {
    if (tracks.length === 0) return;
    console.log(`\n   ▸ ${label} (5 exemples) :`);
    tracks.slice(0, 5).forEach((t, i) =>
      console.log(`     [${i + 1}] ${trackLine(t, ` (genre:${t.genre || 'null'}, bpm:${t.bpm ?? 'null'}, rank:${t.deezerRank ?? 'null'})`)}`)
    );
    if (tracks.length > 5) console.log(`     ... et ${tracks.length - 5} autres`);
  };

  showMissing('Sans bpm',    cat3_bpm);
  showMissing('Sans genre',  cat3_genre);
  showMissing('Sans title',  cat3_title);
  showMissing('Sans artist', cat3_artist);
  showMissing('Sans rank',   cat3_rank);

  // Cat 4 (doublons)
  console.log('\n📋 CATÉGORIE 4 — DOUBLONS POTENTIELS (même titre, artistes différents)');
  console.log(`   Total groupes : ${cat4.length}`);
  const dupDisplay = cat4.slice(0, 15);
  dupDisplay.forEach((group, gi) => {
    console.log(`\n   [${gi + 1}] "${group.normalizedTitle}" → ${group.tracks.length} versions, ${group.artistCount} artistes :`);
    group.tracks.slice(0, 5).forEach(t =>
      console.log(`     • "${t.title || '?'}" — ${t.artist || '?'} (rank:${t.deezerRank ?? 'null'}, energy:${t.energy ?? 'null'})`)
    );
    if (group.tracks.length > 5) console.log(`     ... et ${group.tracks.length - 5} autres versions`);
  });
  if (cat4.length > 15) console.log(`\n   ... et ${cat4.length - 15} autres groupes de doublons`);

  // Cat 5
  printCategory('CATÉGORIE 5 — BLOQUÉES (isBlocked=true)', cat5,
    t => ` (blockedBy:${t.blockedBy || 'null'})`
  );
  if (cat5.length !== 8) {
    console.log(`   ⚠️  Attendu : 8 tracks bloquées — trouvé : ${cat5.length}`);
  } else {
    console.log(`   ✅ Compte conforme (8 attendu, 8 trouvé)`);
  }

  // ── RÉSUMÉ ───────────────────────────────────────────────────────────────
  const ghostSet = new Set();
  const addToGhostSet = (list) => list.forEach(t => ghostSet.add(t._id?.toString() || t.fallbackHash || t.title));

  addToGhostSet(cat1);
  addToGhostSet(cat2a);
  addToGhostSet(cat2b);
  addToGhostSet(cat2c);
  addToGhostSet(cat3_bpm);
  addToGhostSet(cat3_genre);
  addToGhostSet(cat3_title);
  addToGhostSet(cat3_artist);
  // cat5 (bloquées) intentionnellement exclues du compteur ghost — déjà gérées

  const ghostCount = ghostSet.size;
  const safeCount  = total - ghostCount;
  const pct        = total > 0 ? ((ghostCount / total) * 100).toFixed(1) : '0';

  console.log('\n' + SEP);
  console.log('📊 RÉSUMÉ\n');
  console.log(`   Tracks ghost potentielles  : ${ghostCount} (${pct}% du total)`);
  console.log(`   Tracks bloquées            : ${cat5.length}`);
  console.log(`   Tracks safe (aucune anomalie): ${safeCount}`);
  console.log(`   Doublons potentiels (groupes): ${cat4.length}`);

  if (EXPORT_CSV) {
    console.log(`\n   Pour export CSV : node --env-file=.env scripts/audit-ghost-tracks.js --export-csv`);
  } else {
    console.log(`\n   Pour export CSV : node --env-file=.env scripts/audit-ghost-tracks.js --export-csv`);
  }

  console.log(SEP);

  // ── EXPORT CSV ───────────────────────────────────────────────────────────
  if (EXPORT_CSV) {
    const results = { cat1, cat2a, cat2b, cat2c, cat3_bpm, cat3_genre, cat3_title, cat3_artist, cat3_rank, cat4, cat5 };
    const csv = buildCSVRows(results);
    fs.writeFileSync(CSV_PATH, csv, 'utf8');
    console.log(`\n✅ CSV exporté : ${CSV_PATH}`);
    console.log(`   Lignes : ${csv.split('\n').length - 1} (hors en-tête)`);
  }

  await mongoose.disconnect();
  console.log('\n✅ Audit terminé. Aucune modification BDD effectuée.');
}

main().catch(err => {
  console.error('❌ Erreur fatale:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
