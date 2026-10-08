import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/server-process.js';
import { createHostSocket, connected, startParty, waitFor } from '../helpers/client.js';

test('web host can suggest and resume on a new socket without losing history', async () => {
  const server = await startServer();
  let host, resumed;
  try {
    host = createHostSocket(server.url);
    await connected(host);
    await startParty(host, { code: 'QAWEBH', hostSecret: 'local-test-secret', profile: { name: 'QA Host', email: 'qa@example.com' }, streamingProvider: 'youtube' });
    for (let i = 0; i < 8; i++) {
      const snapshot = waitFor(host, 'party:state', 5000);
      host.emit('host:requestState', { hostSecret: 'local-test-secret' });
      await snapshot;
    }
    assert.equal(host.connected, true);
    const message = waitFor(host, 'guest:message', 5000);
    host.emit('guest:message', { guestName: 'QA Host', message: 'Local QA message' });
    assert.equal((await message).message, 'Local QA message');
    const ack = await host.timeout(5000).emitWithAck('guest:suggest', { title: 'QA song', artist: 'QA artist', deezerID: '123', eventId: 'qa-web-host-suggestion' });
    assert.equal(ack.ok, true, JSON.stringify(ack));
    host.disconnect();
    resumed = createHostSocket(server.url);
    await connected(resumed);
    const response = waitFor(resumed, 'party:resumed', 5000);
    resumed.emit('host:resumeParty', { code: 'QAWEBH', hostSecret: 'local-test-secret', profile: { name: 'QA Host' } });
    const party = await response;
    assert.equal(party.code, 'QAWEBH');
    assert.ok(party.state.suggestions.some(s => s.title === 'QA song'));
    const next = await resumed.timeout(5000).emitWithAck('guest:suggest', { title: 'Second QA song', artist: 'QA artist', deezerID: '124', eventId: 'qa-web-host-second' });
    assert.equal(next.ok, true, JSON.stringify(next));
  } finally {
    host?.disconnect(); resumed?.disconnect(); await server.kill();
  }
});
