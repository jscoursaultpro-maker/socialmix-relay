import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProviderVotesRouter } from '../../routes/user-votes.js';

for (const testedProvider of ['deezer', 'spotify']) test(`${testedProvider} vote accepts verified identity and preserves repeat count`, async () => {
  const user = { _id: 'account', votedProviders: [] };
  let count = 0;
  const app = express(); app.use(express.json());
  app.use(createProviderVotesRouter({
    verify: async token => { if (token !== 'supabase-session') throw Object.assign(new Error(), { name: 'AuthError' }); return { sub: 'supabase-id' }; },
    resolveUser: async claims => { assert.equal(claims.sub, 'supabase-id'); return user; },
    UserModel: { findByIdAndUpdate: async (id, change) => { assert.equal(id, 'account'); user.votedProviders.push(change.$addToSet.votedProviders); } },
    VoteModel: { getCounts: async () => ({ [testedProvider]: count }), findOneAndUpdate: async () => ({ [testedProvider]: ++count }) }
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
  const vote = async (token, provider = testedProvider) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/provider`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ provider }) });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await vote()).status, 401);
    assert.equal((await vote('invalid')).status, 401);
    assert.equal((await vote('supabase-session', 'unknown')).status, 400);
    assert.deepEqual((await vote('supabase-session')).body, { success: true, provider: testedProvider, count: 1 });
    assert.deepEqual((await vote('supabase-session')).body, { already: true, provider: testedProvider, count: 1 });
    user.isBanned = true;
    assert.equal((await vote('supabase-session')).status, 403);
    assert.equal(count, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
