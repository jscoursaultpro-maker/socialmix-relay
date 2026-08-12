/**
 * services/freshnessScoring.js — Fresh Rotation V2 scoring engine
 *
 * Continuous exponential decay replacing V1 cliff-based tiers.
 * Formula: score = 100 * (1 - exp(-daysAgo / TAU))
 *
 * TAU = 15 days (half-life ~10.4j, 63% recovery at 15j, 86% at 30j, 98% at 60j)
 * Score range: 0 (just played) → 100 (never played)
 *
 * ADR: Social M/SPEC_FreshRotation_V1.md + relay-server/docs/FreshRotation_V2_ADR.md
 */

/** Decay time constant in days. Higher = slower recovery. */
export const FRESHNESS_TAU = 15;

/** Bonus applied iOS-side to isBanger tracks (info-only here, consumed by DJBrain). */
export const BANGER_BOOST = 20;

/** Score returned for tracks never played by this host. */
export const NEVER_PLAYED_SCORE = 100;

/**
 * Compute freshness score based on time since last play.
 * Continuous exponential decay — no cliff, no tiers.
 *
 * @param {number|null|undefined} daysAgo — days since last played by this host
 * @returns {number} score 0–100 (higher = fresher / more favored)
 */
export function computeFreshnessScore(daysAgo) {
  if (daysAgo === null || daysAgo === undefined) return NEVER_PLAYED_SCORE;
  if (daysAgo < 0) return 0;  // safety: negative = just played or clock drift
  return Math.round(100 * (1 - Math.exp(-daysAgo / FRESHNESS_TAU)));
}

/**
 * Map V2 continuous score → V1 legacy tier value for backward compat.
 *
 * iOS app (before Prompt B migration) expects scalar scores:
 *   50  = NEVER_PLAYED_BY_HOST (default when absent from map)
 *   30  = PLAYED_OVER_30D_AGO
 *   10  = PLAYED_15_TO_30D_AGO
 *  -100 = PLAYED_UNDER_15D_AGO
 *
 * ⚠️ Legacy mode loses the PLAYED_IN_LAST_3_PARTIES (-80) penalty
 *    which is not expressible in a single score. Acceptable because
 *    Prompt B iOS migration follows quickly and will use ?v=2.
 *
 * @param {number} freshnessScore — V2 continuous score 0-100
 * @returns {number} V1 legacy tier value
 */
export function toLegacyScore(freshnessScore) {
  if (freshnessScore >= 80) return 30;   // ≈ played >30d ago
  if (freshnessScore >= 40) return 10;   // ≈ played 15-30d ago
  return -100;                           // ≈ played <15d ago
}

/** Phases where banger boost applies (mirrors DJBrain.swift SessionStage). */
export const BANGER_ELIGIBLE_PHASES = new Set(['takeoff', 'groove', 'party', 'closing']);

/**
 * Simulate the composite scoring adjustment applied by DJBrain iOS.
 * Mirrors DJBrain.swift logic (Task #44 Prompt B, commit 9a4acc0).
 *
 * Purpose: backend-side testing of doctrine rules (banger boost,
 * guest override, phase eligibility) without requiring XCTest setup.
 *
 * @param {object} opts
 * @param {number} opts.freshnessScore - Base score 0-100 from endpoint
 * @param {boolean} opts.isBanger - Track.isBanger flag
 * @param {string} opts.stage - SessionStage rawValue (arrival|ambiance|takeoff|groove|party|closing)
 * @param {boolean} opts.isGuestSuggestion - True if track is a guest suggestion
 * @returns {number} Final freshness contribution to composite (can exceed 100 with banger boost)
 */
export function simulateIosComposite({ freshnessScore, isBanger, stage, isGuestSuggestion }) {
  // Guest override: bypass freshnessScore entirely (doctrine: guest choice prime)
  if (isGuestSuggestion) {
    return 100;
  }
  let score = freshnessScore;
  // Banger boost ONLY on high-energy phases (not arrival/ambiance)
  if (isBanger && BANGER_ELIGIBLE_PHASES.has(stage)) {
    score += BANGER_BOOST;  // +20
  }
  return score;
}
