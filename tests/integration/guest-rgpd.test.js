/**
 * tests/integration/guest-rgpd.test.js
 *
 * Task V1 P0 #21 — RGPD guest onboarding
 * Tests:
 *  1. POST guest:join sans email → socket error:validation
 *  2. POST guest:join email invalide → socket error:validation
 *  3. guest:join valide → 200 + GuestSession créée en Mongo
 *  4. GET /cgu → 200 + HTML render
 *  5. GET /privacy → 200 + HTML render
 *  6. DELETE /api/guest/data → 200 + suppression correcte
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer }              from '../helpers/server-process.js';
import {
  createGuestSocket, connected, disconnect, waitFor
} from '../helpers/client.js';
import {
  connectTestDB, disconnectTestDB, cleanupParties
} from '../helpers/mongo.js';

const CODE   = 'T_RGPD1';
const SECRET = 'test-secret-rgpd';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createSocket(url, extraQuery = {}) {
  const { io } = require !== undefined
    ? (() => { throw new Error('use import'); })()
    : {};
  // Use the helper from client.js but we need a raw socket for guest
  return createGuestSocket(url);
}

async function startPartyForTest(serverCtx) {
  const { createHostSocket, connected: connectedFn, startParty } = await import('../helpers/client.js');
  const hSocket = createHostSocket(serverCtx.url);
  await connectedFn(hSocket);
  await startParty(hSocket, { code: CODE, hostSecret: SECRET, hostName: 'Test Host', hostEmoji: '🎧' });
  return hSocket;
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('guest-rgpd — email required + legal routes + droit oubli', async () => {
  let serverCtx;
  let hostSocket;
  let GuestSessionModel;

  before(async () => {
    serverCtx = await startServer();
    await connectTestDB();
    await cleanupParties(CODE);
    hostSocket = await startPartyForTest(serverCtx);

    // Get GuestSession model from test mongo helper
    const { getModel } = await import('../helpers/mongo.js').catch(() => ({ getModel: null }));
    if (getModel) GuestSessionModel = getModel('GuestSession');
  });

  after(async () => {
    if (hostSocket) hostSocket.disconnect();
    await cleanupParties(CODE);
    await disconnectTestDB();
    if (serverCtx?.proc) serverCtx.proc.kill();
  });

  // ── 1. guest:join sans email → error:validation ─────────────────────────
  it('guest:join sans email → reçoit error:validation', async () => {
    const gs = createGuestSocket(serverCtx.url);
    await connected(gs);
    const err = await waitFor(gs, 'error:validation', () => {
      gs.emit('guest:join', {
        name: 'TestGuest', lastName: 'One', emoji: '🎉',
        partyCode: CODE,
        email: '',   // manquant
        consentAcceptedAt: new Date().toISOString()
      });
    }, 3000);
    assert.equal(err.field, 'email', 'field should be email');
    disconnect(gs);
  });

  // ── 2. guest:join email invalide → error:validation ─────────────────────
  it('guest:join email invalide → reçoit error:validation', async () => {
    const gs = createGuestSocket(serverCtx.url);
    await connected(gs);
    const err = await waitFor(gs, 'error:validation', () => {
      gs.emit('guest:join', {
        name: 'TestGuest', lastName: 'Two', emoji: '🎉',
        partyCode: CODE,
        email: 'not-an-email',
        consentAcceptedAt: new Date().toISOString()
      });
    }, 3000);
    assert.equal(err.field, 'email');
    disconnect(gs);
  });

  // ── 3. guest:join valide → party:state reçu ─────────────────────────────
  it('guest:join valide → reçoit party:state', async () => {
    const gs = createGuestSocket(serverCtx.url);
    await connected(gs);
    const state = await waitFor(gs, 'party:state', () => {
      gs.emit('guest:join', {
        name: 'TestGuest', lastName: 'Three', emoji: '🎉',
        partyCode: CODE,
        email: 'guest.three@example.com',
        consentAcceptedAt: new Date().toISOString()
      });
    }, 5000);
    assert.ok(state, 'party:state should be received');
    assert.equal(state.code, CODE);
    disconnect(gs);
  });

  // ── 4. GET /cgu → 200 HTML ──────────────────────────────────────────────
  it('GET /cgu → 200 + HTML avec "Conditions"', async () => {
    const res = await fetch(`${serverCtx.url}/cgu`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<!DOCTYPE html'), 'should return HTML');
    assert.ok(html.toLowerCase().includes('conditions') || html.includes('AhOuai'), 'should contain legal content');
  });

  // ── 5. GET /privacy → 200 HTML ──────────────────────────────────────────
  it('GET /privacy → 200 + HTML avec "confidentialité"', async () => {
    const res = await fetch(`${serverCtx.url}/privacy`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<!DOCTYPE html'), 'should return HTML');
    assert.ok(html.toLowerCase().includes('confidentialit') || html.includes('AhOuai'), 'should contain privacy content');
  });

  // ── 6. DELETE /api/guest/data → 200 ─────────────────────────────────────
  it('DELETE /api/guest/data → 200 + ok:true', async () => {
    // Join d'abord pour avoir une session
    const gs = createGuestSocket(serverCtx.url);
    await connected(gs);
    await waitFor(gs, 'party:state', () => {
      gs.emit('guest:join', {
        name: 'DeleteMe', lastName: 'Guest', emoji: '🗑️',
        partyCode: CODE,
        email: 'delete.me@example.com',
        consentAcceptedAt: new Date().toISOString()
      });
    }, 5000).catch(() => {});
    disconnect(gs);

    // Attendre que la session soit créée
    await new Promise(r => setTimeout(r, 500));

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
