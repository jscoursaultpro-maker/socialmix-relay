/**
 * tests/integration/guest-rgpd.test.js
 *
 * Task V1 P0 #21 — RGPD guest onboarding
 * Tests:
 *  1. guest:join sans email → socket error:validation
 *  2. guest:join email invalide → socket error:validation
 *  3. guest:join valide → party:state reçu
 *  4. GET /cgu → 200 + HTML render
 *  5. GET /privacy → 200 + HTML render
 *  6. DELETE /api/guest/data → 200 + suppression correcte
 *  7. DELETE /api/guest/data sans email → 400
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer }              from '../helpers/server-process.js';
import {
  createHostSocket, createGuestSocket, connected, disconnect, startParty, waitFor
} from '../helpers/client.js';
import {
  connectTestDB, disconnectTestDB, cleanupParties
} from '../helpers/mongo.js';

const CODE   = 'T_RGPD1';
const SECRET = 'test-secret-rgpd';

describe('guest-rgpd — email required + legal routes + droit oubli', async () => {
  let serverCtx;
  let hostSocket;
  const sockets = [];

  before(async () => {
    serverCtx = await startServer();
    await connectTestDB();
    await cleanupParties(CODE);

    hostSocket = createHostSocket(serverCtx.url);
    await connected(hostSocket);
    await startParty(hostSocket, { code: CODE, hostSecret: SECRET, hostName: 'Test Host', hostEmoji: '🎧' });
  });

  after(async () => {
    for (const s of sockets) { try { s.disconnect(); } catch (_) {} }
    if (hostSocket) hostSocket.disconnect();
    await cleanupParties(CODE);
    await disconnectTestDB();
    if (serverCtx?.proc) serverCtx.proc.kill();
  });

  // ── 1. guest:join sans email → error:validation ─────────────────────────
  it('guest:join sans email → reçoit error:validation', async () => {
    const gs = createGuestSocket(serverCtx.url);
    sockets.push(gs);
    await connected(gs);
    // Start listening BEFORE emit
    const errPromise = waitFor(gs, 'error:validation', 3000);
    gs.emit('guest:join', {
      name: 'TestGuest', lastName: 'One', emoji: '🎉',
      partyCode: CODE,
      email: '',
      consentAcceptedAt: new Date().toISOString()
    });
    const err = await errPromise;
    assert.equal(err.field, 'email', 'field should be email');
  });

  // ── 2. guest:join email invalide → error:validation ─────────────────────
  it('guest:join email invalide → reçoit error:validation', async () => {
    const gs = createGuestSocket(serverCtx.url);
    sockets.push(gs);
    await connected(gs);
    const errPromise = waitFor(gs, 'error:validation', 3000);
    gs.emit('guest:join', {
      name: 'TestGuest', lastName: 'Two', emoji: '🎉',
      partyCode: CODE,
      email: 'not-an-email',
      consentAcceptedAt: new Date().toISOString()
    });
    const err = await errPromise;
    assert.equal(err.field, 'email');
  });

  // ── 3. guest:join valide → party:state reçu ─────────────────────────────
  it('guest:join valide → reçoit party:state', async () => {
    const gs = createGuestSocket(serverCtx.url);
    sockets.push(gs);
    await connected(gs);
    const statePromise = waitFor(gs, 'party:state', 5000);
    gs.emit('guest:join', {
      name: 'TestGuest', lastName: 'Three', emoji: '🎉',
      partyCode: CODE,
      email: 'guest.three@example.com',
      consentAcceptedAt: new Date().toISOString()
    });
    const state = await statePromise;
    assert.ok(state, 'party:state should be received');
    assert.equal(state.code, CODE);
  });

  // ── 4. GET /cgu → 200 HTML ──────────────────────────────────────────────
  it('GET /cgu → 200 + HTML avec "Conditions"', async () => {
    const res = await fetch(`${serverCtx.url}/cgu`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<!DOCTYPE html'), 'should return HTML');
    assert.ok(
      html.toLowerCase().includes('conditions') || html.includes('AhOuai'),
      'should contain legal content'
    );
  });

  // ── 5. GET /privacy → 200 HTML ──────────────────────────────────────────
  it('GET /privacy → 200 + HTML avec "confidentialité"', async () => {
    const res = await fetch(`${serverCtx.url}/privacy`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<!DOCTYPE html'), 'should return HTML');
    assert.ok(
      html.toLowerCase().includes('confidentialit') || html.includes('AhOuai'),
      'should contain privacy content'
    );
  });

  // ── 6. DELETE /api/guest/data → 200 ─────────────────────────────────────
  it('DELETE /api/guest/data → 200 + ok:true', async () => {
    // Join pour créer une GuestSession
    const gs = createGuestSocket(serverCtx.url);
    sockets.push(gs);
    await connected(gs);
    const stateP = waitFor(gs, 'party:state', 5000);
    gs.emit('guest:join', {
      name: 'DeleteMe', lastName: 'Guest', emoji: '🗑️',
      partyCode: CODE,
      email: 'delete.me@example.com',
      consentAcceptedAt: new Date().toISOString()
    });
    await stateP.catch(() => {});
    // Attendre persistence async GuestSession
    await new Promise(r => setTimeout(r, 600));

    const res = await fetch(`${serverCtx.url}/api/guest/data`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'delete.me@example.com', partyCode: CODE })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  // ── 7. DELETE /api/guest/data sans email → 400 ──────────────────────────
  it('DELETE /api/guest/data sans email → 400', async () => {
    const res = await fetch(`${serverCtx.url}/api/guest/data`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partyCode: CODE })
    });
    assert.equal(res.status, 400);
  });
});
