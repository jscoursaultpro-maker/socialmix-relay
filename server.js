import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { networkInterfaces } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createPartyState, isValidPartyCode } from './partyState.js';
import { connectDB, restoreParties, startFlushLoop, stopFlushLoop, flushEndedParty } from './db.js';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3069;

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 10e6,
  pingTimeout: 60000,
  pingInterval: 25000
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
app.use(express.static(join(__dirname, 'public')));

// ─── Health check ───────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const codes = [...parties.keys()];
  const total = codes.reduce((s, c) => s + parties.get(c).participants.length, 0);
  res.json({ status: 'Social Mix Relay Server 🎧', activeParties: codes.length, codes, totalParticipants: total });
});
app.get('/status', (req, res) => {
  const codes = [...parties.keys()];
  res.json({ status: 'Social Mix Relay Server 🎧', version: 'v14-mongo', activeParties: codes.length, codes, uptime: Math.floor(process.uptime()) + 's' });
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
  let key;
  if (participantId === 'host') { key = 'host'; }
  else {
    const existing = Object.entries(party.participantScores).find(([k, v]) => v.participantId === participantId || k === name);
    key = existing ? existing[0] : (name || participantId);
  }
  if (!party.participantScores[key]) party.participantScores[key] = { name: name || key, score: 0, voteCount: 0, participantId: participantId || key };
  party.participantScores[key].score += points;
  if (name && name !== 'DJ' && name !== 'Guest') party.participantScores[key].name = name;
  if (participantId) party.participantScores[key].participantId = participantId;
  console.log(`⭐ [${party.code}] +${points}pts → ${name} (${reason}) [total: ${party.participantScores[key].score}]`);
  broadcastLeaderboard(party);
}

function broadcastLeaderboard(party) {
  const lb = Object.values(party.participantScores)
    .map(d => ({ id: d.participantId === 'host' ? 'host' : d.name, name: d.name, points: d.score }))
    .sort((a, b) => b.points - a.points);
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

  // Intercept all host: events to auto-join room
  const origOn = socket.on.bind(socket);
  socket.on = function(event, handler) {
    if (event.startsWith('host:')) {
      return origOn(event, (...args) => {
        ensureHostRoom();
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

    // Create or reset party
    const party = createPartyState(code);
    party.hostSocketId = socket.id;
    party.hostProfile = data.profile || null;
    parties.set(code, party);

    // Build host participant
    const hostName = data.profile?.name || 'Hôte';
    const hostEmoji = data.profile?.emoji || '🎧';
    party.participants.unshift({
      id: socket.id, name: hostName, emoji: hostEmoji,
      photo: data.profile?.photo || null,
      phone: data.profile?.phone || '', email: data.profile?.email || '', instagram: data.profile?.instagram || '',
      partyCode: code, joinedAt: new Date().toISOString(), isHost: true
    });

    console.log(`🎉 Party started: ${code} (host: "${hostName}", active parties: ${parties.size})`);
    io.to(`guest:${code}`).emit('party:started', { code, profile: party.hostProfile });
    io.to(`guest:${code}`).emit('participants:update', party.participants);
  });

  socket.on('host:trackUpdate', (track) => {
    const party = getMutableParty(socket); if (!party) return;
    party.currentTrack = track;
    if (track && (!party.trackHistory.length || party.trackHistory[0]?.title !== track.title)) {
      party.trackHistory.unshift({ ...track, playedAt: new Date().toISOString() });
    }
    io.to(`guest:${party.code}`).emit('track:update', track);
    console.log(`🎵 [${party.code}] Track: ${track?.title} — ${track?.artist}`);
  });

  socket.on('host:modeChange', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    party.mode = data.mode;
    io.to(`guest:${party.code}`).emit('mode:change', data);
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

  socket.on('host:trackHistory', (history) => {
    const party = getMutableParty(socket); if (!party) return;
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
    const enriched = (history || []).map(t => ({ ...t, fireCount: trackVotes[t.title]?.fire || 0, likeCount: trackVotes[t.title]?.like || 0, mehCount: trackVotes[t.title]?.meh || 0 }));
    party.trackHistory = enriched;
    io.to(`guest:${party.code}`).emit('history:update', enriched);
  });

  socket.on('host:nextTrack', (track) => {
    const party = getMutableParty(socket); if (!party) return;
    party.nextTrack = track;
    io.to(`guest:${party.code}`).emit('nextTrack:update', track);
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

    const guest = {
      id: socket.id, name: guestName, emoji: data.emoji || '🎉',
      photo: data.photo || null, phone: data.phone || '', email: data.email || '', instagram: data.instagram || '',
      partyCode: code, joinedAt: new Date().toISOString(),
      sessionToken, connected: true
    };
    party.participants = party.participants.filter(p => p.name !== guest.name);
    party.participants.push(guest);
    party.sessionTokens[sessionToken] = guestName;
    party.isDirty = true;
    recomputeGenreVotes(party);
    socket.emit('party:state', {
      ...party, photoHashes: undefined, profilePointsGiven: undefined,
      _genreVotedOnce: undefined, sessionTokens: undefined, disconnectTimers: undefined
    });
    // Send session token separately (client stores it)
    socket.emit('session:token', { sessionToken, partyCode: code });
    io.to(`host:${code}`).emit('guest:joined', guest);
    io.to(`guest:${code}`).emit('participants:update', party.participants);
    if (guest.name && guest.name !== 'Guest') {
      if (!party.profilePointsGiven.has(guest.name)) {
        party.profilePointsGiven.add(guest.name);
        addPoints(party, socket.id, guest.name, 25, 'profile complete');
      }
    }
    console.log(`👤 [${code}] Guest joined: ${guest.emoji} ${guest.name} (token: ${sessionToken.substring(0, 8)}...)`);
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
    socket.emit('party:state', {
      ...party, photoHashes: undefined, profilePointsGiven: undefined,
      _genreVotedOnce: undefined, sessionTokens: undefined, disconnectTimers: undefined
    });
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
    socket.emit('party:state', { ...party, photoHashes: undefined, profilePointsGiven: undefined, _genreVotedOnce: undefined, sessionTokens: undefined, disconnectTimers: undefined });
  });

  socket.on('host:requestState', () => {
    const party = getParty(socket); if (!party) return;
    socket.emit('party:state', { ...party, photoHashes: undefined, profilePointsGiven: undefined, _genreVotedOnce: undefined, sessionTokens: undefined, disconnectTimers: undefined });
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
    const suggestion = { ...data, sentAt: new Date().toISOString() };
    party.suggestions.push(suggestion);
    io.to(`host:${party.code}`).emit('guest:suggested', suggestion);
    if (data.guestId || data.guestName) addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 5, `suggestion: ${data.title || data.query}`);
  });

  socket.on('host:suggestionPlayed', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    if (data.guestName) {
      addPoints(party, data.guestName, data.guestName, 10, `suggestion played: ${data.trackTitle || 'Unknown'}`);
      addPoints(party, 'host', 'DJ', 5, `handled suggestion: ${data.trackTitle || 'Unknown'}`);
    }
  });

  socket.on('guest:photo', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const photo = { dataURL: data.dataURL, guestName: data.guestName || 'Guest', caption: data.caption || null, sentAt: new Date().toISOString() };
    if (!addPhotoToParty(party, photo)) return;
    socket.broadcast.to(`guest:${party.code}`).emit('photo:shared', photo);
    io.to(`host:${party.code}`).emit('guest:photo', photo);
    addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 20, 'photo');
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
      const photo = { dataURL: data.photo, guestName: entry?.guestName || 'Guest', sentAt: new Date().toISOString() };
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
  socket.on('host:closeCostume', () => {
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
    const voteData = { ...data, trackTitle, trackId: trackTitle };
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

  socket.on('host:endParty', async () => {
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

  socket.on('disconnect', () => {
    const code = socket.partyCode;
    const party = code ? parties.get(code) : null;
    if (party) {
      const participant = party.participants.find(p => p.id === socket.id);

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
          io.to(`host:${code}`).emit('guest:left', { id: participant.name });
          party.isDirty = true;
          console.log(`🗑️ [${code}] Guest ${participant.name} removed after 4h grace period`);
        }, GRACE_MS);
        console.log(`⏸️ Disconnected (grace 4h): ${participant.name} (party: ${code})`);
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
        io.to(`host:${code}`).emit('guest:left', { id: socket.id });
        console.log(`❌ Disconnected: ${socket.id} (party: ${code})`);
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
