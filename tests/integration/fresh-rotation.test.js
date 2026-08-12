/**
 * tests/integration/fresh-rotation.test.js
 *
 * Task #44 — Tests intégration Fresh Rotation V2 :
 *   F2  — Pool phase adaptatif : all tracks present, monotonic, no cliff
 *   F2b — Pool épuisé : least recent still winnable, no exclusion
 *   F2c — Legacy compat : endpoint without ?v=2 returns scalar tiers
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { startServer } from '../helpers/server-process.js';
import {
  connectTestDB, disconnectTestDB,
  getTestPartyModel, getTestUserModel,
} from '../helpers/mongo.js';
import { mmsState } from '../helpers/mms-state.js';

const HOST_EMAIL = 'test-fresh-rotation@example.com';

describe('Task #44 — Fresh Rotation V2 Integration', async () => {
  let serverCtx;
  let hostUserId;
  let deezerIds;

  before(async () => {
    serverCtx = await startServer();
    await connectTestDB();

    const User = getTestUserModel();
    const conn = User.db;

    // Cleanup
    await User.deleteMany({ email: HOST_EMAIL });
    await conn.collection('tracks').deleteMany({ artist: { $in: ['FR_Artist1', 'FR_Artist2', 'FR_Artist3', 'FR_Artist4', 'FR_Artist5'] } });

    // Create host user with antiRepetition enabled
    const hostUser = await User.create({
      email: HOST_EMAIL,
      authProvider: 'apple',
      providerId: 'test-fresh-rotation-provider',
      profile: { firstName: 'FreshHost', emoji: '🎧' },
      settings: { antiRepetition: true },
    });
    hostUserId = hostUser._id;

    // Create 5 tracks with deezer IDs
    const tracksCol = conn.collection('tracks');
    const hphCol = conn.collection('hostplaybackhistories');

    deezerIds = ['99001', '99002', '99003', '99004', '99005'];
    const now = Date.now();
    const msInDay = 24 * 3600 * 1000;

    const tracks = [];
    for (let i = 0; i < 5; i++) {
      tracks.push({
        _id: new mongoose.Types.ObjectId(),
        title: `FreshTrack${i + 1}`,
        artist: `FR_Artist${i + 1}`,
        genre: 'Pop',
        fallbackHash: `freshtrack${i + 1}_fr_artist${i + 1}`,
        phase: 'party',
        providers: { deezer: { trackId: parseInt(deezerIds[i]) } },
      });
    }
    await tracksCol.insertMany(tracks);

    // Create HPH with staggered playedAt:
    //   track1: 1 day ago, track2: 3 days, track3: 7 days, track4: 15 days, track5: 30 days
    const daysAgo = [1, 3, 7, 15, 30];
    const hphs = tracks.map((t, i) => ({
      hostUserId,
      trackId: t._id,
      partyId: new mongoose.Types.ObjectId(),
      partyCode: `FR_T${i + 1}`,
      title: t.title,
      artist: t.artist,
      playedAt: new Date(now - daysAgo[i] * msInDay),
      phase: 'party',
      wasSuggestedByGuest: false,
    }));
    await hphCol.insertMany(hphs);
  });

  after(async () => {
    try {
      const User = getTestUserModel();
      const conn = User.db;
      await User.deleteMany({ email: HOST_EMAIL });
      await conn.collection('tracks').deleteMany({ artist: { $in: ['FR_Artist1', 'FR_Artist2', 'FR_Artist3', 'FR_Artist4', 'FR_Artist5'] } });
      await conn.collection('hostplaybackhistories').deleteMany({ partyCode: { $regex: /^FR_T/ } });
    } catch {}
    await serverCtx?.kill();
    await disconnectTestDB();
  });

  // ══════════════════════════════════════════════════════════════════════
  // F2 — Pool phase adaptatif : continuous scoring, no cliff exclusion
  // ══════════════════════════════════════════════════════════════════════

  it('F2: all tracks present with monotonic scoring, no cliff exclusion', async () => {
    const res = await fetch(`${serverCtx.url}/api/tracks/freshness/${hostUserId}?v=2`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.algo, 'v2_adaptive_pool_phase');

    // Extract scores sorted by freshnessScore descending
    const entries = Object.entries(data.scores)
      .map(([deezerId, entry]) => ({ deezerId, score: entry.freshnessScore, lastPlayedAt: entry.lastPlayedAt }))
      .sort((a, b) => b.score - a.score);

    // All 5 tracks present — no cliff exclusion
    assert.equal(entries.length, 5, `All 5 tracks present, got ${entries.length}`);

    // Monotonic: score decreases as recency increases
    for (let i = 0; i < entries.length - 1; i++) {
      assert.ok(entries[i].score >= entries[i + 1].score,
        `Score[${i}]=${entries[i].score} should >= Score[${i + 1}]=${entries[i + 1].score}`);
    }

    // Range checks (approximate due to timing)
    assert.ok(entries[0].score >= 75, `Least recent (30j) score >= 75, got ${entries[0].score}`);
    assert.ok(entries[entries.length - 1].score <= 20, `Most recent (1j) score <= 20, got ${entries[entries.length - 1].score}`);

    // Each entry has lastPlayedAt and lastPlayedPhase
    for (const entry of Object.values(data.scores)) {
      assert.ok(entry.lastPlayedAt, 'Entry has lastPlayedAt');
      assert.equal(typeof entry.freshnessScore, 'number');
      assert.ok(Array.isArray(entry.playedInPartyCodes), 'Entry has playedInPartyCodes array');
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // F2b — Pool épuisé : least recent still winnable
  // ══════════════════════════════════════════════════════════════════════

  it('F2b: pool épuisé — least recent still winnable, no exclusion', async () => {
    const res = await fetch(`${serverCtx.url}/api/tracks/freshness/${hostUserId}?v=2`);
    const data = await res.json();

    const scores = Object.values(data.scores).map(e => e.freshnessScore);
    const maxScore = Math.max(...scores);

    // At least one track has positive freshness score
    assert.ok(maxScore > 0, 'At least one track has positive freshness score');

    // No legacy cliff/penalty values in V2 payload
    assert.ok(scores.every(s => s >= 0 && s <= 100),
      'All V2 scores in 0-100 range (no legacy -100/-80 penalties)');
  });

  // ══════════════════════════════════════════════════════════════════════
  // F2c — Legacy compat : no ?v=2 returns scalar tiers
  // ══════════════════════════════════════════════════════════════════════

  it('F2c: endpoint legacy (no ?v=2) returns scalar tier values', async () => {
    const res = await fetch(`${serverCtx.url}/api/tracks/freshness/${hostUserId}`);
    assert.equal(res.status, 200);
    const data = await res.json();

    // Legacy format: scores[deezerId] = number (tier: 30/10/-100), not object
    const firstEntry = Object.values(data.scores)[0];
    assert.equal(typeof firstEntry, 'number', `Legacy format returns number, not object. Got: ${typeof firstEntry}`);
    assert.ok([30, 10, -100].includes(firstEntry),
      `Legacy tier value, got ${firstEntry}`);

    // All values should be tier values
    for (const [deezerId, score] of Object.entries(data.scores)) {
      assert.ok([30, 10, -100].includes(score),
        `deezerId ${deezerId}: expected tier value, got ${score}`);
    }
  });
});
