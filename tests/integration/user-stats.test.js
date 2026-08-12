/**
 * tests/integration/user-stats.test.js
 *
 * Task #81 AXE B Bloc 2 — Tests d'acceptation user stats :
 *   B4 — computeUserStats: topGenres, uniqueGuests, streaks on 2 parties
 *   B5 — Idempotence: calling twice produces identical results
 *   B6 — User with no ended party → returns null, stats unchanged
 *
 * Strategy: seed data via raw MMS collections, then call computeUserStats
 * which uses its own Mongoose models (connected to MMS via MONGODB_URI_TEST
 * set by server-process.js).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { startServer } from '../helpers/server-process.js';
import {
  connectTestDB, disconnectTestDB,
  cleanupParties, getTestPartyModel, getTestUserModel,
} from '../helpers/mongo.js';
import { mmsState } from '../helpers/mms-state.js';

const HOST_EMAIL  = 'test-userstats-host@example.com';
const CODE_B4_1   = 'T_81B41';
const CODE_B4_2   = 'T_81B42';
const CODE_B6     = 'T_81B6L';

describe('Task #81 AXE B Bloc 2 — User Stats', async () => {
  let serverCtx;
  let Party, User;
  let hostUserId;
  /** @type {import('../../services/userStats.js').computeUserStats} */
  let computeUserStats;

  before(async () => {
    serverCtx = await startServer();
    await connectTestDB();

    Party = getTestPartyModel();
    User = getTestUserModel();

    // Cleanup
    await cleanupParties(CODE_B4_1, CODE_B4_2, CODE_B6);
    await User.deleteMany({ email: HOST_EMAIL });
    await User.deleteMany({ email: 'lonely-host@test.com' });

    // Create host user
    const hostUser = await User.create({
      email: HOST_EMAIL,
      authProvider: 'apple',
      providerId: 'test-userstats-provider',
      profile: { firstName: 'StatsHost', emoji: '🧪' },
      stats: {
        partiesCount: 0,
        topGenres: [],
        uniqueGuestsHosted: 0,
        currentStreak: 0,
        longestStreak: 0,
      },
    });
    hostUserId = hostUser._id;

    // ─── Seed data via raw MongoDB connection (same DB as server) ───
    // The server's Mongoose models are connected to MMS via env.
    // We use the test helper connection to insert seed data.
    const conn = Party.db;  // The test Mongoose connection to MMS

    // Create Track + HPH via raw collections
    const tracksCol = conn.collection('tracks');
    const hphCol = conn.collection('hostplaybackhistories');

    const track1 = { _id: new mongoose.Types.ObjectId(), title: 'Wind Of Change', artist: 'Scorpions', genre: 'Rock' };
    const track2 = { _id: new mongoose.Types.ObjectId(), title: 'Lalala', artist: 'Y2K', genre: 'Pop' };
    const track3 = { _id: new mongoose.Types.ObjectId(), title: 'Levels', artist: 'Avicii', genre: 'EDM' };
    const track4 = { _id: new mongoose.Types.ObjectId(), title: 'Stairway', artist: 'Led Zep', genre: 'Rock' };
    const track5 = { _id: new mongoose.Types.ObjectId(), title: 'Blinding Lights', artist: 'Weeknd', genre: 'Pop' };

    await tracksCol.insertMany([track1, track2, track3, track4, track5]);

    // Party 1: 3 tracks, 3 guests (Alice, Bob, Charlie)
    const party1 = await Party.create({
      code: CODE_B4_1,
      hostSecret: 'secret-b4',
      hostUserId,
      endedAt: new Date(),
      createdAt: new Date(),
      lifecycle: { status: 'ended', startedAt: new Date(Date.now() - 3600000) },
      hostProfile: { name: 'StatsHost', emoji: '🧪' },
      participants: [
        { name: 'StatsHost', emoji: '🧪', isHost: true, joinedAt: new Date().toISOString() },
        { name: 'Alice', emoji: '💃', isHost: false, email: 'alice@test.com', joinedAt: new Date().toISOString() },
        { name: 'Bob', emoji: '🕺', isHost: false, email: 'bob@test.com', joinedAt: new Date().toISOString() },
        { name: 'Charlie', emoji: '🎸', isHost: false, email: 'charlie@test.com', joinedAt: new Date().toISOString() },
      ],
    });

    await hphCol.insertMany([
      { hostUserId, trackId: track1._id, partyId: party1._id, partyCode: CODE_B4_1, title: 'Wind Of Change', artist: 'Scorpions', playedAt: new Date(), phase: 'arrival', wasSuggestedByGuest: false },
      { hostUserId, trackId: track2._id, partyId: party1._id, partyCode: CODE_B4_1, title: 'Lalala', artist: 'Y2K', playedAt: new Date(), phase: 'ambiance', wasSuggestedByGuest: false },
      { hostUserId, trackId: track3._id, partyId: party1._id, partyCode: CODE_B4_1, title: 'Levels', artist: 'Avicii', playedAt: new Date(), phase: 'takeoff', wasSuggestedByGuest: false },
    ]);

    // Party 2: 2 tracks, 2 guests (Alice recurring + Dave)
    const party2 = await Party.create({
      code: CODE_B4_2,
      hostSecret: 'secret-b4-2',
      hostUserId,
      endedAt: new Date(),
      createdAt: new Date(),
      lifecycle: { status: 'ended', startedAt: new Date(Date.now() - 1800000) },
      hostProfile: { name: 'StatsHost', emoji: '🧪' },
      participants: [
        { name: 'StatsHost', emoji: '🧪', isHost: true, joinedAt: new Date().toISOString() },
        { name: 'Alice', emoji: '💃', isHost: false, email: 'alice@test.com', joinedAt: new Date().toISOString() },
        { name: 'Dave', emoji: '🎹', isHost: false, email: 'dave@test.com', joinedAt: new Date().toISOString() },
      ],
    });

    await hphCol.insertMany([
      { hostUserId, trackId: track4._id, partyId: party2._id, partyCode: CODE_B4_2, title: 'Stairway', artist: 'Led Zep', playedAt: new Date(), phase: 'groove', wasSuggestedByGuest: false },
      { hostUserId, trackId: track5._id, partyId: party2._id, partyCode: CODE_B4_2, title: 'Blinding Lights', artist: 'Weeknd', playedAt: new Date(), phase: 'party', wasSuggestedByGuest: false },
    ]);

    // ─── Import computeUserStats ─────────────────────────────────────
    // The server process already set MONGODB_URI_TEST and Mongoose models
    // in userStats.js connect via the server's own connection (same MMS).
    // We call via the server's HTTP to trigger it, but for direct unit test
    // we need to make computeUserStats talk to the same MMS.
    // Solution: use fetch to call a test endpoint, OR import and rely on
    // server's mongoose connection which IS connected to MMS.
    // Since the server is running and connected to MMS, we can use its API.
    // But computeUserStats is not exposed via HTTP yet.
    // Direct import works because server-process.js sets MONGODB_URI env
    // and the service does `import mongoose` which is the same instance.
    // HOWEVER the server runs in a child process, so models aren't shared.
    //
    // Simplest: create a separate mongoose connection in this test process,
    // connect to MMS, and call computeUserStats with that connection.
    //
    // Actually the cleanest approach: just test via raw query since
    // computeUserStats uses Mongoose models that connect via default connection.
    // We need to connect the default mongoose connection to MMS too.

    // Connect default mongoose to MMS (same as test helper connection)
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(mmsState.uri, { dbName: 'socialmix' });
    }

    const mod = await import('../../services/userStats.js');
    computeUserStats = mod.computeUserStats;
  });

  after(async () => {
    // Cleanup raw collections
    try {
      const conn = Party.db;
      await conn.collection('tracks').deleteMany({ artist: { $in: ['Scorpions', 'Y2K', 'Avicii', 'Led Zep', 'Weeknd'] } });
      await conn.collection('hostplaybackhistories').deleteMany({ partyCode: { $in: [CODE_B4_1, CODE_B4_2] } });
    } catch {}
    await cleanupParties(CODE_B4_1, CODE_B4_2, CODE_B6);
    await User.deleteMany({ email: HOST_EMAIL }).catch(() => {});
    await User.deleteMany({ email: 'lonely-host@test.com' }).catch(() => {});
    await mongoose.disconnect().catch(() => {});
    await serverCtx?.kill();
    await disconnectTestDB();
  });

  // ══════════════════════════════════════════════════════════════════════
  // B4 — Compute stats on 2 parties
  // ══════════════════════════════════════════════════════════════════════

  it('B4: topGenres, uniqueGuests, streaks computed correctly', async () => {
    const result = await computeUserStats(hostUserId);

    assert.ok(result, 'Should return stats object');

    // topGenres: Rock×2, Pop×2, EDM×1 → Rock and Pop tie at top
    assert.ok(result.topGenres.length >= 2, `Expected ≥2 genres, got ${result.topGenres.length}`);
    const genreNames = result.topGenres.map(g => g.genre);
    assert.ok(genreNames.includes('Rock'), `Rock should be in topGenres: ${JSON.stringify(result.topGenres)}`);
    assert.ok(genreNames.includes('Pop'), `Pop should be in topGenres: ${JSON.stringify(result.topGenres)}`);

    // Verify counts
    const rock = result.topGenres.find(g => g.genre === 'Rock');
    const pop = result.topGenres.find(g => g.genre === 'Pop');
    assert.equal(rock.count, 2, 'Rock count should be 2');
    assert.equal(pop.count, 2, 'Pop count should be 2');

    // uniqueGuestsHosted: Alice (x2 dedup by email), Bob, Charlie, Dave = 4
    assert.equal(result.uniqueGuestsHosted, 4,
      `Expected 4 unique guests (Alice deduped), got ${result.uniqueGuestsHosted}`);

    // Streaks: both parties this week
    assert.equal(typeof result.currentStreak, 'number');
    assert.equal(typeof result.longestStreak, 'number');
    assert.ok(result.currentStreak >= 1, `currentStreak should be ≥1, got ${result.currentStreak}`);
    assert.ok(result.longestStreak >= 1, `longestStreak should be ≥1, got ${result.longestStreak}`);

    // Verify persisted in User document
    const user = await User.findById(hostUserId).lean();
    assert.ok(user.stats.topGenres.length >= 2, 'topGenres should be persisted');
    assert.equal(user.stats.uniqueGuestsHosted, 4, 'uniqueGuestsHosted should be persisted');
  });

  // ══════════════════════════════════════════════════════════════════════
  // B5 — Idempotence
  // ══════════════════════════════════════════════════════════════════════

  it('B5: calling computeUserStats twice produces identical results', async () => {
    const result1 = await computeUserStats(hostUserId);
    const result2 = await computeUserStats(hostUserId);

    assert.deepEqual(result1.topGenres, result2.topGenres, 'topGenres should be identical');
    assert.equal(result1.uniqueGuestsHosted, result2.uniqueGuestsHosted, 'uniqueGuests should be identical');
    assert.equal(result1.currentStreak, result2.currentStreak, 'currentStreak should be identical');
    assert.equal(result1.longestStreak, result2.longestStreak, 'longestStreak should be identical');
  });

  // ══════════════════════════════════════════════════════════════════════
  // B6 — User with no ended party → null
  // ══════════════════════════════════════════════════════════════════════

  it('B6: user with no ended parties → returns null', async () => {
    const lonelyUser = await User.create({
      email: 'lonely-host@test.com',
      authProvider: 'google',
      providerId: 'lonely-provider',
      profile: { firstName: 'Lonely', emoji: '😢' },
      stats: { topGenres: [], uniqueGuestsHosted: 0, currentStreak: 0, longestStreak: 0 },
    });

    const result = await computeUserStats(lonelyUser._id);
    assert.equal(result, null, 'Should return null for user with no ended parties');

    // Stats unchanged
    const user = await User.findById(lonelyUser._id).lean();
    assert.equal(user.stats.uniqueGuestsHosted, 0, 'uniqueGuestsHosted should remain 0');
    assert.deepEqual(user.stats.topGenres, [], 'topGenres should remain empty');
  });
});
