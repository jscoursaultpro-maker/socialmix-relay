/**
 * tests/helpers/mongo.js
 * Minimal MongoDB helper for querying and cleaning up test data.
 * Uses mongoose directly — connects to MONGODB_URI_TEST.
 * Never touches MONGODB_URI (production).
 */
import mongoose from 'mongoose';

// Minimal Party schema (mirrors db.js — only the fields used in tests)
const PartySchema = new mongoose.Schema({
  code:         { type: String, required: true },
  hostSecret:   String,
  partyName:    String,
  endedAt:      Date,
  trackHistory: Array,
  suggestions:  Array,
  participants: Array,
  photos:       Array,
  isPreParty:   Boolean,
}, { strict: false }); // strict:false — accept any extra field the server adds

// Use a separate model name to avoid conflicts if mongoose is also connected elsewhere
let _connection = null;
let Party = null;

export async function connectTestDB() {
  const uri = process.env.MONGODB_URI_TEST;
  if (!uri) throw new Error('MONGODB_URI_TEST env var required for mongo helper');

  if (_connection && _connection.readyState === 1) return; // already connected

  _connection = await mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 8000,
  }).asPromise();

  Party = _connection.model('Party', PartySchema);
  console.log('[TestDB] ✅ Connected to test MongoDB');
}

export async function disconnectTestDB() {
  if (_connection) {
    await _connection.close();
    _connection = null;
    Party = null;
  }
}

/**
 * Find a party document by code.
 * @param {string} code
 * @returns {Promise<object|null>}
 */
export async function findParty(code) {
  if (!Party) throw new Error('Call connectTestDB() first');
  return Party.findOne({ code }).lean();
}

/**
 * Delete all test party documents matching the given codes.
 * Also deletes archived variants (code starts with prefix + "_archived_").
 * @param {...string} codes
 */
export async function cleanupParties(...codes) {
  if (!Party) throw new Error('Call connectTestDB() first');
  for (const code of codes) {
    // Delete exact match + any archived variants created by collision guard
    await Party.deleteMany({
      $or: [
        { code },
        { code: { $regex: `^${code}_archived_` } },
      ],
    });
  }
}

/**
 * Wait up to `maxMs` for a condition on the party document to be true.
 * Polls MongoDB every 50ms. Useful for testing async write-throughs.
 *
 * @param {string}   code
 * @param {Function} predicate  - (partyDoc) => boolean
 * @param {number}   maxMs
 */
export async function waitForPartyCondition(code, predicate, maxMs = 2000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const doc = await findParty(code);
    if (doc && predicate(doc)) return doc;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`Condition not met for party ${code} within ${maxMs}ms`);
}
