// ─── test-friends.js ─── Friends Graph Integration Test ─────────────
// Tests: request → pending → accept → list → delete flow
// Run: node test-friends.js

import { io } from 'socket.io-client';

const SERVER = 'http://localhost:3069';
const PARTY_CODE = 'FRIENDS_TEST';
let passed = 0, failed = 0;

function assert(condition, label) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.error(`  ❌ ${label}`); }
}

function rest(method, path, token, body = null) {
  return fetch(`${SERVER}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': token || ''
    },
    body: body ? JSON.stringify(body) : undefined
  }).then(r => r.json());
}

async function run() {
  console.log('\n🧪 Friends Graph Integration Test\n');

  // 1. Connect host + 2 guests
  console.log('1️⃣  Setting up party + guests...');
  
  const host = io(SERVER);
  const sarah = io(SERVER);
  const tom = io(SERVER);

  await new Promise(r => {
    let count = 0;
    [host, sarah, tom].forEach(s => s.on('connect', () => { count++; if (count === 3) r(); }));
  });
  console.log('  🔌 3 sockets connected');

  // Host starts party
  host.emit('host:startParty', { code: PARTY_CODE, profile: { name: 'DJ Test', emoji: '🎧' } });
  await new Promise(r => setTimeout(r, 500));
  console.log(`  🎉 Party ${PARTY_CODE} started`);

  // Sarah joins
  let sarahToken = null, sarahUserId = null;
  await new Promise(r => {
    sarah.emit('guest:join', { name: 'Sarah', emoji: '👩', partyCode: PARTY_CODE, consentVersion: '1.0', consentTimestamp: Date.now() });
    sarah.on('session:token', (data) => {
      sarahToken = data.sessionToken;
      sarahUserId = data.userId;
      r();
    });
  });
  assert(sarahToken !== null, 'Sarah got session token');
  assert(sarahUserId !== null, `Sarah got userId: ${sarahUserId}`);

  // Tom joins
  let tomToken = null, tomUserId = null;
  await new Promise(r => {
    tom.emit('guest:join', { name: 'Tom', emoji: '👨', partyCode: PARTY_CODE, consentVersion: '1.0', consentTimestamp: Date.now() });
    tom.on('session:token', (data) => {
      tomToken = data.sessionToken;
      tomUserId = data.userId;
      r();
    });
  });
  assert(tomToken !== null, 'Tom got session token');
  assert(tomUserId !== null, `Tom got userId: ${tomUserId}`);

  // 2. Sarah sends friend request to Tom
  console.log('\n2️⃣  Sarah sends friend request to Tom...');
  const reqResult = await rest('POST', '/api/friends/request', sarahToken, { targetUserId: tomUserId, partyCode: PARTY_CODE });
  assert(reqResult.ok === true, 'Friend request created');
  const friendshipId = reqResult.friendship?._id;
  assert(friendshipId, `Friendship ID: ${friendshipId}`);

  // 3. Duplicate check
  console.log('\n3️⃣  Duplicate request check...');
  const dupResult = await rest('POST', '/api/friends/request', sarahToken, { targetUserId: tomUserId });
  assert(dupResult.error === 'Friendship already exists', 'Duplicate blocked');

  // 4. Self-request check
  console.log('\n4️⃣  Self-request check...');
  const selfResult = await rest('POST', '/api/friends/request', sarahToken, { targetUserId: sarahUserId });
  assert(selfResult.error === 'Cannot friend yourself', 'Self-request blocked');

  // 5. Tom sees pending request
  console.log('\n5️⃣  Tom checks pending requests...');
  const pendingResult = await rest('GET', '/api/friends/pending', tomToken);
  assert(pendingResult.ok === true, 'Pending endpoint works');
  assert(pendingResult.pending?.length === 1, `Tom has 1 pending request`);
  assert(pendingResult.pending?.[0]?.fromName === 'Sarah', 'Request from Sarah');

  // 6. Sarah should NOT see it as pending (she sent it)
  const sarahPending = await rest('GET', '/api/friends/pending', sarahToken);
  assert(sarahPending.pending?.length === 0, 'Sarah has 0 pending (she sent it)');

  // 7. Tom accepts
  console.log('\n6️⃣  Tom accepts the request...');
  const acceptResult = await rest('POST', '/api/friends/accept', tomToken, { friendshipId });
  assert(acceptResult.ok === true, 'Friendship accepted');
  assert(acceptResult.friendship?.status === 'accepted', 'Status is accepted');

  // 8. Both see each other in friends list
  console.log('\n7️⃣  Both check friends list...');
  const sarahFriends = await rest('GET', '/api/friends/list', sarahToken);
  assert(sarahFriends.friends?.length === 1, 'Sarah has 1 friend');
  assert(sarahFriends.friends?.[0]?.friendName === 'Tom', 'Sarah\'s friend is Tom');

  const tomFriends = await rest('GET', '/api/friends/list', tomToken);
  assert(tomFriends.friends?.length === 1, 'Tom has 1 friend');
  assert(tomFriends.friends?.[0]?.friendName === 'Sarah', 'Tom\'s friend is Sarah');

  // 9. Sarah removes Tom
  console.log('\n8️⃣  Sarah removes Tom...');
  const deleteResult = await rest('DELETE', `/api/friends/${friendshipId}`, sarahToken);
  assert(deleteResult.ok === true, 'Friendship deleted');

  // 10. Both lists empty now
  const sarahAfter = await rest('GET', '/api/friends/list', sarahToken);
  assert(sarahAfter.friends?.length === 0, 'Sarah has 0 friends after delete');
  const tomAfter = await rest('GET', '/api/friends/list', tomToken);
  assert(tomAfter.friends?.length === 0, 'Tom has 0 friends after delete');

  // 11. Auth check — no token
  console.log('\n9️⃣  Auth checks...');
  const noAuth = await rest('GET', '/api/friends/list', null);
  assert(noAuth.error === 'Missing session token', 'No token rejected');

  const badAuth = await rest('GET', '/api/friends/list', 'bad-token-123');
  assert(badAuth.error === 'Invalid or expired session token', 'Bad token rejected');

  // Summary
  console.log(`\n════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`════════════════════════════════════════\n`);

  host.disconnect();
  sarah.disconnect();
  tom.disconnect();

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
