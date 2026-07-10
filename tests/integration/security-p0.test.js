/**
 * tests/integration/security-p0.test.js
 * Integration tests for P0 STOP-SHIP security fixes.
 *
 * Tests:
 *   P0.1 — RCE endpoints removed (sync-ios, export/rebuild → 404)
 *   P0.2 — GET /api/state does not leak hostSecret/sessionTokens/emails
 *   P0.3 — DELETE /api/guest/data requires auth
 *   P0.4 — guest:vote ignores client-sent guestId (server assigns)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';

import { startServer }                    from '../helpers/server-process.js';
import { connectTestDB, disconnectTestDB } from '../helpers/mongo.js';

// ─── Token helpers ────────────────────────────────────────────────────────────
// NOTE: Do NOT set `iss` in test tokens — ISSUER is null in test env (no SUPABASE_URL).
// The verifySupabaseJWT test path skips ISS check when payload.iss is absent.
function makeTestToken(payload) {
  return 'test:' + Buffer.from(JSON.stringify(payload)).toString('base64');
}

describe('Security P0 — STOP-SHIP fixes', () => {
  let serverUrl, killServer;

  before(async () => {
    ({ url: serverUrl, kill: killServer } = await startServer());
    await connectTestDB();
  });

  after(async () => {
    await disconnectTestDB();
    await killServer();
  });

  // ═══ P0.1 — RCE endpoints removed ═══
  it('POST /api/admin/sync-ios → 404 (endpoint removed)', async () => {
    const res = await fetch(`${serverUrl}/api/admin/sync-ios`, { method: 'POST' });
    assert.equal(res.status, 404, 'sync-ios should return 404');
  });

  it('POST /api/admin/export/rebuild → 404 (endpoint removed)', async () => {
    const res = await fetch(`${serverUrl}/api/admin/export/rebuild`, { method: 'POST' });
    assert.equal(res.status, 404, 'export/rebuild should return 404');
  });

  // ═══ P0.2 — GET /api/state does not leak secrets ═══
  it('GET /api/state → response does not contain hostSecret, sessionTokens, or email', async () => {
    const jwt = makeTestToken({
      sub: 'sec-test-host-001',
      email: 'sectest@example.com',
      aud: 'authenticated',
    });
    const socket = ioClient(serverUrl, { auth: { token: jwt } });
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    });

    const partyCode = await new Promise((resolve) => {
      socket.emit('host:create-party', { djMode: 'djAuto' }, (response) => {
        resolve(response?.code || response?.party?.code);
      });
    });

    if (partyCode) {
      const res = await fetch(`${serverUrl}/api/state?code=${partyCode}`);
      const text = await res.text();
      assert.ok(!text.includes('hostSecret'), 'Response should NOT contain hostSecret');
      assert.ok(!text.includes('sessionTokens'), 'Response should NOT contain sessionTokens');
      assert.ok(!text.includes('sectest@example.com'), 'Response should NOT contain email');
    }
    socket.disconnect();
  });

  // ═══ P0.3 — DELETE /api/guest/data requires auth ═══
  it('DELETE /api/guest/data without JWT → 401', async () => {
    const res = await fetch(`${serverUrl}/api/guest/data`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'victim@example.com', partyCode: 'TESTXX' }),
    });
    assert.equal(res.status, 401, 'Unauthenticated delete should be rejected');
  });

  it('DELETE /api/guest/data with JWT for different email → 403', async () => {
    const jwt = makeTestToken({
      sub: 'sec-test-user-002',
      email: 'attacker@example.com',
      aud: 'authenticated',
    });
    const res = await fetch(`${serverUrl}/api/guest/data`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({ email: 'victim@example.com', partyCode: 'TESTXX' }),
    });
    assert.equal(res.status, 403, 'Cross-email delete should be forbidden');
  });

  // ═══ P0.4 — Server-assigned guestId ═══
  it('guest:vote ignores client-sent guestId — uses server-assigned socket identity', async () => {
    // Host creates party
    const hostJwt = makeTestToken({
      sub: 'sec-test-host-003',
      email: 'host3@test.com',
      aud: 'authenticated',
    });
    const hostSocket = ioClient(serverUrl, { auth: { token: hostJwt } });
    await new Promise((r, e) => { hostSocket.on('connect', r); hostSocket.on('connect_error', e); });

    const code = await new Promise(r => {
      hostSocket.emit('host:create-party', { djMode: 'djAuto' }, resp => r(resp?.code || resp?.party?.code));
    });

    if (!code) {
      hostSocket.disconnect();
      return;
    }

    // Guest A joins (unauthenticated — no JWT → V0 compat)
    const guestA = ioClient(serverUrl);
    await new Promise((r, e) => { guestA.on('connect', r); guestA.on('connect_error', e); });
    await new Promise(r => {
      guestA.emit('guest:join', { code, name: 'Alice', emoji: '🅰️', email: 'a@t.com' }, r);
    });

    // Guest B joins (unauthenticated — no JWT → V0 compat)
    const guestB = ioClient(serverUrl);
    await new Promise((r, e) => { guestB.on('connect', r); guestB.on('connect_error', e); });
    await new Promise(r => {
      guestB.emit('guest:join', { code, name: 'Bob', emoji: '🅱️', email: 'b@t.com' }, r);
    });

    // Capture the voted event on host side
    const votedPromise = new Promise(r => {
      hostSocket.once('guest:voted', (voteData) => r(voteData));
      setTimeout(() => r(null), 3000);
    });

    // Guest B attempts to vote as Guest A (impersonation via client guestId)
    guestB.emit('guest:vote', {
      code,
      guestId: guestA.id,  // ← malicious: trying to impersonate A
      guestName: 'Bob',
      trackId: 'track-123',
      type: 'like',
      eventId: 'evt-sec-001',
    });

    const voteData = await votedPromise;
    if (voteData) {
      // The guestId in the voted event should be Guest B's socket.id, NOT Guest A's
      assert.notEqual(voteData.guestId, guestA.id,
        'Vote should NOT be recorded under Guest A (impersonated) ID');
      assert.equal(voteData.guestId, guestB.id,
        'Vote should be recorded under Guest B (actual sender) ID');
    }

    hostSocket.disconnect();
    guestA.disconnect();
    guestB.disconnect();
  });
});
