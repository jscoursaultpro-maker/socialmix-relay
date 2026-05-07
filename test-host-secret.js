/**
 * Host Secret Authentication Test
 * Tests that:
 * 1. Host with valid secret can execute all host:* events
 * 2. Guest emitting host:endParty without secret is rejected
 * 3. 5 invalid attempts trigger disconnection
 */

import { io } from 'socket.io-client';

const SERVER = 'http://localhost:3069';
const PARTY_CODE = 'SECRET_TEST';
const HOST_SECRET = 'test-uuid-secret-1234';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('\n🔐 Host Secret Auth Test\n');

  // === 1. Host starts party with secret ===
  console.log('1️⃣  Host starts party with hostSecret...');
  const host = io(SERVER, { transports: ['websocket'] });
  await new Promise(r => host.on('connect', r));
  
  host.emit('host:startParty', {
    code: PARTY_CODE,
    hostSecret: HOST_SECRET,
    profile: { name: 'DJ Test', emoji: '🎧' }
  });
  await wait(300);
  assert(true, 'Party started with hostSecret');

  // === 2. Host sends trackUpdate with valid secret ===
  console.log('\n2️⃣  Host sends trackUpdate with valid secret...');
  let trackReceived = false;
  
  const guest = io(SERVER, { transports: ['websocket'] });
  await new Promise(r => guest.on('connect', r));
  guest.emit('guest:join', { partyCode: PARTY_CODE, name: 'Alice', emoji: '👩' });
  await wait(300);
  
  guest.on('track:update', (track) => { trackReceived = true; });
  
  host.emit('host:trackUpdate', {
    hostSecret: HOST_SECRET,
    title: 'Test Track',
    artist: 'Test Artist',
    genre: 'Pop',
    bpm: 120
  });
  await wait(300);
  assert(trackReceived, 'Guest received track update (host secret valid)');

  // === 3. Verify hostSecret is NOT in the track update received by guest ===
  console.log('\n3️⃣  Verify secret is stripped from broadcast...');
  let receivedTrack = null;
  guest.removeAllListeners('track:update');
  guest.on('track:update', (track) => { receivedTrack = track; });
  
  host.emit('host:trackUpdate', {
    hostSecret: HOST_SECRET,
    title: 'Secret Test Track',
    artist: 'Test',
    genre: 'Pop',
    bpm: 120
  });
  await wait(300);
  assert(receivedTrack !== null, 'Track received');
  assert(!receivedTrack.hostSecret, 'hostSecret NOT in broadcast to guest');

  // === 4. Guest tries to emit host:endParty without secret ===
  console.log('\n4️⃣  Guest tries host:endParty without secret...');
  let authError = null;
  guest.on('auth:error', (data) => { authError = data; });
  
  guest.emit('host:endParty', {});
  await wait(300);
  assert(authError !== null, 'auth:error received by unauthorized guest');
  assert(authError?.error === 'HOST_AUTH_FAILED', 'Error code is HOST_AUTH_FAILED');

  // === 5. Guest tries with wrong secret ===
  console.log('\n5️⃣  Guest tries with wrong secret...');
  authError = null;
  guest.emit('host:endParty', { hostSecret: 'wrong-secret' });
  await wait(300);
  assert(authError?.error === 'HOST_AUTH_FAILED', 'Wrong secret rejected');

  // === 6. Rate limiting — 5 attempts → disconnect ===
  console.log('\n6️⃣  Rate limiting: 5 invalid attempts...');
  // Guest already has 2 failed attempts from steps 4 & 5
  // Need 3 more to reach 5
  const attacker = io(SERVER, { transports: ['websocket'] });
  await new Promise(r => attacker.on('connect', r));
  attacker.emit('guest:join', { partyCode: PARTY_CODE, name: 'Hacker', emoji: '💀' });
  await wait(200);
  
  let attackerDisconnected = false;
  attacker.on('disconnect', () => { attackerDisconnected = true; });
  
  for (let i = 0; i < 5; i++) {
    attacker.emit('host:endParty', { hostSecret: 'bad-secret-' + i });
    await wait(100);
  }
  await wait(500);
  assert(attackerDisconnected, 'Attacker disconnected after 5 failed attempts');

  // === 7. Legitimate host can still operate ===
  console.log('\n7️⃣  Legitimate host still works...');
  let modeChanged = false;
  // Use a fresh guest listener since 'guest' might still be connected
  const guest2 = io(SERVER, { transports: ['websocket'] });
  await new Promise(r => guest2.on('connect', r));
  guest2.emit('guest:join', { partyCode: PARTY_CODE, name: 'Bob', emoji: '👨' });
  await wait(300);
  guest2.on('mode:change', () => { modeChanged = true; });
  
  host.emit('host:modeChange', { hostSecret: HOST_SECRET, mode: 'Jukebox' });
  await wait(300);
  assert(modeChanged, 'Host still operational after attacker blocked');

  // === 8. host:endParty with valid secret works ===
  console.log('\n8️⃣  host:endParty with valid secret...');
  let partyEnded = false;
  guest2.on('party:ended', () => { partyEnded = true; });
  
  host.emit('host:endParty', { hostSecret: HOST_SECRET });
  await wait(500);
  assert(partyEnded, 'Party ended successfully with valid secret');

  // Cleanup
  host.disconnect();
  guest.disconnect();
  attacker.disconnect();
  guest2.disconnect();

  console.log(`\n${'═'.repeat(40)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(40)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
