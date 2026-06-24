// ─── MongoDB Persistence Layer ──────────────────────────────────────
// Debounced writes (30s), boot recovery, graceful shutdown.
// Falls back to in-memory only if MONGO_URI is not set.

import mongoose from 'mongoose';
import Party from './models/Party.js';
import GuestSession from './models/GuestSession.js';
import { createPartyState } from './partyState.js';

const FLUSH_INTERVAL = 30_000; // 30 seconds
const STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours


let connected = false;
let flushTimer = null;

// ─── Connect ────────────────────────────────────────────────────────
export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.log('⚠️  No MONGO_URI — running in-memory only (no persistence)');
    return false;
  }
  try {
    await mongoose.connect(uri, {
      dbName: 'socialmix',
      serverSelectionTimeoutMS: 5000
    });
    connected = true;
    console.log('✅ MongoDB connected');
    return true;
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.log('⚠️  Falling back to in-memory only');
    return false;
  }
}

// ─── Party → Mongo document ─────────────────────────────────────────
function partyToDoc(party) {
  const photos = party.photos;
  return {
    code: party.code,
    hostSecret: party.hostSecret || '',
    partyType: party.partyType || 'hosted',
    mode: party.mode,
    currentTrack: party.currentTrack,
    nextTrack: party.nextTrack,
    trackHistory: party.trackHistory,
    genreVotes: party.genreVotes,
    vibeScore: party.vibeScore,
    participants: party.participants,
    guestVotes: party.guestVotes,
    suggestions: party.suggestions,
    hostProfile: party.hostProfile,
    photos: photos,
    photoCount: party.photos.length,
    costumeEntries: party.costumeEntries,
    costumeOpen: party.costumeOpen,
    costumeVoters: party.costumeVoters,
    participantScores: party.participantScores,
    guestGenreVotes: party.guestGenreVotes,
    sessionTokens: party.sessionTokens || {},  // Persist for guest reconnection after server restart
    createdAt: party.createdAt,
    endedAt: party.endedAt || null
  };
}

// ─── Mongo document → in-memory party state ─────────────────────────
function docToPartyState(doc) {
  const party = createPartyState(doc.code);
  party.mode = doc.mode || 'appMix';
  party.currentTrack = doc.currentTrack || null;
  party.nextTrack = doc.nextTrack || null;
  party.trackHistory = doc.trackHistory || [];
  party.genreVotes = doc.genreVotes || {};
  party.vibeScore = doc.vibeScore || 0;
  party.participants = doc.participants || [];
  party.guestVotes = doc.guestVotes || {};
  party.suggestions = doc.suggestions || [];
  party.hostProfile = doc.hostProfile || null;
  party.photos = doc.photos || [];
  party.costumeEntries = doc.costumeEntries || [];
  party.costumeOpen = doc.costumeOpen !== false;
  party.costumeVoters = doc.costumeVoters || {};
  party.participantScores = doc.participantScores || {};
  party.guestGenreVotes = doc.guestGenreVotes || {};
  party.hostSecret = doc.hostSecret || '';
  party.partyType = doc.partyType || 'hosted';
  party.sessionTokens = doc.sessionTokens || {};  // Restore guest reconnection tokens
  party.createdAt = doc.createdAt ? new Date(doc.createdAt).toISOString() : party.createdAt;

  // Rebuild runtime Sets from persisted data
  party.photoHashes = new Set();
  for (const p of party.photos) {
    const url = p.dataURL || '';
    const mid = Math.floor(url.length / 2);
    party.photoHashes.add(url.length + ':' + url.substring(mid, mid + 80));
  }
  party.profilePointsGiven = new Set(
    Object.keys(party.participantScores).filter(k => k !== 'host')
  );
  party._genreVotedOnce = {};
  for (const key of Object.keys(party.guestGenreVotes)) {
    party._genreVotedOnce[key] = true;
  }

  // Mark as clean (just loaded from DB)
  party.isDirty = false;
  party.lastFlushed = Date.now();

  return party;
}

// ─── Flush a single party to MongoDB ────────────────────────────────────────────────────────────
// ⚠️ FIX FAILLE 6 : Ne JAMAIS écraser trackHistory ou participants si la RAM est vide
// et que MongoDB possède déjà des données (cas de reconnexion post-crash ou post-restart).
async function flushParty(party) {
  if (!connected) return;
  try {
    const doc = partyToDoc(party);

    // Fetch the existing MongoDB document to compare arrays before overwriting
    const existingDoc = await Party.findOne({ code: party.code }).lean();
    const safeUpdate = { ...doc };

    if (existingDoc) {
      // Protect trackHistory: never overwrite with an empty array if MongoDB has data
      if ((!doc.trackHistory || doc.trackHistory.length === 0) && existingDoc.trackHistory?.length > 0) {
        delete safeUpdate.trackHistory;
        console.log(`[${party.code}] 🛡️ Flush: preserved ${existingDoc.trackHistory.length} tracks from DB (RAM was empty)`);
      }
      // Protect participants: never overwrite with an empty/host-only array if MongoDB has more
      const ramGuests = (doc.participants || []).filter(p => !p.isHost).length;
      const dbGuests  = (existingDoc.participants || []).filter(p => !p.isHost).length;
      if (ramGuests === 0 && dbGuests > 0) {
        delete safeUpdate.participants;
        console.log(`[${party.code}] 🛡️ Flush: preserved ${dbGuests} guest participants from DB (RAM had none)`);
      }
    }

    await Party.findOneAndUpdate(
      { code: party.code },
      { $set: safeUpdate },
      { upsert: true, new: true }
    );
    party.isDirty = false;
    party.lastFlushed = Date.now();
  } catch (err) {
    console.error(`❌ [${party.code}] Flush failed:`, err.message);
  }
}

// ─── Flush all dirty parties ────────────────────────────────────────
async function flushAll(parties) {
  if (!connected) return;
  const now = Date.now();
  const promises = [];
  for (const party of parties.values()) {
    if (party.isDirty && (now - party.lastFlushed) > FLUSH_INTERVAL) {
      promises.push(flushParty(party));
    }
  }
  if (promises.length > 0) {
    await Promise.allSettled(promises);
    console.log(`💾 Flushed ${promises.length} parties to MongoDB`);
  }
}

// ─── Flush on end party (immediate) ─────────────────────────────────
export async function flushEndedParty(party) {
  if (!connected) return;
  party.endedAt = new Date();
  party.isDirty = true;
  await flushParty(party);
  console.log(`💾 [${party.code}] Final flush (ended)`);

  // Save guest sessions
  try {
    const guests = party.participants.filter(p => !p.isHost);
    const sessions = guests.map(g => ({
      partyCode: party.code,
      guestName: g.name,
      guestEmoji: g.emoji,
      guestPhoto: g.photo || null,
      phone: g.phone || '',
      email: g.email || '',
      instagram: g.instagram || '',
      joinedAt: g.joinedAt ? new Date(g.joinedAt) : new Date(),
      leftAt: new Date(),
      totalScore: party.participantScores[g.name]?.score || 0
    }));
    if (sessions.length > 0) {
      await GuestSession.insertMany(sessions, { ordered: false }).catch(() => {});
      console.log(`💾 [${party.code}] Saved ${sessions.length} guest sessions`);
    }
  } catch (err) {
    console.error(`❌ [${party.code}] Guest session save failed:`, err.message);
  }
}

// ─── Start flush loop ───────────────────────────────────────────────
export function startFlushLoop(parties) {
  if (!connected) return;
  flushTimer = setInterval(() => flushAll(parties), FLUSH_INTERVAL);
  console.log(`🔄 Flush loop started (every ${FLUSH_INTERVAL / 1000}s)`);
}

// ─── Stop flush loop (graceful shutdown) ────────────────────────────
export async function stopFlushLoop(parties) {
  if (flushTimer) clearInterval(flushTimer);
  if (!connected) return;
  // Force flush all dirty parties
  const promises = [];
  for (const party of parties.values()) {
    if (party.isDirty) promises.push(flushParty(party));
  }
  if (promises.length > 0) {
    await Promise.allSettled(promises);
    console.log(`💾 Graceful shutdown: flushed ${promises.length} parties`);
  }
  await mongoose.disconnect();
}

// ─── Restore active parties from MongoDB ────────────────────────────
export async function restoreParties(parties) {
  if (!connected) return 0;
  try {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD);
    const docs = await Party.find({
      endedAt: null,
      createdAt: { $gt: cutoff }
    });
    for (const doc of docs) {
      const party = docToPartyState(doc);
      parties.set(party.code, party);
    }
    if (docs.length > 0) {
      console.log(`🔄 Restored ${docs.length} active parties from MongoDB`);
    }
    return docs.length;
  } catch (err) {
    console.error('❌ Party restoration failed:', err.message);
    return 0;
  }
}

export { flushParty };
export { Party };
