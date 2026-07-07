/**
 * tests/integration/auth.test.js
 * Integration tests for Supabase JWT authentication flow.
 *
 * Strategy: tokens use the "test:<base64-JSON-payload>" format recognised by
 * verifySupabaseJWT when NODE_ENV=test. This works across the child-process
 * boundary (server runs as a spawned child — process-local stubs have no effect).
 *
 * Error tokens use payload { __error: { code, message } }.
 *
 * Tested cases:
 *   1. Socket without token  → connect OK, V0 backward compat (socket.user = null)
 *   2. Socket with valid JWT → connect OK, User created in Mongo with supabaseUserId
 *   3. Socket with invalid JWT → connection refused (AUTH_INVALID_TOKEN)
 *   4. Second connection same supabaseUserId → same Mongo User (no duplicate)
 *   5. Legacy user (email exists, no supabaseUserId) → account linked on login
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';

import { startServer }                    from '../helpers/server-process.js';
import { connectTestDB, disconnectTestDB,
         getTestUserModel, cleanupUsers } from '../helpers/mongo.js';
import { verifySupabaseJWT }              from '../../lib/supabaseAuth.js';

// ─── Token helpers ────────────────────────────────────────────────────────────
/** Encode a Supabase-like payload into a cross-process test token. */
function makeTestToken(payload) {
  return 'test:' + Buffer.from(JSON.stringify(payload)).toString('base64');
}

/** Encode an error trigger token ({__error:{code,message}}). */
function makeErrorToken(code, message) {
  return makeTestToken({ __error: { code, message } });
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────
const USER_A = {
  sub:   'aaaaaaaa-0000-4000-8000-000000000001',
  email: 'alice@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata:  { provider: 'email' },
  user_metadata: { full_name: 'Alice Test' },
  aud: 'authenticated',
};

const USER_B = {
  sub:   'bbbbbbbb-0000-4000-8000-000000000002',
  email: 'bob@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata:  { provider: 'google' },
  user_metadata: { full_name: 'Bob Test' },
  aud: 'authenticated',
};

const LEGACY_EMAIL = 'legacy@example.com';
const USER_LEGACY_SUB = 'cccccccc-0000-4000-8000-000000000003';

// ─── Socket helpers ───────────────────────────────────────────────────────────
function createSocket(url, token = null) {
  return ioClient(url, {
    transports: ['websocket'],
    reconnection: false,
    auth: token ? { token } : {},
  });
}

function connectOrFail(socket, label = '') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Socket connect timeout ${label}`)), 5000);
    socket.once('connect',       () => { clearTimeout(t); resolve(socket); });
    socket.once('connect_error', (err) => { clearTimeout(t); reject(err); });
  });
}

function expectConnectError(socket) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error('Expected connect_error but socket connected cleanly'));
    }, 5000);
    socket.once('connect_error', (err) => { clearTimeout(t); resolve(err); });
    socket.once('connect', () => {
      clearTimeout(t);
      reject(new Error('Socket connected — expected rejection with invalid token'));
    });
  });
}

// ─── Suite ───────────────────────────────────────────────────────────────────
describe('Supabase auth — socket + /api/me', () => {
  let serverCtx;
  const sockets = [];

  before(async () => {
    serverCtx = await startServer();
    await connectTestDB();
    // Clean up any users from previous test runs (idempotency)
    await cleanupUsers(USER_A.email, USER_B.email, LEGACY_EMAIL);
  });

  after(async () => {
    for (const s of sockets) {
      try { s.disconnect(); } catch {}
    }
    await cleanupUsers(USER_A.email, USER_B.email, LEGACY_EMAIL);
    await serverCtx?.kill();
    await disconnectTestDB();
  });

  // ── Fail-safe Unit Test ───────────────────────────────────────────────────
  it('rejects test:* tokens when NODE_ENV is not test', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await verifySupabaseJWT('test:user123');
      assert.fail('Should have thrown AuthError');
    } catch (err) {
      assert.equal(err.code, 'TOKEN_INVALID');
      assert.equal(err.message, 'test_token_in_production');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  // ── Edge Case Tests ────────────────────────────────────────────────────────
  it('rejects token with expired exp claim', async () => {
    const expiredToken = makeTestToken({
        sub: 'user-123',
        exp: Math.floor(Date.now() / 1000) - 3600,
        aud: 'authenticated',
        iss: process.env.SUPABASE_URL || 'https://socialmix.supabase.co/auth/v1'
    });
    const s = createSocket(serverCtx.url, expiredToken);
    sockets.push(s);
    const err = await expectConnectError(s);
    assert.ok(err, 'Should receive connect_error');
    assert.equal(err.message, 'AUTH_INVALID_TOKEN');
    assert.equal(err.data?.code, 'TOKEN_EXPIRED');
    assert.match(String(err.data?.reason), /expired/i);
  });

  it('rejects token with wrong audience', async () => {
    const wrongAudToken = makeTestToken({
        sub: 'user-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        aud: 'wrong-audience',
        iss: process.env.SUPABASE_URL || 'https://socialmix.supabase.co/auth/v1'
    });
    const s = createSocket(serverCtx.url, wrongAudToken);
    sockets.push(s);
    const err = await expectConnectError(s);
    assert.ok(err, 'Should receive connect_error');
    assert.equal(err.message, 'AUTH_INVALID_TOKEN');
    assert.equal(err.data?.code, 'TOKEN_AUDIENCE');
    assert.match(String(err.data?.reason), /audience/i);
  });

  it('rejects token with wrong issuer', async () => {
    const wrongIssToken = makeTestToken({
        sub: 'user-123',
        exp: Math.floor(Date.now() / 1000) + 3600,
        aud: 'authenticated',
        iss: 'https://fake-supabase.com'
    });
    const s = createSocket(serverCtx.url, wrongIssToken);
    sockets.push(s);
    const err = await expectConnectError(s);
    assert.ok(err, 'Should receive connect_error');
    assert.equal(err.message, 'AUTH_INVALID_TOKEN');
    assert.equal(err.data?.code, 'TOKEN_INVALID');
    assert.match(String(err.data?.reason), /issuer/i);
  });

  // ── Case 1: No token → V0 backward compat ─────────────────────────────────
  it('socket without token → connect OK (V0 backward compat, socket.user=null)', async () => {
    const s = createSocket(serverCtx.url); // no token
    sockets.push(s);
    await connectOrFail(s, 'case-1');
    assert.ok(s.connected, 'Socket should be connected without a token');
    // Server is responsive
    const resp = await fetch(`${serverCtx.url}/api/status`);
    assert.equal(resp.status, 200);
  });

  // ── Case 2: Valid token → User created in Mongo ────────────────────────────
  it('socket with valid JWT → connect OK + User created in Mongo', async () => {
    const token = makeTestToken(USER_A);
    const s = createSocket(serverCtx.url, token);
    sockets.push(s);
    await connectOrFail(s, 'case-2');
    assert.ok(s.connected, 'Socket should be connected with valid test token');

    // Give server async findOrCreate time to settle
    await new Promise(r => setTimeout(r, 600));

    const User = getTestUserModel();
    const user = await User.findOne({ supabaseUserId: USER_A.sub }).lean();
    assert.ok(user, 'User should be created in Mongo after socket auth');
    assert.equal(user.email, USER_A.email);
    assert.equal(user.supabaseUserId, USER_A.sub);
    assert.equal(user.authProvider, 'email');
    assert.ok(user.emailVerified, 'emailVerified should be true (email_confirmed_at set)');
    assert.equal(user.profile?.firstName, 'Alice');
  });

  // ── Case 3: Invalid token → connection refused ─────────────────────────────
  it('socket with invalid token → connect_error (AUTH_INVALID_TOKEN)', async () => {
    const token = makeErrorToken('TOKEN_INVALID', 'Signature verification failed');
    const s = createSocket(serverCtx.url, token);
    sockets.push(s);

    const err = await expectConnectError(s);
    assert.ok(err, 'Should receive connect_error');
    assert.match(
      err.message,
      /AUTH_INVALID_TOKEN/,
      `Expected AUTH_INVALID_TOKEN in error message, got: ${err.message}`
    );
  });

  // ── Case 4: Same supabaseUserId → no duplicate ────────────────────────────
  it('second connection with same supabaseUserId → same Mongo User (no duplicate)', async () => {
    const token = makeTestToken(USER_B);

    // First connection
    const s1 = createSocket(serverCtx.url, token);
    sockets.push(s1);
    await connectOrFail(s1, 'case-4a');
    await new Promise(r => setTimeout(r, 600));

    // Second connection same user
    const s2 = createSocket(serverCtx.url, token);
    sockets.push(s2);
    await connectOrFail(s2, 'case-4b');
    await new Promise(r => setTimeout(r, 600));

    const User = getTestUserModel();
    const users = await User.find({ supabaseUserId: USER_B.sub }).lean();
    assert.equal(users.length, 1, `Expected 1 User for Bob, found ${users.length}`);
    assert.equal(users[0].email, USER_B.email);
  });

  // ── Case 5: Legacy V0 user linked on Supabase login ───────────────────────
  it('legacy user (email, no supabaseUserId) → linked to supabaseUserId on login', async () => {
    // Create V0 legacy user directly via test DB connection (no supabaseUserId)
    const User = getTestUserModel();
    await User.create({
      email:        LEGACY_EMAIL,
      authProvider: 'email',
      providerId:   'legacy-provider-id-xyz',
      emailVerified: false,
      profile:      { firstName: 'Legacy', emoji: '🎉' },
    });

    // Verify legacy user exists without supabaseUserId
    const before = await User.findOne({ email: LEGACY_EMAIL }).lean();
    assert.ok(before, 'Legacy user should exist before linking');
    assert.equal(before.supabaseUserId, undefined, 'Legacy user should not have supabaseUserId yet');

    // Connect with a valid test token using the legacy email + a new supabaseUserId
    const legacyPayload = {
      sub:   USER_LEGACY_SUB,
      email: LEGACY_EMAIL,
      email_confirmed_at: '2026-01-01T00:00:00Z',
      app_metadata:  { provider: 'apple' },
      user_metadata: { full_name: 'Legacy User' },
      aud: 'authenticated',
    };
    const token = makeTestToken(legacyPayload);
    const s = createSocket(serverCtx.url, token);
    sockets.push(s);
    await connectOrFail(s, 'case-5');
    await new Promise(r => setTimeout(r, 800));

    // Legacy user should now be linked (supabaseUserId set, authProvider updated)
    const linked = await User.findOne({ email: LEGACY_EMAIL }).lean();
    assert.ok(linked, 'Legacy user should still exist after linking');
    assert.equal(
      linked.supabaseUserId, USER_LEGACY_SUB,
      'supabaseUserId should be set on legacy user after linking'
    );
    assert.equal(linked.authProvider, 'apple', 'authProvider should be updated to apple');

    // Exactly one User with this email (no duplicate created)
    const all = await User.find({ email: LEGACY_EMAIL }).lean();
    assert.equal(all.length, 1, `Expected 1 User with ${LEGACY_EMAIL}, found ${all.length}`);
  });
});
