// test-multi-party.js — Integration test for multi-party isolation
// Usage: node test-multi-party.js
// Requires server running on localhost:3069

import { io } from 'socket.io-client';

const URL = 'http://localhost:3069';
const TIMEOUT = 5000;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ FAIL: ${msg}`); }
}

function connect() {
  return new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    setTimeout(() => resolve(null), TIMEOUT);
  });
}

function waitFor(socket, event, timeout = 2000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

async function run() {
  console.log('\n🧪 Multi-Party Integration Test\n');

  // Connect 2 hosts + 2 guests
  console.log('1️⃣  Connecting sockets...');
  const host1 = await connect();
  const host2 = await connect();
  const guest1 = await connect();
  const guest2 = await connect();
  assert(host1 && host2 && guest1 && guest2, '4 sockets connected');

  // Start 2 parties
  console.log('\n2️⃣  Starting 2 parties...');
  host1.emit('host:startParty', { code: 'PARTY1', profile: { name: 'DJ Alpha', emoji: '🎧' } });
  host2.emit('host:startParty', { code: 'PARTY2', profile: { name: 'DJ Beta', emoji: '🎵' } });
  await new Promise(r => setTimeout(r, 500));

  // Verify /status
  const statusRes = await fetch(`${URL}/status`);
  const status = await statusRes.json();
  assert(status.activeParties === 2, `2 active parties (got ${status.activeParties})`);
  assert(status.codes.includes('PARTY1') && status.codes.includes('PARTY2'), 'Both codes present');

  // Guests join different parties
  console.log('\n3️⃣  Guests joining...');
  const statePromise1 = waitFor(guest1, 'party:state');
  guest1.emit('guest:join', { partyCode: 'PARTY1', name: 'Alice', emoji: '🎉' });
  const state1 = await statePromise1;
  assert(state1 && state1.code === 'PARTY1', 'Guest1 received PARTY1 state');

  const statePromise2 = waitFor(guest2, 'party:state');
  guest2.emit('guest:join', { partyCode: 'PARTY2', name: 'Bob', emoji: '🕺' });
  const state2 = await statePromise2;
  assert(state2 && state2.code === 'PARTY2', 'Guest2 received PARTY2 state');

  // Wrong code test
  const guest3 = await connect();
  const wrongPromise = waitFor(guest3, 'party:wrongCode');
  guest3.emit('guest:join', { partyCode: 'BADCODE', name: 'Charlie' });
  const wrongResult = await wrongPromise;
  assert(wrongResult !== null, 'Wrong code rejected');
  guest3.disconnect();

  // Test isolation: vote on PARTY1, verify Host2 does NOT receive
  console.log('\n4️⃣  Testing isolation...');
  const host1VotePromise = waitFor(host1, 'guest:voted');
  const host2VotePromise = waitFor(host2, 'guest:voted', 1000); // short timeout
  guest1.emit('guest:vote', { guestId: 'alice', guestName: 'Alice', type: 'fire', trackId: 'TestTrack' });
  const h1vote = await host1VotePromise;
  const h2vote = await host2VotePromise;
  assert(h1vote !== null, 'Host1 received vote from Guest1');
  assert(h2vote === null, 'Host2 did NOT receive vote from Guest1 (isolated)');

  // Test isolation: photo on PARTY2, verify Host1 does NOT receive
  const host2PhotoPromise = waitFor(host2, 'guest:photo');
  const host1PhotoPromise = waitFor(host1, 'guest:photo', 1000);
  guest2.emit('guest:photo', { dataURL: 'data:image/jpeg;base64,AAAA', guestName: 'Bob', guestId: 'bob' });
  const h2photo = await host2PhotoPromise;
  const h1photo = await host1PhotoPromise;
  assert(h2photo !== null, 'Host2 received photo from Guest2');
  assert(h1photo === null, 'Host1 did NOT receive photo from Guest2 (isolated)');

  // End PARTY1, verify PARTY2 still active
  console.log('\n5️⃣  Ending PARTY1...');
  host1.emit('host:endParty');
  await new Promise(r => setTimeout(r, 500));

  const status2Res = await fetch(`${URL}/status`);
  const status2 = await status2Res.json();
  assert(status2.activeParties === 1, `1 active party after ending PARTY1 (got ${status2.activeParties})`);
  assert(status2.codes.includes('PARTY2'), 'PARTY2 still active');

  // PARTY2 still works
  const host2TrackPromise = waitFor(guest2, 'track:update');
  host2.emit('host:trackUpdate', { title: 'Still Playing', artist: 'DJ Beta' });
  const trackUpdate = await host2TrackPromise;
  assert(trackUpdate && trackUpdate.title === 'Still Playing', 'PARTY2 still receives events');

  // Cleanup
  host1.disconnect();
  host2.disconnect();
  guest1.disconnect();
  guest2.disconnect();

  // Results
  console.log(`\n${'═'.repeat(40)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(40)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
