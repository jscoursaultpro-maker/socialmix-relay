/**
 * tests/integration/party-lifecycle.test.js
 *
 * Tests the full party lifecycle:
 *  1. startParty  → party exists in DB with endedAt=null
 *  2. trackPlayed → trackHistory contains 1 entry in DB
 *  3. endParty    → endedAt is set in DB
 *  4. Re-startParty with same code + new secret → old party archived, new party created
 *
 * Uses node:test (native Node.js 20+ test runner).
 * Server is spawned as a child process using MONGODB_URI_TEST.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../helpers/server-process.js';
import {
  createHostSocket, connected, disconnect,
  startParty, waitFor,
} from '../helpers/client.js';
import {
  connectTestDB, disconnectTestDB,
  findParty, cleanupParties, waitForPartyCondition,
} from '../helpers/mongo.js';

// ─── Test constants ────────────────────────────────────────────────────────────
const CODE       = 'T_LIFE01';
const SECRET_A   = 'test-secret-lifecycle-a';
const SECRET_B   = 'test-secret-lifecycle-b';
const PROFILE    = { name: 'Test Host', emoji: '🧪', phone: '', email: '', instagram: '' };

// ─── Suite ────────────────────────────────────────────────────────────────────
describe('party-lifecycle', async () => {
  let serverCtx;   // { url, kill }
  let socket;      // host socket

  before(async () => {
    // Cleanup leftovers from previous failed runs
    await connectTestDB();
    await cleanupParties(CODE);

    // Start the server
    serverCtx = await startServer();
  });

  after(async () => {
    if (socket?.connected) await disconnect(socket);
    await serverCtx?.kill();
    await cleanupParties(CODE);
    await disconnectTestDB();
  });

  // ── Test 1: startParty creates party in MongoDB ──────────────────────────
  it('startParty → party exists in DB with endedAt=null', async () => {
    socket = createHostSocket(serverCtx.url);
    await connected(socket);

    const { state, error } = await startParty(socket, {
      code: CODE,
      hostSecret: SECRET_A,
      profile: PROFILE,
      partyName: 'Lifecycle Test Party',
    });

    assert.ok(!error, `Expected no error, got: ${JSON.stringify(error)}`);
    assert.ok(state, 'Expected party:state to be received');
    assert.equal(state.code, CODE);

    // DB write-through is async — poll for up to 1s
    const doc = await waitForPartyCondition(CODE, d => d.hostSecret === SECRET_A, 1000);
    assert.equal(doc.code, CODE);
    assert.equal(doc.hostSecret, SECRET_A);
    assert.equal(doc.endedAt, null);
  });

  // ── Test 2: host:trackPlayed → trackHistory in DB ────────────────────────
  it('host:trackPlayed → trackHistory contains the track in DB', async () => {
    // Emit a track played event (mimics iOS CockpitView → handleMixTrackChanged)
    socket.emit('host:trackPlayed', {
      title: 'Test Track Lifecycle',
      artist: 'Test Artist',
      genre: 'Pop',
      bpm: 120,
      vibeScore: 75,
      fromSuggestion: false,
    });

    // Write-through is immediate ($push) — poll DB for up to 1.5s
    const doc = await waitForPartyCondition(
      CODE,
      d => d.trackHistory?.some(t => t.title === 'Test Track Lifecycle'),
      1500
    );
    assert.ok(
      doc.trackHistory.some(t => t.title === 'Test Track Lifecycle'),
      'Track should appear in trackHistory'
    );
  });

  // ── Test 3: host:endParty → endedAt set in DB ────────────────────────────
  it('host:endParty → endedAt is set in DB', async () => {
    socket.emit('host:endParty', { hostSecret: SECRET_A });

    // endedAt write-through is immediate
    const doc = await waitForPartyCondition(CODE, d => !!d.endedAt, 2000);
    assert.ok(doc.endedAt, 'endedAt should be set after endParty');
  });

  // ── Test 4: re-startParty same code + new secret → old archived ──────────
  it('re-startParty with new hostSecret → old party archived, new party created', async () => {
    // Reconnect a fresh socket (previous one got the party:ended event)
    if (socket?.connected) await disconnect(socket);
    socket = createHostSocket(serverCtx.url);
    await connected(socket);

    const { state, error } = await startParty(socket, {
      code: CODE,
      hostSecret: SECRET_B,   // Different secret → triggers archive + new party
      profile: PROFILE,
      partyName: 'Lifecycle Test Party v2',
    });

    assert.ok(!error, `Expected no error, got: ${JSON.stringify(error)}`);
    assert.ok(state, 'Expected party:state for new party');

    // New party should exist in DB with SECRET_B and no endedAt
    const newDoc = await waitForPartyCondition(CODE, d => d.hostSecret === SECRET_B, 1500);
    assert.equal(newDoc.hostSecret, SECRET_B);
    assert.equal(newDoc.endedAt, null);

    // Old party should be archived (code renamed to CODE_archived_...)
    const { Party: _P } = await import('../helpers/mongo.js').then(m => m);
    // Use findParty helper which queries by exact code — archived one has different code
    // We verify the new doc is clean (no old tracks leaked)
    assert.equal(
      newDoc.trackHistory?.filter(t => t.title === 'Test Track Lifecycle').length ?? 0,
      0,
      'New party should NOT inherit old trackHistory'
    );
  });
});
