/**
 * tests/integration/party-collision.test.js
 *
 * Tests the party code collision guard (fix #69, commit eca11c2):
 *  1. Host A creates party TEST02 (active, endedAt=null)
 *  2. Host B tries to startParty with same code + different secret
 *     → Server must emit party:error { error: 'PARTY_CODE_ACTIVE' }
 *     → Party TEST02 (Host A) must remain intact in DB
 *
 * This is a regression test: before fix #69, the collision guard didn't exist
 * and Host B's startParty would silently overwrite Host A's party data.
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
const CODE     = 'T_COLL02';
const SECRET_A = 'test-secret-collision-hostA';
const SECRET_B = 'test-secret-collision-hostB';
const PROFILE_A = { name: 'Host Alice', emoji: '🎵', phone: '', email: '', instagram: '' };
const PROFILE_B = { name: 'Host Bob',   emoji: '🎸', phone: '', email: '', instagram: '' };

describe('party-collision', async () => {
  let serverCtx;
  let socketA;   // Host A — owns the party
  let socketB;   // Host B — intruder

  before(async () => {
    await connectTestDB();
    await cleanupParties(CODE);
    serverCtx = await startServer();
  });

  after(async () => {
    if (socketA?.connected) await disconnect(socketA);
    if (socketB?.connected) await disconnect(socketB);
    await serverCtx?.kill();
    await cleanupParties(CODE);
    await disconnectTestDB();
  });

  it('Host A creates party → exists in DB as active', async () => {
    socketA = createHostSocket(serverCtx.url);
    await connected(socketA);

    const { state, error } = await startParty(socketA, {
      code: CODE,
      hostSecret: SECRET_A,
      profile: PROFILE_A,
      partyName: 'Collision Test Party — Host A',
    });

    assert.ok(!error, `Host A start should succeed, got: ${JSON.stringify(error)}`);
    assert.ok(state, 'Expected party:state');

    const doc = await waitForPartyCondition(CODE, d => d.hostSecret === SECRET_A, 1000);
    assert.equal(doc.hostSecret, SECRET_A);
    assert.equal(doc.endedAt, null);
  });

  it('Host B attempts same code + different secret → receives PARTY_CODE_ACTIVE error', async () => {
    socketB = createHostSocket(serverCtx.url);
    await connected(socketB);

    const { state, error } = await startParty(socketB, {
      code: CODE,
      hostSecret: SECRET_B,
      profile: PROFILE_B,
      partyName: 'Collision Test Party — Host B (should fail)',
    });

    // The server MUST emit party:error, NOT party:state
    assert.ok(!state, `Server should NOT return party:state to Host B, got: ${JSON.stringify(state)}`);
    assert.ok(error, 'Server MUST return party:error to Host B');
    assert.equal(
      error.error,
      'PARTY_CODE_ACTIVE',
      `Expected error code PARTY_CODE_ACTIVE, got: ${error.error}`
    );
  });

  it('Host A\'s party remains intact in DB after collision attempt', async () => {
    // Short wait to ensure no async mutation happened after the reject
    await new Promise(r => setTimeout(r, 300));

    const doc = await findParty(CODE);
    assert.ok(doc, 'Party should still exist in DB');
    assert.equal(
      doc.hostSecret,
      SECRET_A,
      'hostSecret should still be Secret A (not overwritten)'
    );
    assert.equal(doc.endedAt, null, 'endedAt should remain null (party still active)');
  });
});
