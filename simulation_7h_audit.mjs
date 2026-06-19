/**
 * simulation_7h_audit.mjs
 *
 * Simule une soirée de 7h en accéléré — toutes les phases DJBrain
 * Utilise sim_catalogue_918.json (export MongoDB live platine+complète)
 * Aucune mutation de la base — pur audit.
 *
 * Usage : node simulation_7h_audit.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Catalogue live exporté de MongoDB (918 tracks platine+complète)
const SEED_PATH = path.join(__dirname, './sim_catalogue_918.json');

// ─── Config ─────────────────────────────────────────────────────────────────
const PARTY_DURATION_MIN = 420;   // 7 heures
const AVG_TRACK_MIN      = 3.5;   // durée moyenne titre
const GENRE_MAX_CONSEC   = 3;     // rotation anti-fatigue (miroir DJBrain)

// ─── Phases DJBrain (miroir exact de DJBrain.swift Stage enum) ───────────────
// phase tag = valeurs utilisées dans editorial_seed.json ("arrival","ambiance","groove","peak","closing")
const PHASES = [
  {
    name: 'ARRIVAL',    tag: 'arrival',  durationMin: 60,
    bpmRange: [70, 108],  energyRange: [1, 5],
    primaryGenres: ['Pop','R&B','COCOVARIET','Rock','Hip-Hop'],
    description: 'Accueil — doux, accessibles, singalong'
  },
  {
    name: 'AMBIANCE',   tag: 'ambiance', durationMin: 75,
    bpmRange: [90, 118],  energyRange: [4, 7],
    primaryGenres: ['Pop','R&B','Disco','House','COCOVARIET','Latin','Afro'],
    description: 'Ambiance monte — salle se remplit'
  },
  {
    name: 'GROOVE',     tag: 'groove',   durationMin: 90,
    bpmRange: [108, 126], energyRange: [6, 8],
    primaryGenres: ['House','Disco','Hip-Hop','Pop','Latin','Afro','R&B'],
    description: 'Groove — dancefloor commence'
  },
  {
    name: 'PEAK 1',     tag: 'peak',     durationMin: 75,
    bpmRange: [118, 136], energyRange: [8, 10],
    primaryGenres: ['House','Electro','Disco','Hip-Hop','Latin'],
    description: '1er apogée — énergie maximale'
  },
  {
    name: 'GROOVE 2',   tag: 'groove',   durationMin: 45,
    bpmRange: [108, 126], energyRange: [6, 8],
    primaryGenres: ['House','Disco','Hip-Hop','Pop','Afro','Latin'],
    description: '2ème arc — respiration'
  },
  {
    name: 'PEAK 2',     tag: 'peak',     durationMin: 60,
    bpmRange: [118, 140], energyRange: [8, 10],
    primaryGenres: ['House','Electro','Hip-Hop','Disco'],
    description: '2ème apogée — climax final'
  },
  {
    name: 'CLOSING',    tag: 'closing',  durationMin: 45,
    bpmRange: [80, 115],  energyRange: [2, 5],
    primaryGenres: ['Pop','R&B','COCOVARIET','Chill','Disco'],
    description: 'Closing — retour en douceur'
  },
];

// ─── Compatible genres (miroir compatibleGenres() DJBrain.swift) ─────────────
const COMPATIBLE = {
  'House':      ['Electro','Disco','Pop','Afro'],
  'Electro':    ['House','Disco','Pop','Hip-Hop'],
  'Disco':      ['House','Electro','Pop','COCOVARIET'],
  'Hip-Hop':    ['Pop','Afro','Latin','R&B'],
  'Pop':        ['Hip-Hop','Disco','Electro','COCOVARIET','Rock'],
  'Afro':       ['Latin','Hip-Hop','House'],
  'Latin':      ['Afro','Pop','Hip-Hop'],
  'COCOVARIET': ['Pop','Disco','Rock'],
  'Rock':       ['Pop','COCOVARIET','Electro'],
  'Chill':      ['Pop','Disco','House'],
  'R&B':        ['Hip-Hop','Pop','Afro'],
  'Jazz':       ['Pop','Chill'],
};

function isCompatibleGenre(trackGenre, phaseGenres) {
  if (phaseGenres.includes(trackGenre)) return { match: 'primary', bonus: 30 };
  // Voisins compatibles
  for (const pg of phaseGenres) {
    if ((COMPATIBLE[pg] || []).includes(trackGenre)) return { match: 'adjacent', bonus: 10 };
  }
  return null;
}

// ─── Phase tag matching (miroir DJBrain.Phase scoring) ──────────────────────
function phaseScore(track, phaseTag) {
  const p  = track.phase || '';
  const p2 = track.phaseAlt || track.phaseAlternate || '';
  if (p === phaseTag || p2 === phaseTag) return 30;   // ✅ exact match
  // Adjacent phases
  const adjacent = {
    arrival:  ['ambiance'],
    ambiance: ['arrival','groove'],
    groove:   ['ambiance','peak'],
    peak:     ['groove'],
    closing:  ['ambiance','groove'],
  };
  if ((adjacent[phaseTag] || []).includes(p) || (adjacent[phaseTag] || []).includes(p2)) return 10;
  if (p === 'closing' && phaseTag === 'peak') return -1e6;  // BLOCKED
  if (p === 'groove'  && phaseTag === 'arrival') return -1e6;
  return -5; // hors phase
}

// ─── Load catalogue MongoDB export ──────────────────────────────────────────
const rawSeed  = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
const seedData = rawSeed.tracks || rawSeed;

// Normaliser phase : party→peak (harmonisation MongoDB → DJBrain)
const normPhase = p => (p === 'party' ? 'peak' : (p || 'ambiance'));

const tracks = seedData
  .filter(t => t.genre && t.genre !== 'EXCLUDED' && t.genre !== '')
  .map(t => ({
    id:          t.id || t.deezerID || 0,
    title:       t.title || '?',
    artist:      t.artist || '?',
    genre:       t.genre,
    bpm:         t.bpm || 0,
    energy:      t.energy || 5,
    phase:       normPhase(t.phase),
    phaseAlt:    normPhase(t.phaseAlternate || t.phaseAlt || ''),
    danceability:t.danceability || 0.6,
    isBanger:    t.isBanger || false,
    qualityLevel:t.qualityLevel || 'complete',
    rank:        t.rank || 0,
  }));


// ─── Header ─────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(80)}`);
console.log('  🎧  SIMULATION SOIRÉE 7H — AUDIT DJBrain 618 tracks');
console.log(`${'═'.repeat(80)}`);
console.log(`  Seed DB        : ${tracks.length} tracks`);
const genDist = {};
tracks.forEach(t => genDist[t.genre] = (genDist[t.genre] || 0) + 1);
const genStr = Object.entries(genDist).sort((a,b)=>b[1]-a[1]).map(([g,c])=>`${g}:${c}`).join(' ');
console.log(`  Genres         : ${genStr}`);
console.log(`  Durée totale   : ${PARTY_DURATION_MIN} min (${PARTY_DURATION_MIN/60}h)`);
console.log(`  Avg track      : ${AVG_TRACK_MIN} min (~${Math.round(PARTY_DURATION_MIN / AVG_TRACK_MIN)} tracks)\n`);

// ─── Simulation ─────────────────────────────────────────────────────────────
const played       = new Set();
const playlist     = [];
let   totalMin     = 0;
let   dominantGenre = '';          // Miroir dominantGenre DJBrain
let   recentGenres  = [];          // Miroir recentPlayedGenres (max 8)
const phaseStats   = {};

for (const phase of PHASES) {
  const phaseStart    = totalMin;
  let   phaseCount    = 0;
  let   phaseFails    = 0;
  let   phaseRelaxed  = 0;

  console.log(`\n${'─'.repeat(80)}`);
  console.log(`  📍 PHASE: ${phase.name.padEnd(12)} │ ${phase.durationMin}min │ BPM ${phase.bpmRange[0]}-${phase.bpmRange[1]} │ E${phase.energyRange[0]}-${phase.energyRange[1]}`);
  console.log(`     ${phase.description}`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`  # │ Time  │ Genre        │ BPM  │ E  │ Phase     │ Title`);
  console.log(`${'─'.repeat(80)}`);

  while (totalMin - phaseStart < phase.durationMin && totalMin < PARTY_DURATION_MIN) {

    // ── Rotation genre anti-fatigue (miroir DJBrain no-votes logic) ──────────
    const consecutive = (() => {
      let c = 0;
      for (let i = recentGenres.length - 1; i >= 0; i--) {
        if (recentGenres[i] === dominantGenre) c++; else break;
      }
      return c;
    })();
    let effectivePrimaryGenres = phase.primaryGenres;
    if (consecutive >= GENRE_MAX_CONSEC && dominantGenre) {
      // Rotation — exclure dominant temporairement
      const neighbors = COMPATIBLE[dominantGenre] || [];
      const recentSet = new Set(recentGenres.slice(-4));
      const fresh = neighbors.filter(g => !recentSet.has(g) && phase.primaryGenres.includes(g));
      if (fresh.length > 0) {
        effectivePrimaryGenres = fresh;
      }
    }

    // ── Score tous les candidats non joués ───────────────────────────────────
    const phaseCenter   = (phase.bpmRange[0] + phase.bpmRange[1]) / 2;
    const energyCenter  = (phase.energyRange[0] + phase.energyRange[1]) / 2;

    const scored = tracks
      .filter(t => !played.has(t.id) && t.id > 0)
      .map(t => {
        // Phase score
        const ps = phaseScore(t, phase.tag);
        if (ps <= -1e5) return null; // BLOCKED

        // Genre compatibility
        const gc = isCompatibleGenre(t.genre, effectivePrimaryGenres);
        if (!gc) return null;        // Genre incompatible → skip

        // BPM score (tolérance ±15 en relaxed)
        const bpm = t.bpm || phaseCenter;
        const bpmOk = bpm >= phase.bpmRange[0] - 8 && bpm <= phase.bpmRange[1] + 8;
        if (!bpmOk) return null;

        // Energy score
        const eOk = t.energy >= phase.energyRange[0] - 1 && t.energy <= phase.energyRange[1] + 1;
        if (!eOk) return null;

        const bpmDist    = Math.abs(bpm - phaseCenter);
        const energyDist = Math.abs(t.energy - energyCenter);
        const rankBonus  = t.rank ? Math.min(10, (t.rank / 500000) * 5) : 0;

        // Continuity bonus (miroir continuityBonus)
        let contBonus = 0;
        const last3 = recentGenres.slice(-3);
        const matchCount = last3.filter(g => g === t.genre).length;
        const consecFor = (() => { let c=0; for(let i=recentGenres.length-1;i>=0;i--){if(recentGenres[i]===t.genre)c++;else break;} return c; })();
        const decay = consecFor <= 3 ? 1.0 : consecFor === 4 ? 0.67 : consecFor === 5 ? 0.33 : 0.0;
        contBonus = matchCount * 6 * decay;

        const score = ps + gc.bonus + contBonus - bpmDist * 0.3 - energyDist * 2 + rankBonus + Math.random() * 3;
        return { track: t, score, phaseMatch: ps >= 30 ? '✅' : '🟡', genreMatch: gc.match };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    // ── Fallback relaxed si pas de candidat ─────────────────────────────────
    let pick = null;
    let relaxed = false;

    if (scored.length > 0) {
      // Prend le top 3 avec une part de hasard (miroir prefix(6) + aléatoire)
      const pool = scored.slice(0, Math.min(6, scored.length));
      const chosen = pool[Math.floor(Math.random() * Math.min(3, pool.length))];
      pick = chosen;
    } else {
      // Relaxed : BPM ±20, energy ±2, tout genre
      const relaxedCandidates = tracks
        .filter(t => !played.has(t.id) && t.id > 0)
        .filter(t => {
          const bpm = t.bpm || phaseCenter;
          return bpm >= phase.bpmRange[0] - 20 && bpm <= phase.bpmRange[1] + 20
              && t.energy >= phase.energyRange[0] - 2 && t.energy <= phase.energyRange[1] + 2;
        });
      if (relaxedCandidates.length === 0) { phaseFails++; if (phaseFails > 5) break; continue; }
      const r = relaxedCandidates[Math.floor(Math.random() * relaxedCandidates.length)];
      pick = { track: r, score: 0, phaseMatch: '⚠️', genreMatch: 'relaxed' };
      relaxed = true;
      phaseRelaxed++;
    }

    // ── Enregistrement ───────────────────────────────────────────────────────
    played.add(pick.track.id);
    recentGenres.push(pick.track.genre);
    if (recentGenres.length > 8) recentGenres.shift();
    dominantGenre = pick.track.genre; // Simplifié — en vrai c'est basé sur votes

    const timeStr = `${Math.floor(totalMin / 60)}:${String(Math.floor(totalMin % 60)).padStart(2, '0')}`;
    const entry = {
      time: timeStr, phase: phase.name, phaseLine: phase.tag,
      title: pick.track.title, artist: pick.track.artist,
      genre: pick.track.genre, bpm: pick.track.bpm || 0,
      energy: pick.track.energy || 0,
      phaseMatch: pick.phaseMatch, genreMatch: pick.genreMatch,
      relaxed
    };
    playlist.push(entry);

    // Log ligne
    const marker  = relaxed ? '⚠' : ' ';
    const num     = String(phaseCount + 1).padStart(3);
    const genre   = pick.track.genre.padEnd(12);
    const bpm     = String(Math.round(pick.track.bpm || 0)).padStart(4);
    const energy  = String(pick.track.energy || 0).padStart(2);
    const pMatch  = pick.phaseMatch;
    const title   = `${pick.track.title} — ${pick.track.artist}`.substring(0, 42);
    console.log(`${marker}${num} │ ${timeStr.padStart(5)} │ ${genre} │ ${bpm} │ ${energy} │ ${pMatch}        │ ${title}`);

    totalMin += AVG_TRACK_MIN;
    phaseCount++;
  }

  phaseStats[phase.name] = {
    tracks: phaseCount, fails: phaseFails, relaxed: phaseRelaxed,
    duration: Math.round(totalMin - phaseStart)
  };
}

// ─── Stats finales ───────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(80)}`);
console.log('  📊  STATS PAR PHASE');
console.log(`${'═'.repeat(80)}`);

const genrePerPhase = {};
playlist.forEach(p => {
  if (!genrePerPhase[p.phase]) genrePerPhase[p.phase] = {};
  genrePerPhase[p.phase][p.genre] = (genrePerPhase[p.phase][p.genre] || 0) + 1;
});

let totalFails = 0, totalRelaxed = 0;
for (const [phaseName, data] of Object.entries(phaseStats)) {
  const genres = genrePerPhase[phaseName] || {};
  const genreStr = Object.entries(genres).sort((a,b)=>b[1]-a[1]).map(([g,c])=>`${g}(${c})`).join(' ');
  const warning = data.relaxed > 0 ? ` ⚠ ${data.relaxed} relaxed` : '';
  const fail    = data.fails > 0   ? ` ❌ ${data.fails} fails` : '';
  console.log(`  ${phaseName.padEnd(14)}: ${String(data.tracks).padStart(2)} tracks / ${data.duration}min${warning}${fail}`);
  console.log(`    Genres: ${genreStr || '—'}`);
  totalFails   += data.fails;
  totalRelaxed += data.relaxed;
}

// BPM curve analysis
console.log(`\n${'═'.repeat(80)}`);
console.log('  📈  COURBE BPM PAR PHASE');
console.log(`${'═'.repeat(80)}`);
for (const phase of PHASES) {
  const pTracks = playlist.filter(p => p.phase === phase.name && p.bpm > 0);
  if (pTracks.length === 0) continue;
  const avgBPM = Math.round(pTracks.reduce((s,p) => s + p.bpm, 0) / pTracks.length);
  const avgE   = (pTracks.reduce((s,p) => s + p.energy, 0) / pTracks.length).toFixed(1);
  const bar    = '█'.repeat(Math.round(avgBPM / 10));
  console.log(`  ${phase.name.padEnd(12)} │ BPM ${String(avgBPM).padStart(3)} ${bar} │ Énergie moy: ${avgE}`);
}

// Global summary
const avgBPM     = Math.round(playlist.filter(p=>p.bpm>0).reduce((s,p)=>s+p.bpm,0) / playlist.filter(p=>p.bpm>0).length);
const avgEnergy  = (playlist.reduce((s,p)=>s+p.energy,0) / playlist.length).toFixed(1);
const relaxedPct = Math.round(totalRelaxed / playlist.length * 100);
const phaseMatchPct = Math.round(playlist.filter(p=>p.phaseMatch==='✅').length / playlist.length * 100);

console.log(`\n${'═'.repeat(80)}`);
console.log('  🎯  VERDICT GLOBAL');
console.log(`${'═'.repeat(80)}`);
console.log(`  Total tracks joués  : ${playlist.length} / ${tracks.length} disponibles (${Math.round(played.size/tracks.length*100)}% catalogue utilisé)`);
console.log(`  BPM moyen global    : ${avgBPM}`);
console.log(`  Énergie moyenne     : ${avgEnergy} / 10`);
console.log(`  Phase match exact ✅: ${phaseMatchPct}%  (cible > 60%)`);
console.log(`  Fallbacks relaxed ⚠ : ${relaxedPct}%  (cible < 20%)`);
console.log(`  Fails totaux ❌      : ${totalFails}`);

// Verdict
const verdict = phaseMatchPct >= 60 && relaxedPct <= 20 && totalFails === 0
  ? '✅ VERT — Soirée cohérente, DJ Brain prêt pour 7h'
  : phaseMatchPct >= 45 && relaxedPct <= 35
  ? '🟡 ORANGE — Cohérence correcte, quelques lacunes de catalogue'
  : '🔴 ROUGE — Catalogue insuffisant ou déséquilibré pour certaines phases';

console.log(`\n  ${verdict}`);
console.log(`${'═'.repeat(80)}\n`);

// ─── Export JSON (pour analyse) ──────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  config: { durationMin: PARTY_DURATION_MIN, totalTracks: tracks.length },
  summary: { totalPlayed: playlist.length, avgBPM, avgEnergy: parseFloat(avgEnergy), phaseMatchPct, relaxedPct, totalFails },
  phaseStats,
  playlist
};
fs.writeFileSync(path.join(__dirname, 'simulation_7h_report.json'), JSON.stringify(report, null, 2));
console.log(`  📄 Rapport JSON : relay-server/simulation_7h_report.json\n`);
