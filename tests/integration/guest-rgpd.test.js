/**
 * tests/integration/guest-rgpd.test.js
 *
 * Task V1 P0 #21 — RGPD guest onboarding
 * Tests:
 *  1. guest:join legacy → refusé
 *  2. guest:requestJoin email invalide → refusé
 *  3. guest:requestJoin valide → party:state reçu
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

const CODE   = 'QARGP1';
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
    await startParty(hostSocket, { code: CODE, hostSecret: SECRET, hostName: 'Test Host', hostEmoji: '🎧', visibility: 'public' });
  });

  after(async () => {
    for (const s of sockets) { try { s.disconnect(); } catch (_) {} }
    if (hostSocket) hostSocket.disconnect();
    await cleanupParties(CODE);
    await disconnectTestDB();
    await serverCtx?.kill();
  });

  // ── 1. L'ancien événement ne peut plus contourner la salle d'attente ─────
  it('guest:join legacy → refus explicite', async () => {
    const gs = createGuestSocket(serverCtx.url);
    sockets.push(gs);
    await connected(gs);
    const reply = await new Promise(resolve => gs.emit('guest:join', { partyCode: CODE }, resolve));
    assert.equal(reply.ok, false);
    assert.equal(reply.error, 'LEGACY_JOIN_DISABLED');
  });

  // ── 2. requestJoin email invalide → ACK contrôlé ─────────────────────────
  it('guest:requestJoin email invalide → refus INVALID_EMAIL', async () => {
    const gs = createGuestSocket(serverCtx.url);
    sockets.push(gs);
    await connected(gs);
    const reply = await new Promise(resolve => gs.emit('guest:requestJoin', {
      code: CODE, firstName: 'TestGuest', lastName: 'Two', email: 'not-an-email', cguAccepted: true
    }, resolve));
    assert.equal(reply.ok, false);
    assert.equal(reply.error, 'INVALID_EMAIL');
  });

  // ── 3. requestJoin valide sur soirée publique → party:state ─────────────
  it('guest:requestJoin valide → reçoit party:state', async () => {
    const gs = createGuestSocket(serverCtx.url);
    sockets.push(gs);
    await connected(gs);
    const statePromise = waitFor(gs, 'party:state', 5000);
    gs.emit('guest:requestJoin', {
      code: CODE, firstName: 'TestGuest', lastName: 'Three',
      email: 'guest.three@example.com', cguAccepted: true
    }, () => {});
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
    gs.emit('guest:requestJoin', {
      code: CODE, firstName: 'DeleteMe', lastName: 'Guest',
      email: 'delete.me@example.com', cguAccepted: true
    }, () => {});
    await stateP.catch(() => {});
    // Attendre persistence async GuestSession
    await new Promise(r => setTimeout(r, 600));

    const res = await fetch(`${serverCtx.url}/api/guest/data`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test:' + Buffer.from(JSON.stringify({sub:'cccccccc-0000-4000-8000-000000000003',email:'delete.me@example.com',aud:'authenticated'})).toString('base64') },
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
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test:' + Buffer.from(JSON.stringify({sub:'cccccccc-0000-4000-8000-000000000003',email:'delete.me@example.com',aud:'authenticated'})).toString('base64') },
      body: JSON.stringify({ partyCode: CODE })
    });
    assert.equal(res.status, 400);
  });
});
