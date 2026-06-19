/**
 * party_simulation.mjs
 *
 * Simule une soirée de 6h en accéléré (quelques secondes)
 * Reproduit la logique DJEngine : phases → sélection tracks → séquençage
 * Aucune suggestion, aucune mutation de la base — pur audit.
 *
 * Output : journal complet de la soirée par phase + stats finales
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, './curated_base_v3.json');

// ─── Config Simulation ───────────────────────────────────
const PARTY_DURATION_MIN = 630; // 6 heures
const AVG_TRACK_MIN      = 3.5; // durée moyenne d'un titre

// ─── Phases (miroir DJEngine.swift + nos phases SocialMix) ──
const PHASES = [
  { name: 'arrivée',     durationMin: 40,  bpmRange: [70, 100],  energyRange: [1, 3],
    genres: ['Ambient','Chill','Jazz','COCOVARIET','R&B','Pop'] },
  { name: 'ambiance',    durationMin: 50,  bpmRange: [90, 115],  energyRange: [3, 5],
    genres: ['Pop','R&B','Disco','House','COCOVARIET','Afro','Latin','Folk, World, & Country'] },
  { name: 'groove',      durationMin: 60,  bpmRange: [110, 125], energyRange: [5, 7],
    genres: ['House','Disco','Hip-Hop','Pop','Latin','Reggaeton','Afro','R&B'] },
  { name: 'montée',      durationMin: 50,  bpmRange: [120, 130], energyRange: [7, 8],
    genres: ['House','Electro','Disco','Pop','Latin'] },
  { name: 'apogée',      durationMin: 70,  bpmRange: [125, 145], energyRange: [8, 10],
    genres: ['House','Electro','Pop','Latin','Reggaeton'] },
  { name: 'redescente',  durationMin: 40,  bpmRange: [95, 122],  energyRange: [3, 6],
    genres: ['House','Disco','Pop','Chill','R&B','Ambient'] },
  // Second arc (shorter)
  { name: 'groove²',     durationMin: 30,  bpmRange: [110, 125], energyRange: [5, 7],
    genres: ['House','Disco','Hip-Hop','Pop','Latin','Afro'] },
  { name: 'montée²',     durationMin: 30,  bpmRange: [120, 130], energyRange: [7, 8],
    genres: ['House','Electro','Disco'] },
  { name: 'apogée²',     durationMin: 30,  bpmRange: [125, 145], energyRange: [8, 10],
    genres: ['Electro','House'] },
  { name: 'closing',     durationMin: 10,  bpmRange: [85, 115],  energyRange: [2, 5],
    genres: ['Chill','Ambient','Pop','R&B','Disco','COCOVARIET'] },
];

// ─── Load DB ──────────────────────────────────────────────
const db     = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const tracks = db.tracks.filter(t => t.genre && t.genre !== 'EXCLUDED');

console.log(`\n${'═'.repeat(75)}`);
console.log('  🎧 SIMULATION SOIRÉE 6H — AUDIT DJEngine');
console.log(`${'═'.repeat(75)}`);
console.log(`  Base         : ${tracks.length} tracks`);
console.log(`  Durée totale : ${PARTY_DURATION_MIN} min (${PARTY_DURATION_MIN/60}h)`);
console.log(`  Avg track    : ${AVG_TRACK_MIN} min (~${Math.round(PARTY_DURATION_MIN / AVG_TRACK_MIN)} tracks)\n`);

// ─── Simulation ───────────────────────────────────────────
const played      = new Set();
const playlist    = [];   // { time, phase, title, artist, genre, bpm, energy }
let   totalMin    = 0;

const phaseStats = {};

for (const phase of PHASES) {
  const phaseStart = totalMin;
  let phaseTracksPlayed = 0;
  let phaseFails = 0;

  while (totalMin - phaseStart < phase.durationMin && totalMin < PARTY_DURATION_MIN) {
    // Sélection d'un track pour cette phase
    const candidates = tracks.filter(t => {
      if (played.has(t.deezerID)) return false;
      const bpm = t.bpm || 0;
      const energy = t.energy || 5;
      const genre = t.genre || '';

      // BPM dans la range (avec tolérance ±8)
      if (bpm > 0 && (bpm < phase.bpmRange[0] - 8 || bpm > phase.bpmRange[1] + 8)) return false;

      // Energy dans la range (avec tolérance ±2)
      if (energy < phase.energyRange[0] - 1 || energy > phase.energyRange[1] + 1) return false;

      // Genre autorisé
      if (!phase.genres.includes(genre)) return false;

      return true;
    });

    if (candidates.length === 0) {
      // Fallback : relax genre constraint
      const relaxed = tracks.filter(t => {
        if (played.has(t.deezerID)) return false;
        const bpm = t.bpm || 0;
        const energy = t.energy || 5;
        if (bpm > 0 && (bpm < phase.bpmRange[0] - 15 || bpm > phase.bpmRange[1] + 15)) return false;
        if (energy < phase.energyRange[0] - 2 || energy > phase.energyRange[1] + 2) return false;
        return true;
      });

      if (relaxed.length === 0) {
        phaseFails++;
        if (phaseFails > 3) break; // Impossible de remplir cette phase
        continue;
      }

      const pick = relaxed[Math.floor(Math.random() * relaxed.length)];
      played.add(pick.deezerID);

      const timeStr = `${Math.floor(totalMin / 60)}:${String(Math.floor(totalMin % 60)).padStart(2, '0')}`;
      playlist.push({
        time: timeStr, phase: phase.name, title: pick.title, artist: pick.artist,
        genre: pick.genre, bpm: pick.bpm || 0, energy: pick.energy || 0, relaxed: true
      });

      totalMin += AVG_TRACK_MIN;
      phaseTracksPlayed++;
      continue;
    }

    // Scoring : BPM proximity to phase center + energy match
    const phaseCenter = (phase.bpmRange[0] + phase.bpmRange[1]) / 2;
    const energyCenter = (phase.energyRange[0] + phase.energyRange[1]) / 2;

    const scored = candidates.map(t => {
      const bpmDist    = Math.abs((t.bpm || phaseCenter) - phaseCenter);
      const energyDist = Math.abs((t.energy || energyCenter) - energyCenter);
      const rankBonus  = t.rank ? (1000000 - t.rank) / 1000000 * 5 : 0;
      const score      = 20 - bpmDist * 0.3 - energyDist * 2 + rankBonus + Math.random() * 3;
      return { track: t, score };
    }).sort((a, b) => b.score - a.score);

    const pick = scored[0].track;
    played.add(pick.deezerID);

    const timeStr = `${Math.floor(totalMin / 60)}:${String(Math.floor(totalMin % 60)).padStart(2, '0')}`;
    playlist.push({
      time: timeStr, phase: phase.name, title: pick.title, artist: pick.artist,
      genre: pick.genre, bpm: pick.bpm || 0, energy: pick.energy || 0, relaxed: false
    });

    totalMin += AVG_TRACK_MIN;
    phaseTracksPlayed++;
  }

  phaseStats[phase.name] = { tracks: phaseTracksPlayed, fails: phaseFails, candidates: 0 };
}

// ─── Output ───────────────────────────────────────────────
console.log(`${'─'.repeat(75)}`);
console.log('  # │ Time  │ Phase        │ Genre        │ BPM  │ E │ Title');
console.log(`${'─'.repeat(75)}`);

let lastPhase = '';
playlist.forEach((p, i) => {
  if (p.phase !== lastPhase) {
    if (lastPhase) console.log(`  ${'·'.repeat(71)}`);
    lastPhase = p.phase;
  }
  const marker  = p.relaxed ? '⚠' : ' ';
  const num     = String(i + 1).padStart(3);
  const time    = p.time.padStart(5);
  const ph      = p.phase.padEnd(12);
  const genre   = p.genre.padEnd(12);
  const bpm     = String(Math.round(p.bpm)).padStart(4);
  const energy  = String(p.energy).padStart(1);
  const title   = `${p.title} — ${p.artist}`.substring(0, 42);
  console.log(`${marker}${num} │ ${time} │ ${ph} │ ${genre} │ ${bpm} │ ${energy} │ ${title}`);
});

// ─── Stats ────────────────────────────────────────────────
console.log(`\n${'═'.repeat(75)}`);
console.log('  📊 STATS PAR PHASE');
console.log(`${'═'.repeat(75)}`);

const genrePerPhase = {};
playlist.forEach(p => {
  if (!genrePerPhase[p.phase]) genrePerPhase[p.phase] = {};
  genrePerPhase[p.phase][p.genre] = (genrePerPhase[p.phase][p.genre] || 0) + 1;
});

for (const [phase, data] of Object.entries(phaseStats)) {
  const genres = genrePerPhase[phase] || {};
  const genreStr = Object.entries(genres)
    .sort((a,b) => b[1] - a[1])
    .map(([g,c]) => `${g}(${c})`)
    .join(' ');
  console.log(`  ${phase.padEnd(14)}: ${data.tracks} tracks ${data.fails > 0 ? `(⚠ ${data.fails} fails)` : ''}`);
  console.log(`    genres: ${genreStr}`);
}

const avgBPM = Math.round(playlist.reduce((s,p) => s + p.bpm, 0) / playlist.length);
const avgE   = Math.round(playlist.reduce((s,p) => s + p.energy, 0) / playlist.length * 10) / 10;
const relaxed = playlist.filter(p => p.relaxed).length;

console.log(`\n  Total tracks   : ${playlist.length}`);
console.log(`  Tracks uniques : ${played.size}`);
console.log(`  BPM moyen      : ${avgBPM}`);
console.log(`  Énergie moy.   : ${avgE}`);
console.log(`  Fallbacks (⚠)  : ${relaxed}`);
console.log(`  Durée simulée  : ${Math.round(totalMin)} min (${(totalMin/60).toFixed(1)}h)`);
console.log(`${'═'.repeat(75)}\n`);
