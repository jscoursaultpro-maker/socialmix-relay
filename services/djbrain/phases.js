/**
 * services/djbrain/phases.js
 * ★ DJ Brain Cloud — dramaturgie des 6 phases (port 1:1 de DJBrain.swift SessionStage).
 *
 * Source de vérité : SocialMixApp/Engine/DJBrain.swift (enum SessionStage) + doctrine
 * scripts/curation/DRAMATURGIE_MEMORIES.md (closing = « Memories » = feu d'artifice).
 *
 * Clés internes INCHANGÉES (arrival|ambiance|takeoff|groove|party|closing) — elles servent
 * la BDD (Track.phase), l'adjacence et l'app iOS. "closing" s'affiche « Memories ».
 *
 * Toutes les constantes sont reproduites telles quelles (aucun changement de doctrine).
 */

export const STAGES = ['arrival', 'ambiance', 'takeoff', 'groove', 'party', 'closing'];

// Nom affiché + emoji (iOS : closing → « Memories » 🎬, party → 🚀)
export const STAGE_LABEL = {
  arrival:  { emoji: '🌅', name: 'Arrivée' },
  ambiance: { emoji: '🎷', name: 'Ambiance' },
  takeoff:  { emoji: '⚡', name: 'Décollage' },
  groove:   { emoji: '🕺', name: 'Groove' },
  party:    { emoji: '🚀', name: 'Fête' },
  closing:  { emoji: '🎬', name: 'Memories' },
};

// Bande d'énergie cible [min,max] par phase (échelle 0-10)
export const ENERGY_RANGE = {
  arrival:  [3.5, 5.0],
  ambiance: [5.0, 6.5],
  takeoff:  [6.5, 7.5],
  groove:   [7.5, 8.5],
  party:    [8.5, 9.5],
  closing:  [7.0, 10.0],
};

export function targetEnergy(stage) {
  const r = ENERGY_RANGE[stage] || ENERGY_RANGE.groove;
  return (r[0] + r[1]) / 2.0;
}

// Poids du vote guests (influence de la tendance) par phase
export const TREND_WEIGHT = {
  arrival: 0.00, ambiance: 0.25, takeoff: 0.10, groove: 0.60, party: 0.50, closing: 0.15,
};

// Multiplicateur de boost des suggestions guests par phase (phases sociales généreuses,
// phases peak exigeantes) — DJBrain.swift computeNextTrack phaseMultiplier.
export const SUGGESTION_PHASE_MULT = {
  arrival: 1.5, ambiance: 1.4, groove: 1.0, takeoff: 0.6, party: 0.3, closing: 1.6,
};

/**
 * Bonus/malus de popularité ajouté au composite, selon la phase (candPop sur 0-10).
 * Port 1:1 de SessionStage.popularityBonus(for:).
 */
export function popularityBonus(stage, candPop) {
  switch (stage) {
    case 'arrival':
      if (candPop > 8.0) return -35.0;          // garder les hymnes pour plus tard
      if (candPop >= 3.0) return candPop * 2.5;
      return 0.0;
    case 'ambiance':
      if (candPop > 9.0) return -5.0;
      if (candPop >= 4.0) return candPop * 1.5;
      return 0.0;
    case 'takeoff':
      return 0.0;                                // neutre, assertif
    case 'groove':
      if (candPop < 3.0) return -10.0;
      return candPop * -1.0;                     // qualité > popularité
    case 'party':
      if (candPop > 8.0) return 30.0;            // on sort les hymnes
      if (candPop < 5.0) return -15.0;
      return 0.0;
    case 'closing':
      if (candPop >= 3.0) return candPop * 1.0;  // chaleur familière
      return 0.0;
    default:
      return 0.0;
  }
}

/**
 * Genres autorisés par phase (routing). null = tous genres autorisés.
 * Port 1:1 de stageGenreRouting(for:). Les libellés suivent la connaissance DJBrain
 * (macro-genres) ; le mapping vers genreBDD se fait dans scoring.js (isGenreAllowed).
 */
export function stageGenreRouting(stage) {
  switch (stage) {
    case 'arrival':
      return ['Pop', 'Disco', 'R&B', 'Hip-Hop', 'Rock', 'Soul', 'Lounge', 'Jazz', 'Chill', 'COCOVARIET'];
    case 'ambiance':
      return ['Pop', 'Disco', 'R&B', 'Latin', 'Afro', 'Hip-Hop', 'Soul', 'Funk', 'Chill', 'COCOVARIET', 'Rock'];
    case 'takeoff':
      return ['House', 'Electro', 'Hip-Hop', 'Latin', 'Pop', 'Afro', 'Disco', 'Funk', 'R&B', 'COCOVARIET'];
    case 'groove':
    case 'party':
      return null; // tous genres
    case 'closing':
      return ['Pop', 'Rock', 'Disco', 'R&B', 'Latin', 'Hip-Hop', 'Soul', 'COCOVARIET'];
    default:
      return null;
  }
}

// Adjacence de phase (un titre tagué phase X est jouable dans ces phases). Port 1:1.
const PHASE_ADJACENCY = {
  arrival:  new Set(['arrival', 'ambiance']),
  ambiance: new Set(['ambiance', 'arrival', 'takeoff']),
  takeoff:  new Set(['takeoff', 'ambiance', 'groove']),
  groove:   new Set(['groove', 'takeoff', 'party']),
  party:    new Set(['party', 'groove', 'closing']),
  closing:  new Set(['closing', 'party']),
};

/** Un titre tagué `trackPhase` est-il jouable à l'étape courante `currentStage` ? */
export function isPhaseCompatible(trackPhase, currentStage) {
  if (!trackPhase) return true; // titre sans phase : compatibilité gérée ailleurs (BDD prime)
  const p = trackPhase === 'arrivée' ? 'arrival' : trackPhase;
  return PHASE_ADJACENCY[p]?.has(currentStage) ?? false;
}

// Phases où un banger reçoit le BANGER_BOOST (+20 de fraîcheur).
export const BANGER_BOOST_PHASES = new Set(['takeoff', 'groove', 'party', 'closing']);

// Poids composite (port 1:1).
export const WEIGHTS = {
  genre: 0.35, energy: 0.18, bpm: 0.15, popularity: 0.12, suggestion: 0.12, variety: 0.04,
};

export const ARTIST_COOLDOWN_MINUTES = 100;
export const CROSS_PARTY_WINDOW = 8; // N=8 (override possible via l'API freshness)
