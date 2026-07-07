/**
 * tests/helpers/mongo.js
 * Minimal MongoDB helper for querying and cleaning up test data.
 * Each call to connectTestDB() creates a fresh connection to the current MMS URI.
 * No shared persistent state between test suites.
 */
import mongoose from 'mongoose';
import { mmsState } from './mms-state.js';

// Minimal Party schema — mirrors db.js, only fields used in tests.
// strict:false accepts any extra fields the server may add.
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
}, { strict: false });

// Minimal User schema for auth tests — mirrors models/User.js relevant fields.
const UserSchema = new mongoose.Schema({
  supabaseUserId: { type: String, sparse: true },
  email:          { type: String, lowercase: true, trim: true },
  authProvider:   String,
  providerId:     String,
  emailVerified:  { type: Boolean, default: false },
  profile:        { firstName: String, emoji: String },
  isBanned:       { type: Boolean, default: false },
  isDeleted:      { type: Boolean, default: false },
  createdAt:      { type: Date, default: Date.now },
  lastSeenAt:     { type: Date, default: Date.now },
}, { strict: false });

/** Module-level connection (one per test process, closed on after()) */
let _connection = null;
let _Party = null;
let _User  = null;

export async function connectTestDB() {
  const uri = mmsState.uri || process.env.MONGODB_URI_TEST;
  if (!uri) {
    throw new Error(
      'No test MongoDB URI available. ' +
      'Make sure startServer() is called before connectTestDB(). ' +
      'server-process.js sets mmsState.uri when MongoMemoryServer starts.'
    );
  }

  // If already connected to the same URI, reuse
  if (_connection && _connection.readyState === 1) return;

  // If connected to a different URI (different MMS instance), close first
  if (_connection) {
    await _connection.close().catch(() => {});
    _connection = null;
    _Party = null;
  }

  _connection = await mongoose.createConnection(uri, {
    dbName: 'socialmix',        // must match db.js → connectDB({ dbName: 'socialmix' })
    serverSelectionTimeoutMS: 2_000,  // fail fast if MMS is stopped
    directConnection: true,     // required for MMS single-node
  }).asPromise();

  _Party = _connection.model('Party', PartySchema);
  _User  = _connection.model('User',  UserSchema);
  console.log('[TestDB] ✅ Connected to in-memory MongoDB');
}

export async function disconnectTestDB() {
  if (_connection) {
    // Race against 3s timeout to prevent after() from hanging
    await Promise.race([
      _connection.close().catch(() => {}),
      new Promise(r => setTimeout(r, 3000)),
    ]);
    _connection = null;
    _Party = null;
    _User  = null;
  }
}

function getParty() {
  if (!_Party) throw new Error('Call connectTestDB() first');
  return _Party;
}

export function getTestPartyModel() {
  return getParty();
}

/** Returns a User model bound to the test DB connection. */
export function getTestUserModel() {
  if (!_User) throw new Error('Call connectTestDB() first');
  return _User;
}

/**
 * Find a party document by code.
 * @param {string} code
 * @returns {Promise<object|null>}
 */
export async function findParty(code) {
  return getParty().findOne({ code }).lean();
}

/**
 * Delete all test party documents matching the given codes.
 * Also deletes archived variants (code starts with prefix + "_archived_").
 * @param {...string} codes
 */
export async function cleanupParties(...codes) {
  const Party = getParty();
  for (const code of codes) {
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
 * Polls MongoDB every 100ms.
 * @param {string}   code
 * @param {Function} predicate  - (partyDoc) => boolean
 * @param {number}   maxMs      - default 8000ms (generous for async server flush)
 */
export async function waitForPartyCondition(code, predicate, maxMs = 8000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const doc = await findParty(code);
    if (doc && predicate(doc)) return doc;
    await new Promise(r => setTimeout(r, 100));
  }
  const lastDoc = await findParty(code);
  throw new Error(
    `Condition not met for party ${code} within ${maxMs}ms.\n` +
    `Last doc: ${JSON.stringify(lastDoc ? {
      code: lastDoc.code,
      hostSecret: lastDoc.hostSecret ? '****' + lastDoc.hostSecret.slice(-4) : null,
      endedAt: lastDoc.endedAt,
      trackHistory: lastDoc.trackHistory?.length,
      participants: lastDoc.participants?.length,
    } : null)}`
  );
}

/**
 * Delete all test User documents matching the given emails or supabaseUserIds.
 * @param {...string} emails
 */
export async function cleanupUsers(...emails) {
  const User = getTestUserModel();
  for (const email of emails) {
    await User.deleteMany({ email }).catch(() => {});
  }
}
