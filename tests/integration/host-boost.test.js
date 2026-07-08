/**
 * tests/integration/host-boost.test.js
 *
 * Tests the host boost mechanic limits:
 *  1. host boost respects max 3 pending guard (returns 429 on 4th)
 *  2. playing a boosted track releases host slot (allows 4th boost after play)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../helpers/server-process.js';
import {
  createHostSocket, createGuestSocket, connected, disconnect,
  startParty, waitFor
} from '../helpers/client.js';
import {
  connectTestDB, disconnectTestDB,
  cleanupParties
} from '../helpers/mongo.js';

const CODE       = 'T_BOOST1';
const SECRET     = 'test-secret-boost';
const PROFILE    = { name: 'Test Host', emoji: '🎧' };

describe('host-boost limits', async () => {
  let serverCtx;
  let socket;
  let guestSocket;

  before(async () => {
    serverCtx = await startServer();
    await connectTestDB();
    await cleanupParties(CODE);
    
    // Setup party
    socket = createHostSocket(serverCtx.url);
    await connected(socket);
    await startParty(socket, {
      code: CODE,
      hostSecret: SECRET,
      profile: PROFILE,
      partyName: 'Host Boost Party',
      isPublic: true
    });
    
    guestSocket = createGuestSocket(serverCtx.url);
    await connected(guestSocket);
  });

  after(async () => {
    await cleanupParties(CODE);
    await serverCtx?.kill();
    if (socket?.connected) await disconnect(socket);
    if (guestSocket?.connected) await disconnect(guestSocket);
    await disconnectTestDB();
  });

  it('host boost respects max 3 pending guard (returns 429 on 4th)', async () => {
    // Join guest socket
    guestSocket.emit('guest:join', { partyCode: CODE, guestId: 'guest-boost-test', guestName: 'Guest' });
    await waitFor(guestSocket, 'party:state');

    // 1. Add 4 suggestions via guest socket
    for (let i = 1; i <= 4; i++) {
      guestSocket.emit('guest:suggest', {
        code: CODE,
        title: `Track ${i}`,
        artist: 'Artist',
        coverURL: '',
        deezerID: 1000 + i,
        guestId: `guest-${i}`,
        guestName: `Guest ${i}`,
        eventId: `evt-${i}`
      });
      // Wait for host to receive it
      await waitFor(socket, 'guest:suggested');
    }

    // 2. Fetch the party state from host to get the suggestion IDs
    socket.emit('host:requestState', { code: CODE, hostSecret: SECRET });
    const party = await waitFor(socket, 'party:state');
    assert.equal(party.suggestions.length, 4, 'Should have 4 suggestions');
    
    const suggIds = party.suggestions.map(s => s.id);

    // 3. Boost 3 suggestions as host
    for (let i = 0; i < 3; i++) {
      const boostRes = await fetch(`${serverCtx.url}/api/party/${CODE}/suggestion/${suggIds[i]}/boost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestId: `host:${SECRET}`,
          guestName: 'Host'
        })
      });
      assert.equal(boostRes.status, 200, `Host boost ${i+1} should succeed`);
    }

    // 4. Try to boost the 4th suggestion as host, should fail with 429
    const failedBoostRes = await fetch(`${serverCtx.url}/api/party/${CODE}/suggestion/${suggIds[3]}/boost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestId: `host:${SECRET}`,
        guestName: 'Host'
      })
    });
    assert.equal(failedBoostRes.status, 429, '4th host boost should fail with 429');
    const errJson = await failedBoostRes.json();
    assert.match(errJson.error, /Max 3/);
    
    // Store suggIds for the next test
    serverCtx.suggIds = suggIds;
  });

  it('playing a boosted track releases host slot (allows 4th boost after play)', async () => {
    const suggIds = serverCtx.suggIds;
    
    // 1. Play the first boosted track
    // Simulate DJ Brain picking the track and playing it
    socket.emit('host:trackUpdate', {
      code: CODE,
      hostSecret: SECRET,
      fromSuggestion: true,
      source: 'suggestion',
      title: 'Track 1',
      artist: 'Artist',
      deezerID: 1001
    });
    
    // Wait for state to sync
    await new Promise(r => setTimeout(r, 200));

    // 2. Try to boost the 4th suggestion again, should now succeed (status is 200)
    const successBoostRes = await fetch(`${serverCtx.url}/api/party/${CODE}/suggestion/${suggIds[3]}/boost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestId: `host:${SECRET}`,
        guestName: 'Host'
      })
    });
    
    assert.equal(successBoostRes.status, 200, '4th host boost should succeed after slot is freed');
  });

  it('guest boost respects max 3 pending guard (returns 429 on 4th)', async () => {
    const suggIds = serverCtx.suggIds;
    
    // Add a 5th suggestion so we have enough active suggestions to test the guest limit
    guestSocket.emit('guest:suggest', {
      code: CODE,
      title: 'Track 5',
      artist: 'Artist',
      coverURL: '',
      deezerID: 1005,
      guestId: 'guest-5',
      guestName: 'Guest 5',
      eventId: 'evt-5'
    });
    await waitFor(socket, 'guest:suggested');
    
    socket.emit('host:requestState', { code: CODE, hostSecret: SECRET });
    const party = await waitFor(socket, 'party:state');
    const allSuggIds = party.suggestions.map(s => s.id);
    
    // Test guest boosts 3 suggestions (indices 1, 2, 3 since 0 is 'played')
    for (let i = 1; i <= 3; i++) {
      const boostRes = await fetch(`${serverCtx.url}/api/party/${CODE}/suggestion/${allSuggIds[i]}/boost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId: 'test-guest', guestName: 'Test Guest' })
      });
      assert.equal(boostRes.status, 200, `Guest boost ${i} should succeed`);
    }

    // 4th guest boost should fail with 429
    const failedBoostRes = await fetch(`${serverCtx.url}/api/party/${CODE}/suggestion/${allSuggIds[4]}/boost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId: 'test-guest', guestName: 'Test Guest' })
    });
    assert.equal(failedBoostRes.status, 429, '4th guest boost should fail with 429');
    const errJson = await failedBoostRes.json();
    assert.match(errJson.error, /3 boosts actifs/);
  });

  it('guest cap and host cap are independent (guest can still boost when host is at max)', async () => {
    const suggIds = serverCtx.suggIds;
    // Host is currently at 3 active boosts (Track 2, 3, 4).
    // Let's verify a DIFFERENT guest can still boost Track 2.
    const boostRes = await fetch(`${serverCtx.url}/api/party/${CODE}/suggestion/${suggIds[1]}/boost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId: 'another-guest', guestName: 'Another Guest' })
    });
    assert.equal(boostRes.status, 200, 'Guest should be able to boost even if host is at max');
  });
});
