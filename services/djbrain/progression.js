/**
 * services/djbrain/progression.js
 * ★ DJ Brain Cloud — progression temporelle des phases (port 1:1 de DJBrain.swift currentStage/effectiveStage).
 *
 * Progression au temps écoulé depuis le début de la phase de base, en cascade.
 * Surcouches : override manuel de phase, lock (fige), retour-de-flamme party⇄closing si énergie ≥ 70.
 *
 * energyLevel : échelle 0-100 (côté serveur = vibeScore 0-10 × 10).
 */

const FLAME_RETURN_THRESHOLD = 70; // énergie ≥ 70 → reste en party au lieu de passer en closing (calibrable, Task #113)
const STAGE_SET = new Set(['arrival', 'ambiance', 'takeoff', 'groove', 'party', 'closing']);

/** Cascade temps→phase depuis une phase de base. elapsedMins en minutes. Port 1:1. */
function timeBasedStage(baseAutoStage, elapsedMins) {
  switch (baseAutoStage) {
    case 'arrival':
      if (elapsedMins >= 290) return 'closing';
      if (elapsedMins >= 180) return 'party';
      if (elapsedMins >= 110) return 'groove';
      if (elapsedMins >= 80)  return 'takeoff';
      if (elapsedMins >= 40)  return 'ambiance';
      return 'arrival';
    case 'ambiance':
      if (elapsedMins >= 250) return 'closing';
      if (elapsedMins >= 140) return 'party';
      if (elapsedMins >= 70)  return 'groove';
      if (elapsedMins >= 40)  return 'takeoff';
      return 'ambiance';
    case 'takeoff':
      if (elapsedMins >= 210) return 'closing';
      if (elapsedMins >= 100) return 'party';
      if (elapsedMins >= 30)  return 'groove';
      return 'takeoff';
    case 'groove':
      if (elapsedMins >= 180) return 'closing';
      if (elapsedMins >= 70)  return 'party';
      return 'groove';
    case 'party':
      if (elapsedMins >= 110) return 'closing';
      return 'party';
    case 'closing':
      return 'closing';
    default:
      return 'arrival';
  }
}

/**
 * Calcule la phase effective d'une soirée.
 * @param {object} p
 * @param {string}  [p.baseAutoStage='arrival'] phase de base de la cascade
 * @param {number}  [p.sessionStartMs]  epoch ms du début de la phase de base (phaseStartedAt || startedAt)
 * @param {number}  [p.nowMs=Date.now()]
 * @param {number}  [p.energyLevel=50]  0-100
 * @param {string|null} [p.override=null] phase forcée par l'hôte (sessionModeOverride ≠ auto)
 * @param {boolean} [p.locked=false]     phase gelée (isPhaseLocked)
 * @param {string}  [p.lockedStage]      phase à geler quand locked=true (défaut = currentStage calculé)
 * @returns {{stage:string, elapsedMins:number, auto:boolean}}
 */
export function computeStage({
  baseAutoStage = 'arrival',
  sessionStartMs,
  nowMs = Date.now(),
  energyLevel = 50,
  override = null,
  locked = false,
  lockedStage = null,
} = {}) {
  const elapsedMins = sessionStartMs ? Math.floor((nowMs - sessionStartMs) / 60000) : 0;

  // Override manuel : la phase forcée prime (sauf 'auto').
  if (override && override !== 'auto' && STAGE_SET.has(override)) {
    return { stage: override, elapsedMins, auto: false };
  }

  let stage = timeBasedStage(baseAutoStage, elapsedMins);

  // Retour de flamme : le temps veut closing mais l'énergie est haute → rester en party.
  if (stage === 'closing' && energyLevel >= FLAME_RETURN_THRESHOLD) {
    stage = 'party';
  }

  // Lock : fige la progression sur la phase courante.
  if (locked) {
    return { stage: lockedStage || stage, elapsedMins, auto: false };
  }

  return { stage, elapsedMins, auto: true };
}
