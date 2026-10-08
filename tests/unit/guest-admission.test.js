import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
const start = source.indexOf("socket.on('host:approveGuest'");
const end = source.indexOf("socket.on('host:denyGuest'", start);
function setup(connected) {
  const party = { code: 'ABC123', hostSocketId: 'host', pendingGuests: [{ userId: 'user1', socketId: 'guest', firstName: 'Léa', photoURL: 'photo' }], participants: [], sessionTokens: {} };
  const events = [];
  let handler;
  const socket = { id: 'host', on: (_, h) => { handler = h; }, emit() {} };
  const guest = { connected, leave() {}, join() {}, emit: (name, data) => events.push({ name, data }) };
  vm.runInNewContext(source.slice(start, end), {
    socket, getMutableParty: () => party, randomUUID: () => 'token',
    io: { sockets: { sockets: new Map([['guest', guest]]) }, to: () => ({ emit() {} }) },
    buildLightState: p => ({ code: p.code }), joinUserRoom() {},
    Party: { findOneAndUpdate: async () => {} }, console: { log() {}, error() {} }
  });
  return { party, events, run: async () => { let ack; await handler({ userId: 'user1' }, value => { ack = value; }); return ack; } };
}
test('admission confirms immediately without optional profile database lookup', async () => {
  const f = setup(true); const ack = await f.run();
  assert.equal(ack.ok, true);
  assert.equal(f.party.pendingGuests.length, 0);
  assert.equal(f.party.participants[0].name, 'Léa');
  assert.equal(f.party.participants[0].photo, 'photo');
  assert.equal(f.events.find(e => e.name === 'guest:approved').data.guestName, 'Léa');
  assert.equal(f.events.find(e => e.name === 'session:token').data.sessionToken, 'token');
});
test('stale guest connection retains pending request and returns an explicit failure', async () => {
  const f = setup(false); const ack = await f.run();
  assert.equal(ack.error, 'GUEST_OFFLINE');
  assert.equal(f.party.pendingGuests.length, 1);
  assert.equal(f.party.participants.length, 0);
});
