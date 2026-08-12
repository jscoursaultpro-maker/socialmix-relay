/**
 * tests/integration/afterglow.test.js
 *
 * Task #81 AXE B — Tests d'acceptation afterglow :
 *   B1 — base62 encode/decode round-trip (100 random ObjectIds)
 *   B2 — GET /api/afterglow/:base62 on ended party → 200 + public payload
 *   B3 — GET /api/afterglow/:base62 on live party → 403 PARTY_STILL_LIVE
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { encodeObjectId, decodeToObjectId } from '../../utils/base62.js';
import { startServer } from '../helpers/server-process.js';
import {
  createHostSocket, connected, disconnect,
  startParty, waitFor,
} from '../helpers/client.js';
import {
  connectTestDB, disconnectTestDB,
  findParty, cleanupParties, waitForPartyCondition,
  getTestPartyModel,
} from '../helpers/mongo.js';

// ─── Test constants ────────────────────────────────────────────────────
const CODE_B2 = 'T_81_B2';
const CODE_B3 = 'T_81_B3';
const SECRET  = 'test-secret-81-afterglow';
const PROFILE = { name: 'TestHostB', emoji: '🧪', phone: '', email: '', instagram: '' };

describe('Task #81 AXE B — Afterglow', async () => {
  let serverCtx;
  let socket;

  before(async () => {
    serverCtx = await startServer();
    await connectTestDB();
    await cleanupParties(CODE_B2, CODE_B3);
  });

  after(async () => {
    await cleanupParties(CODE_B2, CODE_B3);
    if (socket?.connected) await disconnect(socket);
    await serverCtx?.kill();
    await disconnectTestDB();
  });

  // ══════════════════════════════════════════════════════════════════════
  // B1 — base62 encode/decode round-trip
  // ══════════════════════════════════════════════════════════════════════

  it('B1: base62 round-trip — 100 random ObjectIds', async () => {
    for (let i = 0; i < 100; i++) {
      const hexId = crypto.randomBytes(12).toString('hex');  // 24-char hex like ObjectId
      const encoded = encodeObjectId(hexId);
      const decoded = decodeToObjectId(encoded);

      assert.equal(decoded, hexId.toLowerCase(),
        `Round-trip failed for ${hexId}: encoded=${encoded}, decoded=${decoded}`);
      assert.ok(encoded.length <= 17,
        `Encoded length ${encoded.length} > 17 for ${hexId}`);
      assert.ok(/^[0-9A-Za-z]+$/.test(encoded),
        `Encoded contains invalid chars: ${encoded}`);
    }
  });

  it('B1b: base62 invalid input → throws INVALID_BASE62', () => {
    assert.throws(() => decodeToObjectId('!!!invalid!!!'), /INVALID_BASE62/);
    assert.throws(() => decodeToObjectId(''), /INVALID_BASE62/);
    assert.throws(() => encodeObjectId('not-a-hex'), /INVALID_OBJECT_ID/);
  });

  // ══════════════════════════════════════════════════════════════════════
  // B2 — Ended party → 200 with public payload
  // ══════════════════════════════════════════════════════════════════════

  it('B2: GET /afterglow/:base62 on ended party → 200 + clean payload', async () => {
    // Step 1: Create party, send tracks, end it
    socket = createHostSocket(serverCtx.url);
    await connected(socket);

    const r = await startParty(socket, {
      code: CODE_B2,
      hostSecret: SECRET,
      profile: PROFILE,
      partyName: 'B2 Afterglow Test',
    });
    assert.ok(!r.error, `Start should succeed: ${JSON.stringify(r.error)}`);

    // Send 3 track updates
    socket.emit('host:trackUpdate', {
      title: 'Wind Of Change', artist: 'Scorpions', genre: 'Rock',
    });
    await new Promise(r => setTimeout(r, 200));
    socket.emit('host:trackUpdate', {
      title: 'Lalala', artist: 'Y2K', genre: 'Pop',
    });
    await new Promise(r => setTimeout(r, 200));
    socket.emit('host:trackUpdate', {
      title: 'Blinding Lights', artist: 'The Weeknd', genre: 'Pop',
    });
    await new Promise(r => setTimeout(r, 300));

    // Wait for party to be in DB
    await waitForPartyCondition(CODE_B2, d => d.hostSecret === SECRET, 6000);

    // End party
    socket.emit('host:sendToAfterglow', { code: CODE_B2, hostSecret: SECRET });

    // Wait for endedAt to be set
    const endedDoc = await waitForPartyCondition(CODE_B2,
      d => d.endedAt !== null, 8000
    ).catch(() => null);

    // If endedAt didn't land on CODE_B2 directly (archived), find it
    let partyId;
    if (endedDoc) {
      partyId = endedDoc._id.toString();
    } else {
      const Party = getTestPartyModel();
      const archivedDoc = await Party.findOne({
        code: { $regex: `^${CODE_B2}` },
        endedAt: { $ne: null }
      }).lean();
      assert.ok(archivedDoc, 'Should find ended party (archived or direct)');
      partyId = archivedDoc._id.toString();
    }

    // Step 2: Call afterglow endpoint
    const base62 = encodeObjectId(partyId);
    const res = await fetch(`${serverCtx.url}/api/afterglow/${base62}`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);

    const body = await res.json();

    // Verify structure
    assert.ok(body.party, 'Should have party object');
    assert.ok(body.party.endedAt, 'Should have endedAt');
    assert.ok(body.party.hostProfile, 'Should have hostProfile');
    assert.equal(body.party.hostProfile.name, 'TestHostB');
    assert.ok(body.stats, 'Should have stats');
    assert.equal(typeof body.stats.totalTracks, 'number');
    assert.equal(typeof body.stats.totalGuests, 'number');
    assert.ok(Array.isArray(body.tracks), 'tracks should be array');
    assert.ok(Array.isArray(body.guests), 'guests should be array');
    assert.ok(Array.isArray(body.moments), 'moments should be array');
    assert.ok(Array.isArray(body.photos), 'photos should be array');

    // Verify RGPD: no hostSecret, no emails in payload
    const jsonStr = JSON.stringify(body);
    assert.ok(!jsonStr.includes('hostSecret'), 'hostSecret must NOT appear in payload');
    assert.ok(!jsonStr.includes('hostUserId'), 'hostUserId must NOT appear in payload');
    assert.ok(!jsonStr.includes('@'), 'email addresses must NOT appear in payload');

    await disconnect(socket);
  });

  // ══════════════════════════════════════════════════════════════════════
  // B3 — Live party → 403 PARTY_STILL_LIVE
  // ══════════════════════════════════════════════════════════════════════

  it('B3: GET /afterglow/:base62 on live party → 403', async () => {
    // Create party directly in DB (live, endedAt=null)
    const Party = getTestPartyModel();
    const liveParty = await Party.create({
      code: CODE_B3,
      hostSecret: SECRET,
      endedAt: null,
      createdAt: new Date(),
      lifecycle: { status: 'live', startedAt: new Date() },
      hostProfile: PROFILE,
    });

    const base62 = encodeObjectId(liveParty._id.toString());
    const res = await fetch(`${serverCtx.url}/api/afterglow/${base62}`);

    assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.error, 'PARTY_STILL_LIVE');
  });

  // B3b — Invalid base62 → 400
  it('B3b: GET /afterglow/invalid → 400', async () => {
    const res = await fetch(`${serverCtx.url}/api/afterglow/!!!invalid!!!`);
    assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.error, 'INVALID_URL');
  });

  // B3c — Non-existent party → 404
  it('B3c: GET /afterglow/valid-but-nonexistent → 404', async () => {
    const fakeId = '000000000000000000000001';
    const base62 = encodeObjectId(fakeId);
    const res = await fetch(`${serverCtx.url}/api/afterglow/${base62}`);
    assert.equal(res.status, 404, `Expected 404, got ${res.status}`);
    const body = await res.json();
    assert.equal(body.error, 'PARTY_NOT_FOUND');
  });
});
