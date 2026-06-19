import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Track from './models/Track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ─────────────────────────────────────────────────────────────────
const PARTY_DURATION_MIN = 450;   // 7h30
const AVG_TRACK_MIN      = 3.5;   // durée moyenne titre
const GENRE_MAX_CONSEC   = 3;     // rotation anti-fatigue

const PHASES = [
  { name: 'ARRIVAL',    tag: 'arrival',  durationMin: 60, bpmRange: [70, 108],  energyRange: [1, 5], primaryGenres: ['Pop','R&B','COCOVARIET','Rock','Hip-Hop'] },
  { name: 'AMBIANCE',   tag: 'ambiance', durationMin: 75, bpmRange: [90, 118],  energyRange: [4, 7], primaryGenres: ['Pop','R&B','Disco','House','COCOVARIET','Latin','Afro'] },
  { name: 'GROOVE',     tag: 'groove',   durationMin: 90, bpmRange: [108, 126], energyRange: [6, 8], primaryGenres: ['House','Disco','Hip-Hop','Pop','Latin','Afro','R&B'] },
  { name: 'PEAK 1',     tag: 'peak',     durationMin: 75, bpmRange: [118, 136], energyRange: [8, 10], primaryGenres: ['House','Electro','Disco','Hip-Hop','Latin'] },
  { name: 'GROOVE 2',   tag: 'groove',   durationMin: 45, bpmRange: [108, 126], energyRange: [6, 8], primaryGenres: ['House','Disco','Hip-Hop','Pop','Afro','Latin'] },
  { name: 'PEAK 2',     tag: 'peak',     durationMin: 60, bpmRange: [118, 140], energyRange: [8, 10], primaryGenres: ['House','Electro','Hip-Hop','Disco'] },
  { name: 'CLOSING',    tag: 'closing',  durationMin: 85, bpmRange: [70, 140],  energyRange: [3, 10], primaryGenres: ['Pop','R&B','COCOVARIET','Chill','Disco','House','Electro','Hip-Hop','Latin','Rock','Afro'] }
];

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
  for (const pg of phaseGenres) { if ((COMPATIBLE[pg] || []).includes(trackGenre)) return { match: 'adjacent', bonus: 10 }; }
  return null;
}

function phaseScore(track, phaseTag) {
  const p  = track.phase || '';
  if (p === phaseTag) return 30;
  const adjacent = { arrival: ['ambiance'], ambiance: ['arrival','groove'], groove: ['ambiance','peak'], peak: ['groove'], closing: ['ambiance','groove'] };
  if ((adjacent[phaseTag] || []).includes(p)) return 10;
  if (p === 'closing' && phaseTag === 'peak') return -1e6;
  if (p === 'groove'  && phaseTag === 'arrival') return -1e6;
  return -5;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Loading tracks from MongoDB...");
  
  const rawTracks = await Track.find({ genre: { $nin: ['EXCLUDED', '', null] }, phase: { $ne: null } }).lean();
  
  const normPhase = p => (p === 'party' ? 'peak' : (p || 'ambiance'));

  const tracks = rawTracks.map(t => ({
    id:          t._id.toString(),
    title:       t.title || '?',
    artist:      t.artist || '?',
    genre:       t.genre,
    bpm:         t.bpm || 0,
    energy:      t.energy || 5,
    phase:       normPhase(t.phase),
    isBanger:    t.isBanger || false,
    rank:        0,
  }));

  let out = `# Simulation Soirée 7H (Current DB)\n\n`;
  out += `**Seed DB**: ${tracks.length} tracks\n`;
  out += `**Durée**: ${PARTY_DURATION_MIN} min\n\n`;

  const played = new Set();
  const playlist = [];
  let totalMin = 0;
  let dominantGenre = '';
  let recentGenres = [];
  const phaseStats = {};

  for (const phase of PHASES) {
    const phaseStart = totalMin;
    let phaseCount = 0;
    let phaseFails = 0;
    let phaseRelaxed = 0;

    out += `\n## Phase: ${phase.name} (${phase.durationMin}min)\n`;
    out += `*BPM ${phase.bpmRange[0]}-${phase.bpmRange[1]} | Energy ${phase.energyRange[0]}-${phase.energyRange[1]}*\n\n`;
    out += `| Time | Genre | BPM | NRG | Pri. | Match | Score | Title |\n`;
    out += `|---|---|---|---|---|---|---|---|\n`;

    while (totalMin - phaseStart < phase.durationMin && totalMin < PARTY_DURATION_MIN) {
      const consecutive = (() => {
        let c = 0;
        for (let i = recentGenres.length - 1; i >= 0; i--) {
          if (recentGenres[i] === dominantGenre) c++; else break;
        }
        return c;
      })();
      let effectivePrimaryGenres = phase.primaryGenres;
      if (consecutive >= GENRE_MAX_CONSEC && dominantGenre) {
        const neighbors = COMPATIBLE[dominantGenre] || [];
        const recentSet = new Set(recentGenres.slice(-4));
        const fresh = neighbors.filter(g => !recentSet.has(g) && phase.primaryGenres.includes(g));
        if (fresh.length > 0) effectivePrimaryGenres = fresh;
      }

      const phaseCenter = (phase.bpmRange[0] + phase.bpmRange[1]) / 2;
      const energyCenter = (phase.energyRange[0] + phase.energyRange[1]) / 2;

      const scored = tracks
        .filter(t => !played.has(t.id))
        .map(t => {
          const ps = phaseScore(t, phase.tag);
          if (ps <= -1e5) return null;
          const gc = isCompatibleGenre(t.genre, effectivePrimaryGenres);
          if (!gc) return null;
          const bpm = t.bpm || phaseCenter;
          if (bpm < phase.bpmRange[0] - 8 || bpm > phase.bpmRange[1] + 8) return null;
          const bangerBonus = t.isBanger ? 15 : 0;
          const fillerMalus = t.isFiller ? -10 : 0;
          const score = ps + gc.bonus + bangerBonus + fillerMalus - Math.abs(bpm - phaseCenter)*0.3 - Math.abs(t.energy - energyCenter)*2 + Math.random()*3;
          return { track: t, score, phaseMatch: ps >= 30 ? '✅' : '🟡', genreMatch: gc.match };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

      let pick = null;
      let relaxed = false;

      if (scored.length > 0) {
        const pool = scored.slice(0, Math.min(6, scored.length));
        pick = pool[Math.floor(Math.random() * Math.min(3, pool.length))];
      } else {
        const relaxedCandidates = tracks
          .filter(t => !played.has(t.id))
          .filter(t => {
            const bpm = t.bpm || phaseCenter;
            return bpm >= phase.bpmRange[0] - 20 && bpm <= phase.bpmRange[1] + 20 &&
                   t.energy >= phase.energyRange[0] - 2 && t.energy <= phase.energyRange[1] + 2;
          });
        if (relaxedCandidates.length === 0) { phaseFails++; if (phaseFails > 5) break; continue; }
        pick = { track: relaxedCandidates[Math.floor(Math.random() * relaxedCandidates.length)], score: 0, phaseMatch: '⚠️', genreMatch: 'relaxed' };
        relaxed = true;
        phaseRelaxed++;
      }

      played.add(pick.track.id);
      recentGenres.push(pick.track.genre);
      if (recentGenres.length > 8) recentGenres.shift();
      dominantGenre = pick.track.genre;

      const timeStr = `${Math.floor(totalMin / 60)}:${String(Math.floor(totalMin % 60)).padStart(2, '0')}`;
      const marker = relaxed ? '⚠️' : pick.phaseMatch;
      const prioMark = pick.track.isBanger ? '🔥 IN' : (pick.track.isFiller ? '⏳ F' : '📦 BK');
      const roundedScore = pick.score.toFixed(1);
      
      out += `| ${timeStr} | ${pick.track.genre} | ${Math.round(pick.track.bpm)} | ${pick.track.energy} | ${prioMark} | ${marker} | ${roundedScore} | **${pick.track.title}** - ${pick.track.artist} |\n`;

      totalMin += AVG_TRACK_MIN;
      phaseCount++;
      playlist.push(pick);
    }
    phaseStats[phase.name] = { tracks: phaseCount, fails: phaseFails, relaxed: phaseRelaxed, duration: Math.round(totalMin - phaseStart) };
  }

  out += `\n## 📊 STATS PAR PHASE\n`;
  let totalFails = 0, totalRelaxed = 0;
  for (const [phaseName, data] of Object.entries(phaseStats)) {
    out += `- **${phaseName}**: ${data.tracks} tracks / ${data.duration}min`;
    if (data.relaxed > 0) out += ` (⚠️ ${data.relaxed} relaxed)`;
    if (data.fails > 0) out += ` (❌ ${data.fails} fails)`;
    out += `\n`;
    totalFails += data.fails;
    totalRelaxed += data.relaxed;
  }

  const avgBPM = Math.round(playlist.filter(p=>p.track.bpm>0).reduce((s,p)=>s+p.track.bpm,0) / playlist.filter(p=>p.track.bpm>0).length);
  const avgEnergy = (playlist.reduce((s,p)=>s+p.track.energy,0) / playlist.length).toFixed(1);
  const relaxedPct = Math.round(totalRelaxed / playlist.length * 100);
  const phaseMatchPct = Math.round(playlist.filter(p=>p.phaseMatch==='✅').length / playlist.length * 100);

  out += `\n## 🎯 VERDICT GLOBAL\n`;
  out += `- **Total tracks joués** : ${playlist.length} / ${tracks.length} disponibles\n`;
  out += `- **BPM moyen global** : ${avgBPM}\n`;
  out += `- **Énergie moyenne** : ${avgEnergy} / 10\n`;
  out += `- **Phase match exact ✅** : ${phaseMatchPct}%\n`;
  out += `- **Fallbacks relaxed ⚠️** : ${relaxedPct}%\n`;
  out += `- **Fails totaux ❌** : ${totalFails}\n`;

  const verdict = phaseMatchPct >= 60 && relaxedPct <= 20 && totalFails === 0 ? '✅ VERT — Soirée cohérente' : phaseMatchPct >= 45 && relaxedPct <= 35 ? '🟡 ORANGE — Cohérence correcte' : '🔴 ROUGE — Catalogue insuffisant';
  out += `\n### Verdict: ${verdict}\n`;

  fs.writeFileSync('../SIMULATION_7H30_CLOSING_BAZAR.md', out);
  console.log('Simulation complete. Written to SIMULATION_7H30_CLOSING_BAZAR.md');
  process.exit(0);
}
run().catch(console.error);
