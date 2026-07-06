/**
 * tests/integration/party-multi-secret.test.js
 *
 * Tests the GET /api/host/parties endpoint with multiple hostSecrets:
 *  - 3 parties created with 3 different hostSecrets (TESTA, TESTB, TESTC)
 *  - Querying with secretA → returns only TESTA (no cross-secret leak)
 *  - Querying with secretB → returns only TESTB
 *  - Querying with secretC → returns only TESTC
 *  - Querying with unknown secret → returns empty array (no error, just [])
 *
 * This validates both the server-side filtering and the fix #79 assumption:
 * each hostSecret is scoped to its own parties only.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../helpers/server-process.js';
import {
  createHostSocket, connected, disconnect,
  startParty, httpGet,
} from '../helpers/client.js';
import {
  connectTestDB, disconnectTestDB,
  cleanupParties, waitForPartyCondition,
} from '../helpers/mongo.js';

// ─── Test constants ────────────────────────────────────────────────────────────
const CODES   = ['T_MSA', 'T_MSB', 'T_MSC'];
const SECRETS = [
  'test-secret-multi-A',
  'test-secret-multi-B',
  'test-secret-multi-C',
];
const PROFILE = { name: 'Test Host', emoji: '🧪', phone: '', email: '', instagram: '' };

describe('party-multi-secret', async () => {
  let serverCtx;
  let sockets = [];

  before(async () => {
    serverCtx = await startServer();
    await connectTestDB();
    await cleanupParties(...CODES);
  });

  after(async () => {
    await cleanupParties(...CODES);     // cleanup while MMS still alive
    await serverCtx?.kill();           // then kill server + MMS
    for (const s of sockets) {
      if (s?.connected) await disconnect(s);
    }
    await disconnectTestDB();
  });

  it('Create 3 parties with 3 different secrets', async () => {
    for (let i = 0; i < 3; i++) {
      const sock = createHostSocket(serverCtx.url);
      await connected(sock);
      sockets.push(sock);

      const result = await startParty(sock, {
        code: CODES[i],
        hostSecret: SECRETS[i],
        profile: PROFILE,
        partyName: `Multi-Secret Party ${i + 1}`,
      });

      assert.ok(!result.error, `Party ${CODES[i]} creation failed: ${JSON.stringify(result.error)}`);
      assert.ok(result.ok || result.state, `Expected startParty to succeed for ${CODES[i]}`);
    }

    // Ensure all 3 are persisted in DB before querying HTTP endpoint
    for (let i = 0; i < 3; i++) {
      await waitForPartyCondition(
        CODES[i],
        d => d.hostSecret === SECRETS[i],
        1500
      );
    }
  });

  it('GET /api/host/parties?hostSecret=A → returns only TESTA', async () => {
    const { status, body } = await httpGet(
      `${serverCtx.url}/api/host/parties?hostSecret=${SECRETS[0]}`
    );

    assert.equal(status, 200, `Expected 200, got ${status}`);
    assert.ok(body.ok, 'Response should have ok:true');
    assert.ok(Array.isArray(body.parties), 'parties should be an array');

    const codes = body.parties.map(p => p.code);
    assert.ok(codes.includes(CODES[0]), `Should include ${CODES[0]}`);
    assert.ok(!codes.includes(CODES[1]), `Should NOT include ${CODES[1]}`);
    assert.ok(!codes.includes(CODES[2]), `Should NOT include ${CODES[2]}`);
  });

  it('GET /api/host/parties?hostSecret=B → returns only TESTB', async () => {
    const { status, body } = await httpGet(
      `${serverCtx.url}/api/host/parties?hostSecret=${SECRETS[1]}`
    );

    assert.equal(status, 200);
    const codes = body.parties.map(p => p.code);
    assert.ok(codes.includes(CODES[1]), `Should include ${CODES[1]}`);
    assert.ok(!codes.includes(CODES[0]), `Should NOT include ${CODES[0]}`);
    assert.ok(!codes.includes(CODES[2]), `Should NOT include ${CODES[2]}`);
  });

  it('GET /api/host/parties?hostSecret=C → returns only TESTC', async () => {
    const { status, body } = await httpGet(
      `${serverCtx.url}/api/host/parties?hostSecret=${SECRETS[2]}`
    );

    assert.equal(status, 200);
    const codes = body.parties.map(p => p.code);
    assert.ok(codes.includes(CODES[2]), `Should include ${CODES[2]}`);
    assert.ok(!codes.includes(CODES[0]), `Should NOT include ${CODES[0]}`);
    assert.ok(!codes.includes(CODES[1]), `Should NOT include ${CODES[1]}`);
  });

  it('GET /api/host/parties with unknown secret → empty array, no leak', async () => {
    const { status, body } = await httpGet(
      `${serverCtx.url}/api/host/parties?hostSecret=totally-unknown-secret-xyz`
    );

    // Either 200 with empty array or 404/401 are acceptable
    if (status === 200) {
      const codes = (body.parties || []).map(p => p.code);
      // Must not leak any of the test parties
      for (const code of CODES) {
        assert.ok(!codes.includes(code), `Secret isolation violated: ${code} leaked to unknown secret`);
      }
    } else {
      // 401 or 404 are also acceptable responses for an unknown secret
      assert.ok([401, 404].includes(status), `Unexpected status ${status}`);
    }
  });

  it('Party response objects include expected fields', async () => {
    const { body } = await httpGet(
      `${serverCtx.url}/api/host/parties?hostSecret=${SECRETS[0]}`
    );

    const party = body.parties.find(p => p.code === CODES[0]);
    assert.ok(party, 'Party object should exist in response');
    // Validate the shape of the response (no hostSecret leak!)
    assert.ok(!('hostSecret' in party), 'hostSecret MUST NOT be included in API response');
    assert.ok('code' in party, 'code field required');
    assert.ok('createdAt' in party, 'createdAt field required');
    assert.ok('participantCount' in party, 'participantCount field required');
  });
});
