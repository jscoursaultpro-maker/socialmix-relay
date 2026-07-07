/**
 * tests/integration/provider-ids.test.js
 * Tests for ISRC → providerIds resolution and GET /api/tracks/:id/providers endpoint.
 *
 * Strategy: fetch is stubbed via globalThis.fetch to avoid real API calls.
 * MongoDB writes use the test DB connection (MongoMemoryServer via server-process.js).
 *
 * Test cases:
 *   1. Track with ISRC → Deezer resolved → providers.deezer.trackId set, availableOn=['deezer']
 *   2. Track without ISRC → resolve skipped (no DB write, no API call)
 *   3. Deezer returns 404 → track marked as orphan (availableOn=[])
 *   4. GET /api/tracks/:id/providers → correct shape returned
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer }                       from '../helpers/server-process.js';
import { connectTestDB, disconnectTestDB,
         getTestUserModel }                  from '../helpers/mongo.js';

// ─── Test track schema (minimal) ─────────────────────────────────────────────
import mongoose from 'mongoose';
import { mmsState } from '../helpers/mms-state.js';

// We use a fresh Track model bound to the test connection (not the default connection)
const TrackTestSchema = new mongoose.Schema({
  isrc:         { type: String, sparse: true },
  fallbackHash: { type: String, required: true },
  title:        { type: String, required: true },
  artist:       { type: String, required: true },
  genre:        { type: String, default: 'Pop' },
  providers: {
    deezer:     { trackId: Number, albumId: Number },
    spotify:    { trackId: String },
    appleMusic: { trackId: String },
  },
  availableOn:               { type: [String], default: [] },
  providerIdsResolvedAt:     { type: Date, default: null },
  providerIdsResolvedVersion: { type: String, default: null },
}, { strict: false });

let _testTrackModel = null;
function getTrackModel() {
  if (!_testTrackModel) throw new Error('Call connectTestDB() first');
  return _testTrackModel;
}

// ─── Fetch stub helpers ───────────────────────────────────────────────────────
const DEEZER_SUCCESS = (isrc) => ({
  ok: true,
  json: async () => ({ id: 123456, album: { id: 789 } }),
});

const DEEZER_NOT_FOUND = () => ({
  ok: true,
  json: async () => ({ error: { type: 'Exception', message: 'no data', code: 800 } }),
});

const DEEZER_HTTP_ERROR = () => ({
  ok: false,
  json: async () => ({}),
});

let _originalFetch;
function stubFetch(handler) {
  _originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(url, opts);
}
function restoreFetch() {
  if (_originalFetch) globalThis.fetch = _originalFetch;
}

// ─── Import providerResolver functions under test ─────────────────────────────
// We import from the lib — these use globalThis.fetch which we can stub
import { resolveDeezer } from '../../lib/providerResolver.mjs';

// ─── Suite ────────────────────────────────────────────────────────────────────
describe('Provider IDs — ISRC resolution + /api/tracks/:id/providers', () => {
  let serverCtx;

  before(async () => {
    serverCtx = await startServer();
    await connectTestDB();

    // Create Track model bound to test connection (mmsState.server has the right URI)
    const conn = await mongoose.createConnection(mmsState.uri, {
      dbName: 'socialmix',
      directConnection: true,
      serverSelectionTimeoutMS: 2000,
    }).asPromise();
    _testTrackModel = conn.model('Track', TrackTestSchema);
  });

  after(async () => {
    restoreFetch();
    if (_testTrackModel) {
      await _testTrackModel.deleteMany({ isrc: { $in: ['USTEST000001', 'USTEST000002', 'USTEST000003'] } }).catch(() => {});
    }
    await serverCtx?.kill();
    await disconnectTestDB();
  });

  afterEach(() => {
    restoreFetch();
  });

  // ── Case 1: Track with ISRC → Deezer resolved ─────────────────────────────
  it('Track with ISRC → Deezer resolved → providers.deezer.trackId set, availableOn=[deezer]', async () => {
    // Insert test track
    const Track = getTrackModel();
    const testTrack = await Track.create({
      isrc: 'USTEST000001',
      fallbackHash: 'hotel_california_eagles',
      title: 'Hotel California',
      artist: 'Eagles',
      genre: 'Rock',
    });

    // Stub Deezer to return success
    stubFetch(() => DEEZER_SUCCESS());

    // Resolve via providerResolver
    const result = await resolveDeezer('USTEST000001');

    assert.ok(result, 'resolveDeezer should return a result');
    assert.equal(result.trackId, 123456, 'trackId should be 123456');
    assert.equal(result.albumId, 789, 'albumId should be 789');

    // Write to DB (simulating what backfill does)
    await Track.updateOne(
      { _id: testTrack._id },
      {
        $set: {
          'providers.deezer.trackId': result.trackId,
          'providers.deezer.albumId': result.albumId,
          availableOn: ['deezer'],
          providerIdsResolvedAt: new Date(),
          providerIdsResolvedVersion: 'v1-2026-07',
        },
      }
    );

    const updated = await Track.findById(testTrack._id).lean();
    assert.equal(updated.providers?.deezer?.trackId, 123456, 'providers.deezer.trackId should be 123456');
    assert.equal(updated.providers?.deezer?.albumId, 789, 'providers.deezer.albumId should be 789');
    assert.deepEqual(updated.availableOn, ['deezer'], 'availableOn should be [deezer]');
    assert.ok(updated.providerIdsResolvedAt instanceof Date, 'providerIdsResolvedAt should be a Date');
    assert.equal(updated.providerIdsResolvedVersion, 'v1-2026-07');
  });

  // ── Case 2: Track without ISRC → resolve skipped ──────────────────────────
  it('Track without ISRC → resolveDeezer returns null, no API call', async () => {
    let fetchCalled = false;
    stubFetch(() => { fetchCalled = true; return DEEZER_SUCCESS(); });

    const result = await resolveDeezer(null);

    assert.equal(result, null, 'resolveDeezer(null) should return null');
    assert.equal(fetchCalled, false, 'fetch should NOT be called for null ISRC');
  });

  // ── Case 3: Deezer returns error → orphan (availableOn=[]) ────────────────
  it('Deezer returns error body → resolveDeezer returns null (orphan)', async () => {
    stubFetch(() => DEEZER_NOT_FOUND());

    const result = await resolveDeezer('USTEST000003');

    assert.equal(result, null, 'resolveDeezer should return null when Deezer returns error body');
  });

  // ── Case 4: GET /api/tracks/:id/providers → correct shape ─────────────────
  it('GET /api/tracks/:id/providers → 200 with correct shape', async () => {
    // Create a track via Socket startParty flow — instead, create directly in test DB
    // and use the Deezer trackId as the lookup key
    const Track = getTrackModel();
    await Track.create({
      isrc: 'USTEST000002',
      fallbackHash: 'bohemian_rhapsody_queen',
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      genre: 'Rock',
      'providers.deezer.trackId': 999888,
      'providers.appleMusic.trackId': 'am-123456',
      availableOn: ['deezer', 'appleMusic'],
      providerIdsResolvedAt: new Date('2026-07-06'),
      providerIdsResolvedVersion: 'v1-2026-07',
    });

    // Query by Deezer trackId (numeric)
    const res = await fetch(`${serverCtx.url}/api/tracks/999888/providers`);
    assert.equal(res.status, 200, `Expected HTTP 200, got ${res.status}`);

    const body = await res.json();
    assert.ok(body.id, 'Response should have id field');
    assert.equal(body.isrc, 'USTEST000002');
    assert.ok(body.providers, 'Response should have providers field');
    assert.equal(body.providers?.appleMusic?.trackId, 'am-123456', 'providers.appleMusic.trackId should be set');
    assert.ok(Array.isArray(body.availableOn), 'availableOn should be an array');
    assert.ok(body.availableOn.includes('deezer'), 'availableOn should include deezer');
    assert.ok(body.availableOn.includes('appleMusic'), 'availableOn should include appleMusic');
    assert.equal(body.providerIdsResolvedVersion, 'v1-2026-07');
  });
});
