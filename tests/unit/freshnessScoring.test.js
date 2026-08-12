/**
 * tests/unit/freshnessScoring.test.js
 *
 * Task #44 — Test unitaire F1 : formule de scoring Fresh Rotation V2
 * Runner: node --test tests/unit/freshnessScoring.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFreshnessScore,
  NEVER_PLAYED_SCORE,
  toLegacyScore,
  simulateIosComposite,
} from '../../services/freshnessScoring.js';

// ═══════════════════════════════════════════════════════════════════════
// F1a — Never played → max score
// ═══════════════════════════════════════════════════════════════════════
test('F1a: never played returns max score', () => {
  assert.equal(computeFreshnessScore(null), NEVER_PLAYED_SCORE);
  assert.equal(computeFreshnessScore(undefined), NEVER_PLAYED_SCORE);
});

// ═══════════════════════════════════════════════════════════════════════
// F1b — Played just now → 0
// ═══════════════════════════════════════════════════════════════════════
test('F1b: played just now returns 0', () => {
  assert.equal(computeFreshnessScore(0), 0);
});

// ═══════════════════════════════════════════════════════════════════════
// F1c — Exponential decay at known TAU=15 checkpoints
// ═══════════════════════════════════════════════════════════════════════
test('F1c: decay follows exponential formula', () => {
  // TAU=15 → at 15 days: 100*(1-exp(-1)) ≈ 63.21 → round 63
  // at 30 days: 100*(1-exp(-2)) ≈ 86.47 → round 86
  // at 60 days: 100*(1-exp(-4)) ≈ 98.17 → round 98
  assert.equal(computeFreshnessScore(15), 63);
  assert.equal(computeFreshnessScore(30), 86);
  assert.equal(computeFreshnessScore(60), 98);
});

// ═══════════════════════════════════════════════════════════════════════
// F1d — Monotonically increasing
// ═══════════════════════════════════════════════════════════════════════
test('F1d: monotonically increasing', () => {
  for (let d = 0; d < 100; d++) {
    assert.ok(
      computeFreshnessScore(d) <= computeFreshnessScore(d + 1),
      `score(${d})=${computeFreshnessScore(d)} > score(${d + 1})=${computeFreshnessScore(d + 1)}`
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════
// F1e — Bounded 0–100
// ═══════════════════════════════════════════════════════════════════════
test('F1e: bounded 0-100', () => {
  for (const d of [0, 1, 5, 15, 30, 60, 90, 180, 365, 1000]) {
    const s = computeFreshnessScore(d);
    assert.ok(s >= 0 && s <= 100, `score ${s} out of bounds for ${d} days`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// F1f — Negative daysAgo safety
// ═══════════════════════════════════════════════════════════════════════
test('F1f: negative daysAgo safety', () => {
  assert.equal(computeFreshnessScore(-5), 0);
  assert.equal(computeFreshnessScore(-0.1), 0);
});

// ═══════════════════════════════════════════════════════════════════════
// F1g — toLegacyScore tier mapping
// ═══════════════════════════════════════════════════════════════════════
test('F1g: toLegacyScore maps to V1 tiers correctly', () => {
  // score >= 80 → 30 (PLAYED_OVER_30D_AGO)
  assert.equal(toLegacyScore(80), 30);
  assert.equal(toLegacyScore(93), 30);  // 40 days ago
  assert.equal(toLegacyScore(100), 30); // never played

  // score 40-79 → 10 (PLAYED_15_TO_30D_AGO)
  assert.equal(toLegacyScore(40), 10);
  assert.equal(toLegacyScore(63), 10);  // 15 days ago
  assert.equal(toLegacyScore(79), 10);

  // score < 40 → -100 (PLAYED_UNDER_15D_AGO)
  assert.equal(toLegacyScore(0), -100);
  assert.equal(toLegacyScore(28), -100); // 5 days ago
  assert.equal(toLegacyScore(39), -100);
});

// ═══════════════════════════════════════════════════════════════════════
// F3 — Banger boost on party phase (+20)
// ═══════════════════════════════════════════════════════════════════════
test('F3: banger boost applies in party phase', () => {
  // Sanity check — banger recent (5j, score 18) vs non-banger old (20j, score 74)
  // The non-banger with much better freshness is still favored
  const banger = simulateIosComposite({ freshnessScore: 18, isBanger: true, stage: 'party', isGuestSuggestion: false });
  const nonBanger = simulateIosComposite({ freshnessScore: 74, isBanger: false, stage: 'party', isGuestSuggestion: false });
  assert.equal(banger, 38);    // 18 + 20
  assert.equal(nonBanger, 74);
  assert.ok(nonBanger > banger, 'Sanity: non-banger with much better freshness still favored');

  // Real edge case — banger 15j (63+20=83) beats non-banger 20j (74)
  // Banger boost tips the balance when freshness gap is small
  const bangerRecent = simulateIosComposite({ freshnessScore: 63, isBanger: true, stage: 'party', isGuestSuggestion: false });
  const nonBangerOlder = simulateIosComposite({ freshnessScore: 74, isBanger: false, stage: 'party', isGuestSuggestion: false });
  assert.equal(bangerRecent, 83);    // 63 + 20
  assert.ok(bangerRecent > nonBangerOlder, 'Banger 15j (83) > non-banger 20j (74) → banger boost tips the balance');
});

test('F3b: banger boost applies in all eligible phases', () => {
  for (const phase of ['takeoff', 'groove', 'party', 'closing']) {
    const score = simulateIosComposite({ freshnessScore: 50, isBanger: true, stage: phase, isGuestSuggestion: false });
    assert.equal(score, 70, `Banger boost should apply in ${phase}: 50+20=70`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// F4 — Banger NOT boosted in arrival/ambiance (doctrine égalitaire)
// ═══════════════════════════════════════════════════════════════════════
test('F4: banger NOT boosted in arrival phase', () => {
  const banger = simulateIosComposite({ freshnessScore: 18, isBanger: true, stage: 'arrival', isGuestSuggestion: false });
  const nonBanger = simulateIosComposite({ freshnessScore: 74, isBanger: false, stage: 'arrival', isGuestSuggestion: false });
  assert.equal(banger, 18);   // NO +20 boost
  assert.equal(nonBanger, 74);
  assert.ok(nonBanger > banger, 'Doctrine égalitaire respected on arrival');
});

test('F4b: banger NOT boosted in ambiance phase', () => {
  const score = simulateIosComposite({ freshnessScore: 30, isBanger: true, stage: 'ambiance', isGuestSuggestion: false });
  assert.equal(score, 30);  // NO boost
});

// ═══════════════════════════════════════════════════════════════════════
// F5 — Guest override bypasses freshnessScore entirely
// ═══════════════════════════════════════════════════════════════════════
test('F5: guest override bypasses freshnessScore entirely', () => {
  // Track played yesterday (score 6), but suggested by guest → treated as 100
  const guestSuggestion = simulateIosComposite({ freshnessScore: 6, isBanger: false, stage: 'party', isGuestSuggestion: true });
  assert.equal(guestSuggestion, 100);

  // Even in arrival/ambiance (no banger boost), guest override still bypasses
  const guestArrival = simulateIosComposite({ freshnessScore: 6, isBanger: false, stage: 'arrival', isGuestSuggestion: true });
  assert.equal(guestArrival, 100);

  // Guest override ALSO applies for banger tracks (doesn't stack — bypass wins)
  const guestBanger = simulateIosComposite({ freshnessScore: 6, isBanger: true, stage: 'party', isGuestSuggestion: true });
  assert.equal(guestBanger, 100);  // 100, not 120
});
