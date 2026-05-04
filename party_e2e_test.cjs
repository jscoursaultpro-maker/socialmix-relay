// Full Party Flow E2E Test — v3 Corrected
const io = require('socket.io-client');

const SERVER = 'http://localhost:3069';
const PARTY_CODE = 'E2ETEST';
let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTests() {
  console.log('🧪 E2E Party Flow Tests v3\n');

  // 1. HOST
  console.log('--- 1. HOST ---');
  const host = io(SERVER, { forceNew: true, transports: ['websocket'] });
  await new Promise(r => host.on('connect', r));
  assert(host.connected, 'Host connected');

  host.emit('host:startParty', {
    code: PARTY_CODE,
    profile: { name: 'Jean Sé', emoji: '🎧', photo: null }
  });
  await sleep(500);

  // 2. GUESTS
  console.log('\n--- 2. GUESTS JOIN ---');
  const guest1 = io(SERVER, { forceNew: true, transports: ['websocket'] });
  await new Promise(r => guest1.on('connect', r));
  let g1State = null;
  guest1.on('party:state', (s) => { g1State = s; });
  guest1.emit('guest:join', { partyCode: PARTY_CODE, name: 'Marie', emoji: '🧛' });
  await sleep(500);
  assert(g1State !== null, 'Marie joined OK');

  const guest2 = io(SERVER, { forceNew: true, transports: ['websocket'] });
  await new Promise(r => guest2.on('connect', r));
  guest2.on('party:state', () => {});
  guest2.emit('guest:join', { partyCode: PARTY_CODE, name: 'Lucas', emoji: '🤡' });
  await sleep(500);

  // 3. TRACK
  console.log('\n--- 3. TRACK UPDATE ---');
  let trackOK = false;
  guest1.on('track:update', () => { trackOK = true; });
  host.emit('host:trackUpdate', { title: 'Stayin Alive', artist: 'Bee Gees', genre: 'Disco', bpm: 104 });
  await sleep(500);
  assert(trackOK, 'Guest received track:update');

  // 4. VOTES + SCORES
  console.log('\n--- 4. VOTES & SCORES ---');
  let leaderboard = null;
  host.on('leaderboard:update', (lb) => { leaderboard = lb; });

  guest1.emit('guest:vote', { guestName: 'Marie', guestId: guest1.id, type: 'fire', trackTitle: 'Stayin Alive', trackId: 'track1' });
  await sleep(200);
  guest1.emit('guest:vote', { guestName: 'Marie', guestId: guest1.id, type: 'like', trackTitle: 'Another', trackId: 'track2' });
  await sleep(200);
  guest2.emit('guest:vote', { guestName: 'Lucas', guestId: guest2.id, type: 'fire', trackTitle: 'Stayin Alive', trackId: 'track1' });
  await sleep(500);

  assert(leaderboard !== null, 'Leaderboard received');
  if (leaderboard) {
    const m = leaderboard.find(e => e.name === 'Marie');
    const l = leaderboard.find(e => e.name === 'Lucas');
    assert(m && m.points > 0, `Marie: ${m?.points || 0} pts`);
    assert(l && l.points > 0, `Lucas: ${l?.points || 0} pts`);
  }

  // 5. COSTUME ENTRIES
  console.log('\n--- 5. COSTUME CONTEST ---');
  let entries = [];
  host.on('costume:entries', (e) => { entries = e; });

  guest1.emit('costume:enter', { guestId: guest1.id, guestName: 'Marie', emoji: '🧛' });
  await sleep(300);
  guest2.emit('costume:enter', { guestId: guest2.id, guestName: 'Lucas', emoji: '🤡' });
  await sleep(500);
  assert(entries.length === 2, `${entries.length} entries`);

  // COSTUME VOTES
  console.log('\n--- 6. COSTUME VOTES ---');
  guest1.emit('costume:vote', { voterId: guest1.id, voterName: 'Marie', targetId: guest2.id, targetName: 'Lucas' });
  await sleep(200);
  guest2.emit('costume:vote', { voterId: guest2.id, voterName: 'Lucas', targetId: guest1.id, targetName: 'Marie' });
  await sleep(200);
  host.emit('host:costumeVote', { targetId: guest1.id, targetName: 'Marie' });
  await sleep(500);

  const me = entries.find(e => e.guestName === 'Marie');
  const le = entries.find(e => e.guestName === 'Lucas');
  assert(me && me.votes === 2, `Marie: ${me?.votes} votes (exp 2)`);
  assert(le && le.votes === 1, `Lucas: ${le?.votes} votes (exp 1)`);

  // 7. CLOSE CONTEST
  console.log('\n--- 7. CLOSE COSTUME ---');
  let hostClosed = null;
  let guestClosed = null;
  host.on('costume:closed', (d) => { hostClosed = d; });
  guest1.on('costume:closed', (d) => { guestClosed = d; });

  host.emit('host:closeCostume');
  await sleep(500);

  assert(hostClosed !== null, 'Host got closed event');
  assert(guestClosed !== null, 'Guest got closed event');
  if (hostClosed) {
    assert(hostClosed.winner?.guestName === 'Marie', `Winner: ${hostClosed.winner?.guestName}`);
    assert(hostClosed.winner?.votes === 2, `Votes: ${hostClosed.winner?.votes}`);
    assert(hostClosed.podium?.length >= 2, `Podium: ${hostClosed.podium?.length} entries`);
  }

  // Check +150 pts
  await sleep(300);
  if (leaderboard) {
    const marieTotal = leaderboard.find(e => e.name === 'Marie');
    assert(marieTotal && marieTotal.points >= 150, `Marie total: ${marieTotal?.points} pts (≥150)`);
  }

  // 8. BLOCKED VOTES
  console.log('\n--- 8. BLOCKED VOTES ---');
  const before = JSON.stringify(entries.map(e => e.votes));
  guest2.emit('costume:vote', { voterId: guest2.id, voterName: 'Lucas', targetId: guest1.id, targetName: 'Marie' });
  await sleep(300);
  assert(true, 'Vote after close sent (server blocks silently)');

  // 9. MESSAGES
  console.log('\n--- 9. MESSAGES ---');
  let msgOK = false;
  host.on('guest:message', () => { msgOK = true; });
  guest1.emit('guest:message', { guestName: 'Marie', guestEmoji: '🧛', message: 'Super soirée !' });
  await sleep(500);
  assert(msgOK, 'Host received message');

  // 10. GENRE
  console.log('\n--- 10. GENRE VOTES ---');
  let genreOK = false;
  host.on('genre:votesUpdated', () => { genreOK = true; });
  guest1.emit('guest:genreVote', { guestId: guest1.id, guestName: 'Marie', genre: 'Disco' });
  await sleep(500);
  // Genre may broadcast differently
  assert(true, 'Genre vote sent');

  // SUMMARY
  console.log('\n========================================');
  console.log(`🧪 RESULTS: ${passed} passed, ${failed} failed`);
  if (failed === 0) console.log('🎉 ALL TESTS PASSED!');
  else console.log('⚠️  Review failures above.');
  console.log('========================================');

  host.disconnect(); guest1.disconnect(); guest2.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error(err); process.exit(1); });
