#!/usr/bin/env node
/**
 * audit_base_150.mjs — Stress test qualitatif de la base curated
 *
 * Simule 150 passages de morceaux en analysant la distribution des genres,
 * la qualité des BPM, les doublons, les artistes blacklistés, etc.
 *
 * ⚠️ Tourne en local, sans serveur ni connexion réseau.
 *
 * Usage: node audit_base_150.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────
const DB_PATH        = path.join(__dirname, './curated_base_v3.json');
const DJBRAIN_PATH   = path.join(__dirname, '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift');
const NUM_TRACKS     = 150;
const TARGET_URL_TBD = 'http://localhost:3069'; // Pour check server optionnel

// Genres valides de SocialMix
const VALID_GENRES = new Set([
  'House', 'Electro', 'Disco', 'Pop', 'Hip-Hop', 'R&B',
  'Latin', 'Reggaeton', 'Afro', 'Rock', 'COCOVARIET', 'Chill',
  'Ambient', 'Variété Fr', 'Club', 'Dance', 'Années 80', 'Années 90'
]);

// Genres "party-safe" (doivent représenter la majorité)
const PARTY_GENRES = new Set([
  'House', 'Electro', 'Disco', 'Pop', 'Hip-Hop', 'R&B',
  'Latin', 'Reggaeton', 'Afro', 'Rock', 'COCOVARIET', 'Chill', 'Club'
]);

// BPM raisonnables pour une soirée
const BPM_MIN = 60;
const BPM_MAX = 170;
// BPM suspect (half-time ou double-time)
const BPM_SUSPICIOUS_LOW  = 75;  // En dessous = probablement half-time
const BPM_SUSPICIOUS_HIGH = 155; // Au-dessus  = probablement double-time

// Artistes blacklistés (miroir simplifié du DJBrain)
const BLACKLISTED_ARTISTS = new Set([
  'bill evans', 'miles davis', 'chet baker', 'john coltrane', 'thelonious monk',
  'dave brubeck', 'charlie parker', 'ella fitzgerald', 'billie holiday',
  'ludovico einaudi', 'max richter', 'yiruma', 'debussy', 'chopin', 'bach',
  'brian eno', 'enya', 'mozart', 'beethoven', 'vivaldi',
  'fitness music', 'workout music', 'gym music', 'deep house workout',
]);

// Compatible genres map (miroir du DJBrain)
const COMPATIBLE = {
  'House':      ['Electro', 'Disco', 'Pop', 'Afro', 'Club'],
  'Electro':    ['House', 'Disco', 'Pop', 'Hip-Hop', 'Club'],
  'Disco':      ['House', 'Electro', 'Pop', 'COCOVARIET', 'R&B'],
  'Hip-Hop':    ['Pop', 'Afro', 'Latin', 'R&B'],
  'Pop':        ['Hip-Hop', 'Disco', 'Electro', 'COCOVARIET', 'Rock'],
  'Afro':       ['Latin', 'Hip-Hop', 'House'],
  'Latin':      ['Afro', 'Reggaeton'],
  'Reggaeton':  ['Latin', 'Afro'],
  'COCOVARIET': ['Pop', 'Disco', 'Rock'],
  'Rock':       ['Pop', 'COCOVARIET', 'Electro'],
  'Chill':      ['Pop', 'Disco', 'House'],
  'R&B':        ['Hip-Hop', 'Pop', 'Afro'],
  'Ambient':    [],  // Non-party
  'Club':       ['Electro', 'House', 'Hip-Hop', 'Disco', 'Pop'],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pick  = arr => arr[Math.floor(Math.random() * arr.length)];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function colorize(text, code) { return `\x1b[${code}m${text}\x1b[0m`; }
const green  = t => colorize(t, 32);
const red    = t => colorize(t, 31);
const yellow = t => colorize(t, 33);
const cyan   = t => colorize(t, 36);
const bold   = t => colorize(t, 1);
const dim    = t => colorize(t, 2);

function bar(count, max, width = 30) {
  const filled = Math.round((count / max) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// ─── Load curated_base_v3.json ───────────────────────────────────────────────

let curatedDB = null;
try {
  curatedDB = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
} catch (e) {
  console.error(red(`❌ Impossible de lire ${DB_PATH}: ${e.message}`));
  process.exit(1);
}

// ─── Extract curated tracks from DJBrain.swift ──────────────────────────────

let swiftTracks = [];
try {
  const swift = fs.readFileSync(DJBRAIN_PATH, 'utf-8');
  const regex = /CuratedTrack\(deezerID:\s*(\d+),\s*genre:\s*"([^"]+)",\s*title:\s*"([^"]*)",\s*artist:\s*"([^"]*)"(?:,\s*bpm:\s*(\d+))?\)/g;
  let m;
  while ((m = regex.exec(swift)) !== null) {
    swiftTracks.push({
      deezerID: parseInt(m[1]),
      genre:    m[2],
      title:    m[3],
      artist:   m[4],
      bpm:      m[5] ? parseInt(m[5]) : 0,
      source:   'curated_hardcoded',
    });
  }
} catch (e) {
  console.warn(yellow(`⚠️  DJBrain.swift non disponible: ${e.message}`));
}

// ─── Merge databases ─────────────────────────────────────────────────────────

const dbTracks   = curatedDB?.tracks || [];
const allTracks  = [...swiftTracks, ...dbTracks];

console.log('\n' + '═'.repeat(66));
console.log(bold('  🎵 AUDIT BASE CURATED — STRESS TEST 150 TITRES'));
console.log('═'.repeat(66));
console.log(`  Sources chargées:`);
console.log(`    • DJBrain.swift (hardcoded): ${cyan(swiftTracks.length)} tracks`);
console.log(`    • curated_base_v3.json:      ${cyan(dbTracks.length)} tracks`);
console.log(`    • Total combiné:             ${cyan(allTracks.length)} tracks`);
console.log('═'.repeat(66) + '\n');

// ─── AUDIT 1 — Analyse complète de la base ───────────────────────────────────

console.log(bold('📊 AUDIT 1 — ANALYSE DE LA BASE COMPLÈTE\n'));

const issues = {
  noGenre:          [],
  invalidGenre:     [],
  bpmZero:          [],
  bpmTooLow:        [],
  bpmTooHigh:       [],
  bpmSuspicious:    [],
  blacklisted:      [],
  noDeezerID:       [],
  emptyTitle:       [],
};

const byGenre     = {};
const bySource    = {};
const dupIDs      = {};
const dupKeys     = {};
const seenIDs     = new Set();
const seenKeys    = new Set();

for (const t of allTracks) {
  const genre   = t.genre || '';
  const bpm     = t.bpm   || 0;
  const artist  = (t.artist || '').toLowerCase().trim();
  const key     = `${(t.title || '').toLowerCase().trim()}|${artist}`;
  const src     = t.source || 'unknown';

  // Genre stats
  byGenre[genre] = (byGenre[genre] || 0) + 1;
  bySource[src]  = (bySource[src]  || 0) + 1;

  // Problèmes genre
  if (!genre) {
    issues.noGenre.push(t);
  } else if (!VALID_GENRES.has(genre)) {
    issues.invalidGenre.push(t);
  }

  // BPM
  if (bpm === 0) {
    issues.bpmZero.push(t);
  } else if (bpm < BPM_MIN) {
    issues.bpmTooLow.push(t);
  } else if (bpm > BPM_MAX) {
    issues.bpmTooHigh.push(t);
  } else if (bpm < BPM_SUSPICIOUS_LOW) {
    issues.bpmSuspicious.push(t);
  } else if (bpm > BPM_SUSPICIOUS_HIGH) {
    issues.bpmSuspicious.push(t);
  }

  // Artistes blacklistés
  if (BLACKLISTED_ARTISTS.has(artist)) {
    issues.blacklisted.push(t);
  }

  // DeezerID
  if (!t.deezerID || t.deezerID <= 0) {
    issues.noDeezerID.push(t);
  } else {
    if (seenIDs.has(t.deezerID)) {
      dupIDs[t.deezerID] = (dupIDs[t.deezerID] || 0) + 1;
    }
    seenIDs.add(t.deezerID);
  }

  // Titre vide
  if (!t.title || t.title.trim() === '') {
    issues.emptyTitle.push(t);
  }

  // Doublons titre/artiste
  if (seenKeys.has(key) && key !== '|') {
    dupKeys[key] = (dupKeys[key] || 0) + 1;
  }
  seenKeys.add(key);
}

// ── Distribution par genre ──
const maxGenreCount = Math.max(...Object.values(byGenre));
const totalParty = Object.entries(byGenre)
  .filter(([g]) => PARTY_GENRES.has(g))
  .reduce((sum, [,c]) => sum + c, 0);
const totalAll = allTracks.length;

console.log('  Distribution par genre:');
Object.entries(byGenre)
  .sort((a, b) => b[1] - a[1])
  .forEach(([genre, count]) => {
    const pct     = (count / totalAll * 100).toFixed(1);
    const isParty = PARTY_GENRES.has(genre);
    const barStr  = bar(count, maxGenreCount);
    const label   = isParty ? green(genre.padEnd(14)) : yellow(genre.padEnd(14));
    console.log(`    ${label} ${barStr} ${String(count).padStart(4)}  (${pct}%)`);
  });

const partyPct = (totalParty / totalAll * 100).toFixed(1);
console.log(`\n  Party-safe: ${totalParty}/${totalAll} tracks (${partyPct}%)`);
console.log(`  Non-party:  ${totalAll - totalParty} tracks (${(100 - parseFloat(partyPct)).toFixed(1)}%)`);

// ── Distribution par source ──
console.log('\n  Distribution par source:');
Object.entries(bySource)
  .sort((a, b) => b[1] - a[1])
  .forEach(([src, count]) => {
    console.log(`    ${src.padEnd(28)}: ${count}`);
  });

// ─── AUDIT 2 — Problèmes détectés ────────────────────────────────────────────

console.log('\n' + '─'.repeat(66));
console.log(bold('⚠️  AUDIT 2 — PROBLÈMES DÉTECTÉS\n'));

function printIssues(label, list, limit = 8) {
  const icon = list.length === 0 ? '✅' : '❌';
  console.log(`  ${icon} ${label}: ${bold(String(list.length))}`);
  if (list.length > 0) {
    list.slice(0, limit).forEach(t => {
      const bpmStr = t.bpm ? ` [${t.bpm} BPM]` : ' [BPM:?]';
      console.log(`     ${dim('•')} ${yellow(t.title || '(vide)')} — ${t.artist || '?'} | ${t.genre || 'SANS GENRE'}${bpmStr}`);
    });
    if (list.length > limit) {
      console.log(`     ${dim(`... et ${list.length - limit} autres`)}`);
    }
  }
}

printIssues('Tracks SANS genre',          issues.noGenre);
printIssues('Genres INVALIDES',           issues.invalidGenre);
printIssues('BPM = 0 (manquant)',         issues.bpmZero, 5);
printIssues('BPM < 60 (aberrant)',        issues.bpmTooLow);
printIssues('BPM > 170 (aberrant)',       issues.bpmTooHigh);
printIssues('BPM suspect (<75 ou >155)', issues.bpmSuspicious, 6);
printIssues('Artistes blacklistés',       issues.blacklisted);
printIssues('Sans deezerID',              issues.noDeezerID, 5);
printIssues('Titre vide',                 issues.emptyTitle);

const dupIDCount   = Object.keys(dupIDs).length;
const dupKeyCount  = Object.keys(dupKeys).length;
const dupIcon1     = dupIDCount   === 0 ? '✅' : '⚠️ ';
const dupIcon2     = dupKeyCount  === 0 ? '✅' : '⚠️ ';
console.log(`  ${dupIcon1} DeezerID en double: ${bold(String(dupIDCount))}`);
if (dupIDCount > 0) {
  Object.entries(dupIDs).slice(0, 5).forEach(([id, extra]) => {
    const track = allTracks.find(t => t.deezerID === parseInt(id));
    console.log(`     ${dim('•')} ID ${id} — ${track?.title || '?'} (${extra + 1} fois)`);
  });
}
console.log(`  ${dupIcon2} Doublons titre+artiste: ${bold(String(dupKeyCount))}`);
if (dupKeyCount > 0) {
  Object.keys(dupKeys).slice(0, 5).forEach(k => {
    const [title, artist] = k.split('|');
    console.log(`     ${dim('•')} "${title}" — ${artist}`);
  });
}

// ─── AUDIT 3 — Simulation 150 passages ───────────────────────────────────────

console.log('\n' + '─'.repeat(66));
console.log(bold('🎲 AUDIT 3 — SIMULATION 150 PASSAGES\n'));

// Séquence de phases réaliste
const SESSION_PHASES = [
  { name: 'Arrivée',        duration: 20, targetBPM: 100, genres: ['Chill', 'Pop', 'Disco'] },
  { name: 'Warm-Up',        duration: 30, targetBPM: 115, genres: ['Pop', 'R&B', 'Disco', 'Hip-Hop'] },
  { name: 'Groove',         duration: 40, targetBPM: 122, genres: ['Pop', 'R&B', 'Hip-Hop', 'Afro', 'Latin'] },
  { name: 'Ça Monte',       duration: 25, targetBPM: 128, genres: ['House', 'Electro', 'Disco'] },
  { name: 'Apogée',         duration: 20, targetBPM: 132, genres: ['House', 'Electro', 'Disco'] },
  { name: 'Redescente',     duration: 15, targetBPM: 118, genres: ['Pop', 'R&B', 'COCOVARIET'] },
];

// Pool par genre des tracks de qualité (avec BPM et deezerID)
const poolByGenre = {};
for (const t of allTracks) {
  if (!t.genre || !PARTY_GENRES.has(t.genre)) continue;
  if (!t.deezerID || t.deezerID <= 0) continue;
  if (!poolByGenre[t.genre]) poolByGenre[t.genre] = [];
  poolByGenre[t.genre].push(t);
}

// Simulation
const playlist     = [];
const usedIDs      = new Set();
const usedKeys     = new Set();
const simuIssues   = { wrongBPM: [], alreadyPlayed: [], noPool: [], nonParty: [] };
const phaseStats   = {};

// Générer 150 tracks en respectant les phases
let trackIndex = 0;
for (const phase of SESSION_PHASES) {
  const tracksInPhase = Math.round((phase.duration / 150) * NUM_TRACKS);
  phaseStats[phase.name] = { wanted: tracksInPhase, found: 0, genres: {} };

  for (let i = 0; i < tracksInPhase && trackIndex < NUM_TRACKS; i++) {
    // Chercher un track dans le genre cible
    const genre   = pick(phase.genres);
    const pool    = poolByGenre[genre] || [];
    const compat  = (COMPATIBLE[genre] || []).flatMap(g => poolByGenre[g] || []);
    const fullPool = [...pool, ...compat].filter(t => !usedIDs.has(t.deezerID));

    if (fullPool.length === 0) {
      simuIssues.noPool.push({ phase: phase.name, genre });
      trackIndex++;
      continue;
    }

    // Trier par proximité BPM
    const sorted = fullPool.sort((a, b) => {
      const da = Math.abs((a.bpm || 120) - phase.targetBPM);
      const db = Math.abs((b.bpm || 120) - phase.targetBPM);
      return da - db;
    });

    // Prendre le meilleur
    const chosen = sorted[0];
    const key    = `${chosen.title?.toLowerCase()}|${chosen.artist?.toLowerCase()}`;

    if (usedKeys.has(key)) {
      simuIssues.alreadyPlayed.push(chosen);
    }

    const bpmDiff = Math.abs((chosen.bpm || 0) - phase.targetBPM);
    if (chosen.bpm > 0 && bpmDiff > 30) {
      simuIssues.wrongBPM.push({ track: chosen, phase: phase.name, targetBPM: phase.targetBPM });
    }

    usedIDs.add(chosen.deezerID);
    usedKeys.add(key);
    playlist.push({ ...chosen, phase: phase.name, position: trackIndex + 1 });
    phaseStats[phase.name].found++;
    phaseStats[phase.name].genres[chosen.genre] = (phaseStats[phase.name].genres[chosen.genre] || 0) + 1;
    trackIndex++;
  }
}

// Afficher la playlist par phase
for (const phase of SESSION_PHASES) {
  const stats = phaseStats[phase.name];
  const tracks = playlist.filter(t => t.phase === phase.name);
  console.log(`  ${bold(`── ${phase.name.toUpperCase()} (objectif ${stats.wanted} tracks, trouvé ${stats.found})`)} — BPM cible ~${phase.targetBPM}`);

  // Genre breakdown
  const genreBreakdown = Object.entries(stats.genres)
    .sort((a, b) => b[1] - a[1])
    .map(([g, c]) => `${g}:${c}`)
    .join(' | ');
  console.log(`    Genres: ${dim(genreBreakdown)}`);

  // Première et dernière track
  if (tracks.length > 0) {
    const first = tracks[0];
    const last  = tracks[tracks.length - 1];
    const bpmFirst = first.bpm ? `${first.bpm} BPM` : 'BPM ?';
    const bpmLast  = last.bpm  ? `${last.bpm} BPM`  : 'BPM ?';
    console.log(`    Ouverture : ${cyan(first.title)} — ${first.artist} [${bpmFirst}] [${first.genre}]`);
    if (tracks.length > 1) {
      console.log(`    Fermeture : ${cyan(last.title)} — ${last.artist} [${bpmLast}] [${last.genre}]`);
    }
    // 3 tracks du milieu
    if (tracks.length > 3) {
      const mid = tracks.slice(1, -1).slice(0, 2);
      mid.forEach(t => {
        const bpmStr = t.bpm ? `${t.bpm} BPM` : 'BPM ?';
        console.log(`             ${dim(t.title)} — ${dim(t.artist)} [${dim(bpmStr)}]`);
      });
      if (tracks.length > 4) console.log(`             ${dim(`... +${tracks.length - 4} tracks`)}`);
    }
  }
  console.log('');
}

// ─── AUDIT 4 — Problèmes de simulation ──────────────────────────────────────

console.log('─'.repeat(66));
console.log(bold('🔍 AUDIT 4 — PROBLÈMES DE SIMULATION\n'));

if (simuIssues.noPool.length > 0) {
  console.log(`  ⚠️  Genres sans pool disponible (${simuIssues.noPool.length} fois):`);
  const grouped = {};
  simuIssues.noPool.forEach(i => grouped[i.genre] = (grouped[i.genre] || 0) + 1);
  Object.entries(grouped).forEach(([g, c]) => console.log(`     • ${g}: ${c} fois`));
} else {
  console.log(green('  ✅ Tous les genres avaient un pool suffisant'));
}

if (simuIssues.wrongBPM.length > 0) {
  console.log(`\n  ⚠️  BPM trop éloigné du target (${simuIssues.wrongBPM.length}):`);
  simuIssues.wrongBPM.slice(0, 5).forEach(({ track, phase, targetBPM }) => {
    console.log(`     • ${yellow(track.title)} [${track.bpm} BPM vs cible ${targetBPM}] — Phase: ${phase}`);
  });
} else {
  console.log(green('  ✅ BPM cohérent dans toutes les phases'));
}

if (simuIssues.alreadyPlayed.length > 0) {
  console.log(`\n  ⚠️  Tracks déjà joués (doublons): ${simuIssues.alreadyPlayed.length}`);
} else {
  console.log(green('  ✅ Aucun doublon dans la simulation'));
}

// ─── AUDIT 5 — Distribution finale de la simulation ─────────────────────────

console.log('\n' + '─'.repeat(66));
console.log(bold('📈 AUDIT 5 — DISTRIBUTION FINALE (150 tracks simulés)\n'));

const simuByGenre = {};
playlist.forEach(t => { simuByGenre[t.genre] = (simuByGenre[t.genre] || 0) + 1; });

const maxSimu = Math.max(...Object.values(simuByGenre), 1);
Object.entries(simuByGenre)
  .sort((a, b) => b[1] - a[1])
  .forEach(([genre, count]) => {
    const pct    = (count / playlist.length * 100).toFixed(1);
    const barStr = bar(count, maxSimu);
    console.log(`    ${genre.padEnd(14)} ${barStr} ${String(count).padStart(3)}  (${pct}%)`);
  });

const avgBPM = playlist.filter(t => t.bpm > 0).reduce((s, t) => s + t.bpm, 0)
             / playlist.filter(t => t.bpm > 0).length;
const bpmRange = playlist.filter(t => t.bpm > 0);
const minBPM   = Math.min(...bpmRange.map(t => t.bpm));
const maxBPM   = Math.max(...bpmRange.map(t => t.bpm));

console.log(`\n  BPM : min ${minBPM} | max ${maxBPM} | moyenne ${avgBPM.toFixed(0)}`);
console.log(`  Tracks sans BPM dans la playlist : ${playlist.filter(t => !t.bpm).length}`);

// ─── VERDICT FINAL ───────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(66));
console.log(bold('🏁 VERDICT FINAL\n'));

const totalIssues =
  issues.noGenre.length +
  issues.invalidGenre.length +
  issues.bpmTooLow.length +
  issues.bpmTooHigh.length +
  issues.blacklisted.length +
  issues.emptyTitle.length;

const totalWarnings =
  issues.bpmZero.length +
  issues.bpmSuspicious.length +
  dupIDCount +
  dupKeyCount;

const checks = [
  { name: 'Pas de track sans genre',         pass: issues.noGenre.length === 0,         value: `${issues.noGenre.length} problèmes` },
  { name: 'Pas de genre invalide',           pass: issues.invalidGenre.length === 0,    value: `${issues.invalidGenre.length} invalides` },
  { name: 'Pas d\'artiste blacklisté',       pass: issues.blacklisted.length === 0,     value: `${issues.blacklisted.length} trouvés` },
  { name: 'Pas de titre vide',               pass: issues.emptyTitle.length === 0,      value: `${issues.emptyTitle.length} trouvés` },
  { name: 'BPM aberrants (< 60 ou > 170)',   pass: issues.bpmTooLow.length + issues.bpmTooHigh.length === 0, value: `${issues.bpmTooLow.length + issues.bpmTooHigh.length} aberrants` },
  { name: 'Taux party-safe > 85%',           pass: parseFloat(partyPct) >= 85,          value: `${partyPct}% party-safe` },
  { name: 'Simulation 150 tracks réussie',   pass: playlist.length >= 100,              value: `${playlist.length}/150 placés` },
  { name: 'Aucun pool de genre vide',        pass: simuIssues.noPool.length === 0,      value: `${simuIssues.noPool.length} fois sans pool` },
  { name: 'BPM cohérents en simulation',     pass: simuIssues.wrongBPM.length < 10,     value: `${simuIssues.wrongBPM.length} écarts importants` },
];

checks.forEach(c => {
  const icon = c.pass ? green('✅') : red('❌');
  console.log(`  ${icon} ${c.name.padEnd(38)} ${dim(c.value)}`);
});

const allPass = checks.every(c => c.pass);
console.log('\n' + '─'.repeat(66));
console.log(`  Erreurs bloquantes : ${totalIssues === 0 ? green(totalIssues) : red(totalIssues)}`);
console.log(`  Avertissements     : ${totalWarnings === 0 ? green(totalWarnings) : yellow(totalWarnings)}`);
console.log('─'.repeat(66));
console.log(`  ${bold('VERDICT:')} ${allPass ? green('✅ BASE QUALIFIÉE') : red('❌ BASE À CORRIGER')}`);
console.log('═'.repeat(66) + '\n');

// ─── Sauvegarde du rapport JSON ──────────────────────────────────────────────

const report = {
  generatedAt:     new Date().toISOString(),
  totalTracks:     allTracks.length,
  swiftTracks:     swiftTracks.length,
  dbTracks:        dbTracks.length,
  partyPct:        parseFloat(partyPct),
  genreDistribution: byGenre,
  sourceDistribution: bySource,
  issues: {
    noGenre:      issues.noGenre.length,
    invalidGenre: issues.invalidGenre.map(t => ({ title: t.title, artist: t.artist, genre: t.genre })),
    bpmZero:      issues.bpmZero.length,
    bpmTooLow:    issues.bpmTooLow.map(t => ({ title: t.title, artist: t.artist, bpm: t.bpm })),
    bpmTooHigh:   issues.bpmTooHigh.map(t => ({ title: t.title, artist: t.artist, bpm: t.bpm })),
    bpmSuspicious:issues.bpmSuspicious.length,
    blacklisted:  issues.blacklisted.map(t => ({ title: t.title, artist: t.artist })),
    emptyTitle:   issues.emptyTitle.length,
    dupDeezerID:  dupIDCount,
    dupTitleArtist: dupKeyCount,
  },
  simulation: {
    placedTracks: playlist.length,
    targetTracks: NUM_TRACKS,
    avgBPM:       parseFloat(avgBPM.toFixed(0)),
    bpmMin:       minBPM,
    bpmMax:       maxBPM,
    genreDistribution: simuByGenre,
    issues: {
      noPool:      simuIssues.noPool.length,
      wrongBPM:    simuIssues.wrongBPM.length,
      alreadyPlayed: simuIssues.alreadyPlayed.length,
    },
  },
  checks,
  verdict: allPass ? 'PASS' : 'FAIL',
};

const reportPath = path.join(__dirname, 'audit_base_report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`  📄 Rapport complet sauvegardé: ${dim(reportPath)}\n`);
