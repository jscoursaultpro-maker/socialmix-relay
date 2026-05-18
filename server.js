import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { networkInterfaces } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createPartyState, isValidPartyCode } from './partyState.js';
import { connectDB, restoreParties, startFlushLoop, stopFlushLoop, flushEndedParty } from './db.js';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import Friendship from './models/Friendship.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3069;

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 10e6,
  pingTimeout: 120000,     // 2 min — tolerate iOS background/network hiccups
  pingInterval: 25000,     // 25s — keep-alive heartbeat
  connectTimeout: 30000,   // 30s — connection handshake timeout
  allowEIO3: false         // EIO4 only (matches iOS client)
});

// ─── Multi-Party State ──────────────────────────────────────────────
const parties = new Map();           // code → PartyState
const partyCleanupTimers = new Map(); // code → setTimeout ID

function markDirty(party) { if (party) party.isDirty = true; }

function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === 'IPv4' && !net.internal) return net.address;
  return 'localhost';
}

// ─── Static files ───────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

// ─── Health check ───────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const codes = [...parties.keys()];
  const total = codes.reduce((s, c) => s + parties.get(c).participants.length, 0);
  res.json({ status: 'Social Mix Relay Server 🎧', activeParties: codes.length, codes, totalParticipants: total });
});
app.get('/status', (req, res) => {
  const codes = [...parties.keys()];
  const mongoState = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
  res.json({
    status: 'Social Mix Relay Server 🎧',
    version: 'v15-parity',
    activeParties: codes.length,
    codes,
    uptime: Math.floor(process.uptime()) + 's',
    mongo: mongoState,
    mongoURI: process.env.MONGO_URI ? '✅ configured' : '❌ not set'
  });
});

// ─── Deezer Proxy ───────────────────────────────────────────────────
app.get('/api/deezer/search', async (req, res) => {
  const q = req.query.q || '', limit = req.query.limit || 6;
  try { const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}&order=RANKING`); res.json(await r.json()); }
  catch (err) { console.error('[Deezer] Search error:', err.message); res.status(500).json({ error: 'Deezer search failed' }); }
});
app.get('/api/deezer/chart', async (req, res) => {
  const limit = req.query.limit || 8;
  try { const r = await fetch(`https://api.deezer.com/chart/0/tracks?limit=${limit}`); res.json(await r.json()); }
  catch (err) { console.error('[Deezer] Chart error:', err.message); res.status(500).json({ error: 'Deezer chart failed' }); }
});

app.get('/api/state', (req, res) => {
  const code = req.query.code;
  if (code && parties.has(code)) return res.json(parties.get(code));
  // Legacy: return first party or empty
  const first = parties.values().next().value;
  res.json(first || { code: null, participants: [] });
});

// ─── Auth Middleware (session token) ────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'Missing session token' });
  
  for (const [code, party] of parties) {
    const participant = party.participants.find(p => p.sessionToken === token);
    if (participant) {
      req.userId = participant.userId || participant.id;
      req.guestName = participant.name;
      req.partyCode = code;
      req.sessionToken = token;
      return next();
    }
  }
  return res.status(401).json({ error: 'Invalid or expired session token' });
}

// ─── Push Notification Stubs (Phase 2) ──────────────────────────────
function notifyFriendRequest(targetUserId, fromName) {
  console.log(`[Push] 📩 ${fromName} t'a ajouté en ami (target: ${targetUserId})`);
}
function notifyFriendAccepted(requesterId, acceptedByName) {
  console.log(`[Push] ✅ ${acceptedByName} a accepté ta demande (requester: ${requesterId})`);
}

// ─── Friends API ────────────────────────────────────────────────────

// In-memory friendship store (works without MongoDB)
const friendships = [];
let friendshipIdCounter = 1;

function genFriendId() { return 'fr_' + (friendshipIdCounter++) + '_' + Date.now().toString(36); }

// POST /api/friends/request — Send a friend request
app.post('/api/friends/request', authMiddleware, (req, res) => {
  const { targetUserId, partyCode } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
  if (targetUserId === req.userId) return res.status(400).json({ error: 'Cannot friend yourself' });
  
  const [userA, userB] = [req.userId, targetUserId].sort();
  
  const existing = friendships.find(f => f.userA === userA && f.userB === userB);
  if (existing) {
    if (existing.status === 'declined') {
      existing.status = 'pending';
      existing.requestedBy = req.userId;
      existing.createdAt = new Date().toISOString();
      existing.acceptedAt = null;
      notifyFriendRequest(targetUserId, req.guestName);
      return res.json({ ok: true, friendship: existing, reactivated: true });
    }
    return res.status(409).json({ error: 'Friendship already exists', status: existing.status });
  }
  
  const friendship = {
    _id: genFriendId(),
    userA, userB,
    status: 'pending',
    requestedBy: req.userId,
    metAt: partyCode || req.partyCode || null,
    createdAt: new Date().toISOString(),
    acceptedAt: null
  };
  friendships.push(friendship);
  
  // Async persist to MongoDB if available
  Friendship.create(friendship).catch(() => {});
  
  notifyFriendRequest(targetUserId, req.guestName);
  console.log(`👥 [Friends] ${req.guestName} → request → ${targetUserId}`);
  res.json({ ok: true, friendship });
});

// POST /api/friends/accept — Accept a friend request
app.post('/api/friends/accept', authMiddleware, (req, res) => {
  const { friendshipId } = req.body;
  if (!friendshipId) return res.status(400).json({ error: 'friendshipId required' });
  
  const friendship = friendships.find(f => f._id === friendshipId);
  if (!friendship) return res.status(404).json({ error: 'Friendship not found' });
  
  if (friendship.requestedBy === req.userId) {
    return res.status(403).json({ error: 'Cannot accept your own request' });
  }
  if (friendship.userA !== req.userId && friendship.userB !== req.userId) {
    return res.status(403).json({ error: 'Not your friendship' });
  }
  
  friendship.status = 'accepted';
  friendship.acceptedAt = new Date().toISOString();
  
  Friendship.findOneAndUpdate(
    { userA: friendship.userA, userB: friendship.userB },
    { status: 'accepted', acceptedAt: friendship.acceptedAt }
  ).catch(() => {});
  
  notifyFriendAccepted(friendship.requestedBy, req.guestName);
  console.log(`👥 [Friends] ${req.guestName} accepted friendship ${friendshipId}`);
  res.json({ ok: true, friendship });
});

// POST /api/friends/decline — Decline a friend request
app.post('/api/friends/decline', authMiddleware, (req, res) => {
  const { friendshipId } = req.body;
  if (!friendshipId) return res.status(400).json({ error: 'friendshipId required' });
  
  const friendship = friendships.find(f => f._id === friendshipId);
  if (!friendship) return res.status(404).json({ error: 'Friendship not found' });
  if (friendship.userA !== req.userId && friendship.userB !== req.userId) {
    return res.status(403).json({ error: 'Not your friendship' });
  }
  
  friendship.status = 'declined';
  
  Friendship.findOneAndUpdate(
    { userA: friendship.userA, userB: friendship.userB },
    { status: 'declined' }
  ).catch(() => {});
  
  console.log(`👥 [Friends] ${req.guestName} declined friendship ${friendshipId}`);
  res.json({ ok: true });
});

// GET /api/friends/list — My accepted friends
app.get('/api/friends/list', authMiddleware, (req, res) => {
  const friends = friendships.filter(f =>
    (f.userA === req.userId || f.userB === req.userId) && f.status === 'accepted'
  );
  
  const enriched = friends.map(f => {
    const friendUserId = f.userA === req.userId ? f.userB : f.userA;
    const profile = findUserProfile(friendUserId);
    return {
      _id: f._id,
      friendUserId,
      friendName: profile?.name || 'Unknown',
      friendEmoji: profile?.emoji || '🎉',
      friendPhoto: profile?.photo || null,
      metAt: f.metAt,
      acceptedAt: f.acceptedAt,
      createdAt: f.createdAt
    };
  });
  
  res.json({ ok: true, friends: enriched });
});

// GET /api/friends/pending — Received friend requests
app.get('/api/friends/pending', authMiddleware, (req, res) => {
  const pending = friendships.filter(f =>
    (f.userA === req.userId || f.userB === req.userId) &&
    f.status === 'pending' &&
    f.requestedBy !== req.userId
  );
  
  const enriched = pending.map(f => {
    const profile = findUserProfile(f.requestedBy);
    return {
      _id: f._id,
      fromUserId: f.requestedBy,
      fromName: profile?.name || 'Unknown',
      fromEmoji: profile?.emoji || '🎉',
      fromPhoto: profile?.photo || null,
      metAt: f.metAt,
      createdAt: f.createdAt
    };
  });
  
  res.json({ ok: true, pending: enriched });
});

// DELETE /api/friends/:id — Remove a friendship
app.delete('/api/friends/:id', authMiddleware, (req, res) => {
  const idx = friendships.findIndex(f => f._id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Friendship not found' });
  
  const friendship = friendships[idx];
  if (friendship.userA !== req.userId && friendship.userB !== req.userId) {
    return res.status(403).json({ error: 'Not your friendship' });
  }
  
  friendships.splice(idx, 1);
  
  Friendship.findOneAndDelete(
    { userA: friendship.userA, userB: friendship.userB }
  ).catch(() => {});
  
  console.log(`👥 [Friends] ${req.guestName} removed friendship ${req.params.id}`);
  res.json({ ok: true });
});

// Helper: find user profile from active parties
function findUserProfile(userId) {
  for (const party of parties.values()) {
    const p = party.participants.find(p => p.userId === userId || p.id === userId);
    if (p) return { name: p.name, emoji: p.emoji, photo: p.photo };
  }
  return null;
}


// ─── Helpers (party-scoped) ─────────────────────────────────────────
function addPhotoToParty(party, photo) {
  const url = photo.dataURL || '';
  const mid = Math.floor(url.length / 2);
  const hash = url.length + ':' + url.substring(mid, mid + 80);
  if (party.photoHashes.has(hash)) return false;
  party.photoHashes.add(hash);
  party.photos.push(photo);
  return true;
}

function addPoints(party, participantId, name, points, reason) {
  // Use normalized name as stable key (participantId changes between reconnections)
  const normalizedName = (name || participantId || 'Guest').trim();
  let key;
  if (participantId === 'host') { key = 'host'; }
  else {
    // First try exact name match, then fall back to participantId match
    const byName = Object.entries(party.participantScores).find(([k]) => k === normalizedName);
    const byId = Object.entries(party.participantScores).find(([, v]) => v.participantId === participantId);
    key = byName ? byName[0] : (byId ? byId[0] : normalizedName);
  }
  if (!party.participantScores[key]) party.participantScores[key] = { name: normalizedName, score: 0, voteCount: 0, participantId: participantId || key };
  party.participantScores[key].score += points;
  if (name && name !== 'DJ' && name !== 'Guest') party.participantScores[key].name = normalizedName;
  if (participantId) party.participantScores[key].participantId = participantId;
  console.log(`⭐ [${party.code}] +${points}pts → ${normalizedName} (${reason}) [total: ${party.participantScores[key].score}]`);
  broadcastLeaderboard(party);
}

function broadcastLeaderboard(party) {
  const lb = Object.values(party.participantScores)
    .map(d => ({ id: d.participantId === 'host' ? 'host' : d.name, name: d.name, points: d.score }))
    .sort((a, b) => b.points - a.points);
  party.leaderboard = lb;
  io.to(`guest:${party.code}`).emit('leaderboard:update', lb);
  io.to(`host:${party.code}`).emit('leaderboard:update', lb);
}

function recomputeGenreVotes(party) {
  const totals = {};
  if (party.guestGenreVotes) Object.values(party.guestGenreVotes).forEach(g => { totals[g] = (totals[g] || 0) + 1; });
  party.genreVotes = totals;
  return totals;
}

function getParty(socket) {
  return socket.partyCode ? parties.get(socket.partyCode) : null;
}

function getMutableParty(socket) {
  const party = getParty(socket);
  if (party) party.isDirty = true;
  return party;
}

function cancelCleanup(code) {
  if (partyCleanupTimers.has(code)) { clearTimeout(partyCleanupTimers.get(code)); partyCleanupTimers.delete(code); }
}

// ─── Host Secret Auth ───────────────────────────────────────────────
const hostSecretFailures = new Map(); // socketId → { count, blockedUntil }

function validateHostSecret(socket, data) {
  const socketId = socket.id;
  const party = getParty(socket);
  if (!party) return false;
  
  // Check rate limit — blocked?
  const failure = hostSecretFailures.get(socketId);
  if (failure && failure.blockedUntil && Date.now() < failure.blockedUntil) {
    const remaining = Math.ceil((failure.blockedUntil - Date.now()) / 1000);
    console.warn(`🔒 [${party.code}] Socket ${socketId} blocked for ${remaining}s more`);
    return false;
  }
  
  // Extract secret from payload
  const secret = (typeof data === 'object' && data !== null) ? data.hostSecret : undefined;
  
  if (!secret || secret !== party.hostSecret) {
    // Increment failure count
    const current = hostSecretFailures.get(socketId) || { count: 0 };
    current.count++;
    const lastFour = party.hostSecret ? party.hostSecret.slice(-4) : '????';
    console.warn(`🔒 [${party.code}] Invalid host secret attempt ${current.count}/5 from ${socketId} (expected: ****${lastFour})`);
    
    if (current.count >= 5) {
      current.blockedUntil = Date.now() + 5 * 60 * 1000; // 5 min
      hostSecretFailures.set(socketId, current);
      console.warn(`🔒 [${party.code}] Socket ${socketId} BLOCKED for 5 min after 5 failed attempts`);
      socket.emit('auth:error', { error: 'HOST_AUTH_BLOCKED', message: 'Trop de tentatives. Déconnexion 5 min.' });
      socket.disconnect(true);
      return false;
    }
    hostSecretFailures.set(socketId, current);
    socket.emit('auth:error', { error: 'HOST_AUTH_FAILED', message: 'Secret hôte invalide.' });
    return false;
  }
  
  // Valid — reset failure counter
  hostSecretFailures.delete(socketId);
  return true;
}


// Strip hostSecret from payload before broadcasting to guests
function stripSecret(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  const { hostSecret, ...clean } = obj;
  return clean;
}

// Build a lightweight party:state payload for WebSocket sync.
// CRITICAL: Photos in base64 can push the payload to >1MB, which exceeds
// the iOS URLSessionWebSocketTask default limit (1MB) and causes silent
// message drops → host never receives state → all sync breaks.
//
// This function:
// 1. Replaces photos[] with photosMeta[] (guestName + timestamp only, no base64)
// 2. Caps trackHistory to the last 20 entries
// 3. Strips participants' profile photos (keep just name, emoji, id)
// 4. Removes internal server fields
function buildLightState(party) {
  // Lightweight participants
  const lightParticipants = (party.participants || []).map(p => ({
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    isHost: p.isHost || false,
    connected: p.connected !== false,
    partyCode: p.partyCode,
    joinedAt: p.joinedAt,
    photo: p.photo
  }));

  // Cap track history to last 20
  const recentHistory = (party.trackHistory || []).slice(-20);

  const light = {
    code: party.code,
    participants: lightParticipants,
    suggestions: party.suggestions || [],
    trackHistory: recentHistory,
    currentTrack: party.currentTrack || null,
    genreVotes: party.genreVotes || {},
    guestGenreVotes: party.guestGenreVotes || {},
    guestVotes: party.guestVotes || {},
    costumeEntries: party.costumeEntries || [],
    leaderboard: party.leaderboard || [],
    hostProfile: party.hostProfile || null,
    // Send all photos directly since they are Cloudinary URLs
    photos: party.photos || [],
    photosCount: (party.photos || []).length
  };

  const sizeKB = Math.round(JSON.stringify(light).length / 1024);
  console.log(`📦 [${party.code}] buildLightState: ${sizeKB} KB (${lightParticipants.length} participants, ${(party.photos || []).length} photos, ${recentHistory.length} tracks, ${(party.suggestions || []).length} suggestions)`);

  return light;
}



// ─── Socket.IO Connection Handling ──────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  // Auto-join host room: if ANY host: prefixed event is received,
  // ensure this socket is in the 'host' room (resilient to server restarts)
  function ensureHostRoom() {
    if (!socket.rooms.has('host')) {
      socket.join('host');
      console.log(`🏠 Auto-joined socket ${socket.id} to host room`);
    }
  }

  // Intercept all host: events to auto-join room + validate hostSecret
  const origOn = socket.on.bind(socket);
  socket.on = function(event, handler) {
    if (event.startsWith('host:')) {
      return origOn(event, (...args) => {
        ensureHostRoom();
        // host:startParty sets the secret — skip validation
        if (event === 'host:startParty') {
          handler(...args);
          return;
        }
        // All other host:* events require valid hostSecret
        const payload = args[0];
        if (!validateHostSecret(socket, payload)) return;
        handler(...args);
      });
    }
    return origOn(event, handler);
  };

  // ═══════════════════════════════════════════════════════════════════
  // HOST EVENTS
  // ═══════════════════════════════════════════════════════════════════

  socket.on('host:startParty', (data) => {
    const code = (data.code || 'TEUF2025').toUpperCase();
    socket.partyCode = code;
    socket.join(`host:${code}`);
    cancelCleanup(code);

    const existing = parties.get(code);
    const hostName = data.profile?.name || 'Hôte';
    const hostEmoji = data.profile?.emoji || '🎧';

    // ── RESUME existing party if hostSecret matches ──
    if (existing && existing.hostSecret && data.hostSecret === existing.hostSecret) {
      existing.hostSocketId = socket.id;
      existing.hostProfile = data.profile || existing.hostProfile;
      existing.isDirty = true;

      // Update host participant entry with new socket id
      const hostIdx = existing.participants.findIndex(p => p.isHost);
      if (hostIdx >= 0) {
        existing.participants[hostIdx].id = socket.id;
        existing.participants[hostIdx].connected = true;
      } else {
        existing.participants.unshift({
          id: socket.id, name: hostName, emoji: hostEmoji,
          photo: data.profile?.photo || null,
          phone: data.profile?.phone || '', email: data.profile?.email || '', instagram: data.profile?.instagram || '',
          partyCode: code, joinedAt: new Date().toISOString(), isHost: true, connected: true
        });
      }

      const lastFour = existing.hostSecret.slice(-4);
      const guestCount = existing.participants.filter(p => !p.isHost).length;
      console.log(`🔄 Party RESUMED: ${code} (host: "${hostName}", secret: ****${lastFour}, guests: ${guestCount}, tracks: ${existing.trackHistory.length})`);

      // Re-send lightweight state to host (no base64 photos)
      socket.emit('party:state', buildLightState(existing));

      // Notify guests the host is back
      io.to(`guest:${code}`).emit('party:started', { code, profile: existing.hostProfile });
      io.to(`guest:${code}`).emit('participants:update', existing.participants);
      return;
    }

    // ── NEW party (no existing or secret mismatch) ──
    const party = createPartyState(code);
    party.hostSocketId = socket.id;
    party.hostProfile = data.profile || null;
    parties.set(code, party);

    // Store host secret (never broadcast to guests)
    party.hostSecret = data.hostSecret || null;
    const lastFour = party.hostSecret ? party.hostSecret.slice(-4) : 'NONE';
    
    // Build host participant
    party.participants.unshift({
      id: socket.id, name: hostName, emoji: hostEmoji,
      photo: data.profile?.photo || null,
      phone: data.profile?.phone || '', email: data.profile?.email || '', instagram: data.profile?.instagram || '',
      partyCode: code, joinedAt: new Date().toISOString(), isHost: true
    });

    console.log(`🎉 Party started: ${code} (host: "${hostName}", secret: ****${lastFour}, active parties: ${parties.size})`);
    // Never send hostSecret to guests — only party:started with public data
    io.to(`guest:${code}`).emit('party:started', { code, profile: party.hostProfile });
    io.to(`guest:${code}`).emit('participants:update', party.participants);
  });

  socket.on('host:trackUpdate', (track) => {
    const party = getMutableParty(socket); if (!party) return;
    party.currentTrack = track;
    if (track && (!party.trackHistory.length || party.trackHistory[0]?.title !== track.title)) {
      party.trackHistory.unshift({ ...track, playedAt: new Date().toISOString() });
      addPoints(party, 'host', 'DJ', 15, 'nouveau titre : ' + track.title);
    }
    io.to(`guest:${party.code}`).emit('track:update', stripSecret(track));
    console.log(`🎵 [${party.code}] Track: ${track?.title} — ${track?.artist}`);
  });

  socket.on('host:modeChange', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    party.mode = data.mode;
    io.to(`guest:${party.code}`).emit('mode:change', stripSecret(data));
    console.log(`🎛️ [${party.code}] Mode: ${data.mode}`);
  });

  socket.on('host:genreVote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const genre = data.genre;
    if (genre) {
      if (!party.guestGenreVotes['__HOST__']) addPoints(party, 'host', data.guestName || 'DJ', 15, 'genre vote');
      party.guestGenreVotes['__HOST__'] = genre;
    } else { delete party.guestGenreVotes['__HOST__']; }
    const totals = recomputeGenreVotes(party);
    io.to(`guest:${party.code}`).emit('votes:update', { genreVotes: totals });
    io.to(`host:${party.code}`).emit('votes:update', { genreVotes: totals });
  });

  socket.on('host:costumeVote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const voterId = 'host', targetId = data.targetId;
    if (party.costumeVoters[voterId] === targetId) return;
    if (party.costumeVoters[voterId]) {
      const old = party.costumeEntries.find(e => e.guestId === party.costumeVoters[voterId]);
      if (old) old.votes = Math.max(0, (old.votes || 0) - 1);
    }
    party.costumeVoters[voterId] = targetId;
    const entry = party.costumeEntries.find(e => e.guestId === targetId);
    if (entry) entry.votes = (entry.votes || 0) + 1;
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
  });

  socket.on('host:costumePhoto', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const entry = party.costumeEntries.find(e => e.guestId === 'host');
    if (entry) entry.photo = data.photo;
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
    const photo = { dataURL: data.photo, guestName: entry?.guestName || 'Host', sentAt: new Date().toISOString() };
    if (addPhotoToParty(party, photo)) {
      io.to(`guest:${party.code}`).emit('photo:shared', photo);
    }
  });

  socket.on('host:voteResults', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    party.vibeScore = data.vibeScore || 0;
  });

  socket.on('host:trackHistory', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    // Build vote counts from guest votes
    const trackVotes = {};
    for (const gId in party.guestVotes) {
      const votes = party.guestVotes[gId];
      for (const tId in votes) {
        if (!trackVotes[tId]) trackVotes[tId] = { fire: 0, like: 0, meh: 0 };
        const t = votes[tId];
        if (t === 'fire') trackVotes[tId].fire++;
        else if (t === 'like') trackVotes[tId].like++;
        else if (t === 'meh') trackVotes[tId].meh++;
      }
    }
    // Enrich the SERVER's own trackHistory with vote counts (don't replace it)
    const enriched = party.trackHistory.map(t => ({
      ...t,
      fireCount: trackVotes[t.title]?.fire || 0,
      likeCount: trackVotes[t.title]?.like || 0,
      mehCount: trackVotes[t.title]?.meh || 0
    }));
    party.trackHistory = enriched;
    io.to(`guest:${party.code}`).emit('history:update', enriched);
  });

  socket.on('host:nextTrack', (track) => {
    const party = getMutableParty(socket); if (!party) return;
    party.nextTrack = track;
    io.to(`guest:${party.code}`).emit('nextTrack:update', stripSecret(track));
  });

  // ═══════════════════════════════════════════════════════════════════
  // GUEST EVENTS
  // ═══════════════════════════════════════════════════════════════════

  socket.on('guest:join', (data) => {
    const code = (data.partyCode || '').toUpperCase();
    const party = parties.get(code);
    if (!party) {
      socket.emit('party:wrongCode', { message: 'Aucune soirée active. Le DJ doit lancer la soirée depuis l\'app.' });
      return;
    }
    socket.partyCode = code;
    socket.join(`guest:${code}`);
    cancelCleanup(code);

    // Generate session token for reconnection
    const sessionToken = randomUUID();
    const guestName = data.name || 'Guest';

    // Cancel any pending disconnect timer for this guest
    if (party.disconnectTimers[guestName]) {
      clearTimeout(party.disconnectTimers[guestName]);
      delete party.disconnectTimers[guestName];
    }

    // Generate or reuse stable userId
    const userId = data.userId || 'user_' + randomUUID().replace(/-/g, '').substring(0, 16);

    const guest = {
      id: socket.id, userId, name: guestName, emoji: data.emoji || '🎉',
      photo: data.photo || null, phone: data.phone || '', email: data.email || '', instagram: data.instagram || '',
      partyCode: code, joinedAt: new Date().toISOString(),
      consentVersion: data.consentVersion || '1.0',
      consentTimestamp: data.consentTimestamp || Date.now(),
      sessionToken, connected: true
    };
    // Remove any existing entry with same name OR same userId (prevents duplicates on reconnect)
    // IMPORTANT: Never remove the host entry even if name matches
    party.participants = party.participants.filter(p => {
      if (p.isHost) return true;  // Never remove the host
      if (p.name === guest.name) return false;   // Same name → remove old guest
      if (userId && p.userId === userId) return false; // Same userId → remove old
      return true;  // Keep everyone else
    });
    party.participants.push(guest);
    party.sessionTokens[sessionToken] = guestName;
    party.isDirty = true;
    recomputeGenreVotes(party);
    socket.emit('party:state', buildLightState(party));
    // Send session token + userId separately (client stores them)
    socket.emit('session:token', { sessionToken, partyCode: code, userId });
    io.to(`host:${code}`).emit('guest:joined', guest);
    io.to(`guest:${code}`).emit('participants:update', party.participants);
    if (guest.name && guest.name !== 'Guest') {
      if (!party.profilePointsGiven.has(guest.name)) {
        party.profilePointsGiven.add(guest.name);
        addPoints(party, socket.id, guest.name, 25, 'profile complete');
      }
    }
    console.log(`👤 [${code}] Guest joined: ${guest.emoji} ${guest.name} (token: ${sessionToken.substring(0, 8)}...) — Total participants: ${party.participants.length}`)
    console.log(`👤 [${code}] Participant list: ${party.participants.map(p => `${p.name}${p.isHost ? ' [HOST]' : ''}`).join(', ')}`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // GUEST RESUME (reconnection via session token)
  // ═══════════════════════════════════════════════════════════════════

  socket.on('guest:resume', (payload, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    const code = (payload?.partyCode || '').toUpperCase();
    const token = payload?.sessionToken;

    if (!code || !token) { cb({ ok: false, reason: 'MISSING_PARAMS' }); return; }

    const party = parties.get(code);
    if (!party) { cb({ ok: false, reason: 'PARTY_NOT_FOUND' }); return; }

    const guestName = party.sessionTokens[token];
    if (!guestName) { cb({ ok: false, reason: 'INVALID_TOKEN' }); return; }

    // Find existing participant
    const participant = party.participants.find(p => p.name === guestName);
    if (!participant) { cb({ ok: false, reason: 'PARTICIPANT_GONE' }); return; }

    // Cancel disconnect timer
    if (party.disconnectTimers[guestName]) {
      clearTimeout(party.disconnectTimers[guestName]);
      delete party.disconnectTimers[guestName];
    }

    // Rebind socket
    participant.id = socket.id;
    participant.connected = true;
    socket.partyCode = code;
    socket.join(`guest:${code}`);
    cancelCleanup(code);

    // Send full state
    // Send lightweight state (no base64 photos)
    socket.emit('party:state', buildLightState(party));
    io.to(`host:${code}`).emit('guest:joined', participant);
    io.to(`guest:${code}`).emit('participants:update', party.participants);

    cb({
      ok: true,
      profile: { name: participant.name, emoji: participant.emoji, photo: participant.photo },
      partyCode: code
    });
    console.log(`🔄 [${code}] Guest resumed: ${participant.emoji} ${participant.name}`);
    

  });

  socket.on('guest:requestState', () => {
    const party = getParty(socket); if (!party) return;
    socket.emit('party:state', buildLightState(party));
  });

  socket.on('host:requestState', (data) => {
    const party = getParty(socket); if (!party) return;
    socket.emit('party:state', buildLightState(party));
    console.log(`🔄 [${party.code}] Host requested state resync`);
  });

  socket.on('guest:vote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    if (!party.guestVotes[data.guestId]) party.guestVotes[data.guestId] = {};
    party.guestVotes[data.guestId][data.trackId || 'current'] = data.type;
    io.to(`host:${party.code}`).emit('guest:voted', data);
    io.to(`guest:${party.code}`).emit('vote:received', data);
    if (data.guestId) addPoints(party, data.guestId, data.guestName || 'Guest', 10, `vote ${data.type}`);
  });

  socket.on('guest:genreVote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const voterKey = data.guestName || data.guestId || socket.id;
    const genre = data.genre;
    if (genre) {
      party.guestGenreVotes[voterKey] = genre;
      if (!party._genreVotedOnce[voterKey]) {
        party._genreVotedOnce[voterKey] = true;
        addPoints(party, data.guestId || socket.id, data.guestName || voterKey, 15, 'genre vote');
      }
    } else { delete party.guestGenreVotes[voterKey]; }
    const totals = recomputeGenreVotes(party);
    io.to(`host:${party.code}`).emit('guest:genreVoted', data);
    io.to(`guest:${party.code}`).emit('votes:update', { genreVotes: totals });
    io.to(`host:${party.code}`).emit('votes:update', { genreVotes: totals });
  });

  socket.on('guest:suggest', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const suggestion = {
      ...data,
      status: 'pending',       // pending → accepted → played / refused
      sentAt: new Date().toISOString(),
      statusUpdatedAt: null,
      socketId: socket.id       // Track originator for status feedback
    };
    party.suggestions.push(suggestion);
    const hostRoom = `host:${party.code}`;
    const hostSockets = io.sockets.adapter.rooms.get(hostRoom);
    const hostCount = hostSockets ? hostSockets.size : 0;
    io.to(hostRoom).emit('guest:suggested', suggestion);
    // Confirm receipt to the guest
    socket.emit('suggestion:status', {
      title: data.title || data.query,
      artist: data.artist || '',
      status: 'pending',
      message: '💡 Suggestion envoyée à l\'organisateur'
    });
    console.log(`🎵 [${party.code}] SUGGEST: "${data.title || '?'}" by ${data.guestName || '?'} → host room has ${hostCount} socket(s)`);
    if (data.guestId || data.guestName) addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 5, `suggestion: ${data.title || data.query}`);
  });

  socket.on('host:suggestionPlayed', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    if (data.guestName) {
      addPoints(party, data.guestName, data.guestName, 10, `suggestion played: ${data.trackTitle || 'Unknown'}`);
      addPoints(party, 'host', 'DJ', 5, `handled suggestion: ${data.trackTitle || 'Unknown'}`);
    }
    // Update suggestion status and notify the guest
    const match = party.suggestions.find(s =>
      (s.title || '').toLowerCase() === (data.trackTitle || '').toLowerCase() &&
      s.guestName === data.guestName
    );
    if (match) {
      match.status = 'played';
      match.statusUpdatedAt = new Date().toISOString();
      // Notify the originating guest
      const guestRoom = `guest:${party.code}`;
      io.to(guestRoom).emit('suggestion:status', {
        title: match.title || match.query,
        artist: match.artist || '',
        guestName: data.guestName,
        status: 'played',
        message: `🎶 "${match.title || match.query}" joue maintenant grâce à toi ! +10 points bonus`
      });
    }
    console.log(`🎵 [${party.code}] SUGGESTION PLAYED: "${data.trackTitle}" suggested by ${data.guestName}`);
  });

  socket.on('host:acceptSuggestion', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const match = party.suggestions.find(s =>
      (s.title || '').toLowerCase() === (data.trackTitle || '').toLowerCase() &&
      (s.guestName || '') === (data.guestName || '')
    );
    if (match) {
      match.status = 'accepted';
      match.statusUpdatedAt = new Date().toISOString();
      const guestRoom = `guest:${party.code}`;
      io.to(guestRoom).emit('suggestion:status', {
        title: match.title || match.query,
        artist: match.artist || '',
        guestName: data.guestName,
        status: 'accepted',
        message: `✅ L'organisateur va jouer "${match.title || match.query}"`
      });
      console.log(`🎵 [${party.code}] SUGGESTION ACCEPTED: "${data.trackTitle}" by ${data.guestName}`);
    }
  });

  socket.on('host:rejectSuggestion', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const match = party.suggestions.find(s =>
      (s.title || '').toLowerCase() === (data.trackTitle || '').toLowerCase() &&
      (s.guestName || '') === (data.guestName || '')
    );
    if (match) {
      match.status = 'refused';
      match.statusUpdatedAt = new Date().toISOString();
      const guestRoom = `guest:${party.code}`;
      io.to(guestRoom).emit('suggestion:status', {
        title: match.title || match.query,
        artist: match.artist || '',
        guestName: data.guestName,
        status: 'refused',
        message: `❌ Suggestion non retenue cette fois`
      });
      console.log(`🎵 [${party.code}] SUGGESTION REFUSED: "${data.trackTitle}" by ${data.guestName}`);
    }
  });

  socket.on('guest:photo', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    
    // Payload size guard — reject > 500KB base64 (~375KB raw)
    const payloadSize = (data.dataURL || '').length;
    if (payloadSize > 500 * 1024) {
      console.warn(`📸 [${party.code}] Photo REJECTED: ${Math.round(payloadSize/1024)} KB from ${data.guestName} (cap: 500KB)`);
      socket.emit('photo:error', { error: 'PHOTO_TOO_LARGE', message: '📸 Photo trop volumineuse même après compression. Essayez une photo plus simple.' });
      return;
    }
    
    // Per-guest photo cap (costume photos excluded)
    const GUEST_PHOTO_CAP = 15;
    const guestPhotoCount = party.photos.filter(p => p.guestName === data.guestName && !p.isCostume).length;
    if (guestPhotoCount >= GUEST_PHOTO_CAP) {
      console.warn(`📸 [${party.code}] Photo cap reached for ${data.guestName} (${guestPhotoCount}/${GUEST_PHOTO_CAP})`);
      socket.emit('photo:error', { error: 'PHOTO_LIMIT', message: '📷 Limite atteinte ! Tu as déjà ' + GUEST_PHOTO_CAP + ' photos.' });
      return;
    }
    
    const photo = { dataURL: data.dataURL, guestName: data.guestName || 'Guest', caption: data.caption || null, sentAt: new Date().toISOString() };
    if (!addPhotoToParty(party, photo)) return;
    const hostRoom = `host:${party.code}`;
    const hostSockets = io.sockets.adapter.rooms.get(hostRoom);
    socket.broadcast.to(`guest:${party.code}`).emit('photo:shared', photo);
    io.to(hostRoom).emit('guest:photo', photo);
    addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 20, 'photo');
    console.log(`📸 [${party.code}] Photo ACCEPTED: ${data.guestName} (${guestPhotoCount + 1}/${GUEST_PHOTO_CAP}, ${Math.round(payloadSize/1024)} KB, host sockets: ${hostSockets ? hostSockets.size : 0})`);
  });

  socket.on('guest:message', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const msg = { guestName: data.guestName || 'Guest', message: data.message || '', guestPhoto: data.guestPhoto || null, guestEmoji: data.guestEmoji || '🎉' };
    io.to(`host:${party.code}`).emit('guest:message', msg);
    addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 10, 'message');
  });

  socket.on('host:message', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const msg = { guestName: data.guestName || 'DJ', message: data.message || '', guestEmoji: data.guestEmoji || '🎧' };
    io.to(`guest:${party.code}`).emit('guest:message', msg);
    addPoints(party, 'host', data.guestName || 'DJ', 10, 'message');
  });

  socket.on('host:photo', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const photo = { dataURL: data.dataURL, guestName: data.guestName || 'Host', sentAt: new Date().toISOString() };
    if (!addPhotoToParty(party, photo)) return;
    io.to(`guest:${party.code}`).emit('photo:shared', photo);
    addPoints(party, 'host', data.guestName || 'DJ', 20, 'photo');
  });

  // ═══════════════════════════════════════════════════════════════════
  // COSTUME CONTEST
  // ═══════════════════════════════════════════════════════════════════

  socket.on('costume:enter', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    party.costumeEntries = party.costumeEntries.filter(e => e.guestId !== data.guestId && e.guestName !== data.guestName);
    party.costumeEntries.push({ guestId: data.guestId || socket.id, guestName: data.guestName || 'Guest', emoji: data.emoji || '🎭', photo: data.photo, votes: 0 });
    if (data.guestId === 'host' && data.guestName && data.guestName !== 'DJ') {
      const hostP = party.participants.find(p => p.isHost);
      if (hostP) { hostP.name = data.guestName; io.to(`guest:${party.code}`).emit('participants:update', party.participants); }
    }
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
    addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 30, 'costume entry');
  });

  socket.on('costume:vote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    if (!party.costumeOpen) return;
    const voterId = data.voterId || socket.id, targetId = data.targetId;
    if (party.costumeVoters[voterId] === targetId) return;
    if (party.costumeVoters[voterId]) {
      const old = party.costumeEntries.find(e => e.guestId === party.costumeVoters[voterId]);
      if (old) old.votes = Math.max(0, (old.votes || 0) - 1);
    }
    party.costumeVoters[voterId] = targetId;
    const entry = party.costumeEntries.find(e => e.guestId === targetId);
    if (entry) entry.votes = (entry.votes || 0) + 1;
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
  });

  socket.on('costume:unvote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const voterId = data.voterId || socket.id;
    if (party.costumeVoters[voterId] !== data.targetId) return;
    delete party.costumeVoters[voterId];
    const entry = party.costumeEntries.find(e => e.guestId === data.targetId);
    if (entry) entry.votes = Math.max(0, (entry.votes || 0) - 1);
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
  });

  socket.on('costume:photo', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const entry = party.costumeEntries.find(e => e.guestId === data.guestId);
    if (entry) entry.photo = data.photo;
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
    if (data.photo) {
      const photo = { dataURL: data.photo, guestName: entry?.guestName || 'Guest', sentAt: new Date().toISOString(), isCostume: true };
      if (addPhotoToParty(party, photo)) {
        io.to(`host:${party.code}`).emit('guest:photo', photo);
        socket.broadcast.to(`guest:${party.code}`).emit('photo:shared', photo);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // MISSIONS & POINTS
  // ═══════════════════════════════════════════════════════════════════

  socket.on('mission:complete', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const pts = data.points || 0;
    if (pts > 0) addPoints(party, data.participantId || data.guestId || socket.id, data.name || 'Guest', pts, `mission: ${data.mission || 'unknown'}`);
  });

  socket.on('costume:winner', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const winnerId = data.guestId || data.winnerId;
    if (winnerId) addPoints(party, winnerId, data.guestName || data.winnerName || 'Winner', 150, 'costume winner 🏆');
  });

  // ═══════════════════════════════════════════════════════════════════
  // HOST CLOSES COSTUME CONTEST
  // ═══════════════════════════════════════════════════════════════════
  socket.on('host:closeCostume', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    if (!party.costumeOpen) return;
    party.costumeOpen = false;
    const entries = party.costumeEntries || [];
    const sorted = [...entries].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const winner = sorted.length > 0 && sorted[0].votes > 0 ? sorted[0] : null;
    if (winner) addPoints(party, winner.guestId, winner.guestName, 150, 'costume winner 🏆');
    const podium = sorted.slice(0, 3).map((e, i) => ({ rank: i + 1, guestId: e.guestId, guestName: e.guestName, emoji: e.emoji, votes: e.votes || 0, photo: e.photo || null }));
    const closedData = {
      winner: winner ? { guestId: winner.guestId, guestName: winner.guestName, emoji: winner.emoji, votes: winner.votes || 0, photo: winner.photo || null } : null,
      podium, totalEntries: entries.length
    };
    io.to(`guest:${party.code}`).emit('costume:closed', closedData);
    io.to(`host:${party.code}`).emit('costume:closed', closedData);
    console.log(`🎭🏆 [${party.code}] Costume CLOSED! Winner: ${winner?.guestName || 'None'}`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // HOST VOTE
  // ═══════════════════════════════════════════════════════════════════

  socket.on('host:vote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const trackTitle = data.trackTitle || party.currentTrack?.title || 'Titre en cours';
    const { hostSecret: _hs, ...cleanData } = data;
    const voteData = { ...cleanData, trackTitle, trackId: trackTitle };
    io.to(`guest:${party.code}`).emit('vote:received', voteData);
    if (!party.guestVotes['host']) party.guestVotes['host'] = {};
    party.guestVotes['host'][trackTitle] = data.type;
    addPoints(party, 'host', data.guestName || 'DJ', 10, `vote ${data.type}`);
    const vibeMap = { meh: -1, like: 1, fire: 3 };
    party.vibeScore = Math.max(0, party.vibeScore + (vibeMap[data.type] || 0));
    io.to(`guest:${party.code}`).emit('votes:update', { genreVotes: party.genreVotes, vibeScore: party.vibeScore });
  });

  // ═══════════════════════════════════════════════════════════════════
  // END PARTY
  // ═══════════════════════════════════════════════════════════════════

  socket.on('host:endParty', async (data) => {
    const party = getMutableParty(socket); if (!party) return;
    io.to(`guest:${party.code}`).emit('party:ended', {
      reason: 'La soirée est terminée ! Merci d\'avoir participé 🎉',
      scores: party.participantScores, trackHistory: party.trackHistory,
      photos: party.photos, participants: party.participants
    });
    console.log(`🎉 [${party.code}] Party ended by host`);
    await flushEndedParty(party);
    parties.delete(party.code);
    cancelCleanup(party.code);
  });

  socket.on('host:deletePhoto', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const idx = data && data.index;
    if (typeof idx === 'number' && idx >= 0 && idx < party.photos.length) {
      party.photos.splice(idx, 1);
      io.to(`host:${party.code}`).emit('photos:update', party.photos);
      io.to(`guest:${party.code}`).emit('photos:update', party.photos);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // DISCONNECT
  // ═══════════════════════════════════════════════════════════════════

  socket.on('disconnect', (reason) => {
    const code = socket.partyCode;
    const party = code ? parties.get(code) : null;
    if (party) {
      const participant = party.participants.find(p => p.id === socket.id);
      const pName = participant?.name || 'unknown';
      console.log(`🔌 [${code}] DISCONNECT: ${pName} (socket: ${socket.id}, reason: ${reason})`);

      if (participant && participant.sessionToken) {
        // ── GUEST with session token: grace period (4h) ──
        participant.connected = false;
        io.to(`host:${code}`).emit('guest:disconnected', { name: participant.name, id: socket.id });

        const GRACE_MS = 6 * 60 * 60 * 1000; // 6 hours
        party.disconnectTimers[participant.name] = setTimeout(() => {
          // Final removal after grace period
          delete party.sessionTokens[participant.sessionToken];
          party.participants = party.participants.filter(p => p.name !== participant.name);
          delete party.disconnectTimers[participant.name];
          if (party.guestGenreVotes[participant.name]) {
            delete party.guestGenreVotes[participant.name];
            const totals = recomputeGenreVotes(party);
            io.to(`host:${code}`).emit('votes:update', { genreVotes: totals });
            io.to(`guest:${code}`).emit('votes:update', { genreVotes: totals });
          }
          io.to(`guest:${code}`).emit('participants:update', party.participants);
          // CR1 FIX: Send both id AND name so host can match by either
          io.to(`host:${code}`).emit('guest:left', { id: socket.id, name: participant.name });
          party.isDirty = true;
          console.log(`🗑️ [${code}] Guest ${participant.name} removed after grace period`);
        }, GRACE_MS);
        console.log(`⏸️ [${code}] Grace period started for ${participant.name}`);
      } else {
        // ── HOST or guest without token: immediate removal ──
        if (participant && party.guestGenreVotes[participant.name]) {
          delete party.guestGenreVotes[participant.name];
          const totals = recomputeGenreVotes(party);
          io.to(`host:${code}`).emit('votes:update', { genreVotes: totals });
          io.to(`guest:${code}`).emit('votes:update', { genreVotes: totals });
        }
        party.participants = party.participants.filter(p => p.id !== socket.id);
        io.to(`guest:${code}`).emit('participants:update', party.participants);
        // CR1 FIX: Send both id AND name so host can match by either
        io.to(`host:${code}`).emit('guest:left', { id: socket.id, name: pName });
        console.log(`❌ [${code}] Removed immediately: ${pName} (${socket.id})`);
      }

      // Schedule party cleanup if no sockets remain
      const hostRoom = io.sockets.adapter.rooms.get(`host:${code}`);
      const guestRoom = io.sockets.adapter.rooms.get(`guest:${code}`);
      if (!hostRoom?.size && !guestRoom?.size) {
        partyCleanupTimers.set(code, setTimeout(() => {
          parties.delete(code);
          partyCleanupTimers.delete(code);
          console.log(`🗑️ Party ${code} cleaned up (10min timeout)`);
        }, 10 * 60 * 1000));
      }
    } else {
      console.log(`❌ Disconnected: ${socket.id} (party: ${code || 'none'})`);
    }
  });
});

// ─── Boot Sequence ──────────────────────────────────────────────────
async function boot() {
  // 1. Connect to MongoDB (optional)
  await connectDB();

  // 2. Restore active parties from DB
  await restoreParties(parties);

  // 3. Start flush loop
  startFlushLoop(parties);

  // 4. Start HTTP server
  server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('');
    console.log('  🎧 ═══════════════════════════════════════════');
    console.log('  ║   SOCIAL MIX — Relay Server v14 (mongo)    ║');
    console.log('  ═══════════════════════════════════════════════');
    console.log(`  ║  Local:   http://localhost:${PORT}`);
    console.log(`  ║  Network: http://${ip}:${PORT}`);
    console.log(`  ║  Guest:   http://${ip}:${PORT} (same URL!)`);
    console.log('  ═══════════════════════════════════════════════');
    console.log('');
  });
}

// ─── Graceful Shutdown ──────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received — flushing parties...');
  await stopFlushLoop(parties);
  process.exit(0);
});
process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received — flushing parties...');
  await stopFlushLoop(parties);
  process.exit(0);
});

boot().catch(err => { console.error('Boot failed:', err); process.exit(1); });
