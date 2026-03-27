import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { networkInterfaces } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3069;

// ─── Socket.IO with CORS for local network ─────────────────────────
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// ─── Party State (in-memory) ────────────────────────────────────────
const partyState = {
  code: null,
  mode: 'appMix',        // 'appMix' | 'djLive'
  currentTrack: null,     // {title, artist, genre, bpm, artworkURL}
  nextTrack: null,
  trackHistory: [],       // [{title, artist, genre, bpm, playedAt}]
  genreVotes: {},         // {genre: count}
  vibeScore: 0,
  participants: [],       // [{id, name, emoji, photo, joinedAt}]
  guestVotes: {},         // {guestId: {trackId: voteType}}
  suggestions: [],        // [{query, guestName, sentAt}]
  hostProfile: null,      // {name, emoji}
  photos: [],              // [{dataURL, guestName, sentAt}]
  costumeEntries: []       // [{guestId, guestName, emoji, photo, votes}]
};

// ─── Helper: get local IP ───────────────────────────────────────────
function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// ─── Serve Guest Web App (static files) ─────────────────────────
app.use(express.static(join(__dirname, 'public')));

// ─── Health check ───────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    status: 'Social Mix Relay Server 🎧',
    party: partyState.code || 'No active party',
    participants: partyState.participants.length,
    mode: partyState.mode
  });
});

app.get('/api/state', (req, res) => {
  res.json(partyState);
});

// ─── Socket.IO Connection Handling ──────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  // ═══════════════════════════════════════════════════════════════════
  // HOST EVENTS (iOS app → Server → Guests)
  // ═══════════════════════════════════════════════════════════════════

  // Host starts/joins party
  socket.on('host:startParty', (data) => {
    socket.join('host');
    const newCode = data.code || 'TEUF2025';
    
    // If new party code → reset everything and kick stale guests
    if (newCode !== partyState.code) {
      console.log(`🔄 New party ${newCode} — resetting state, kicking stale guests`);
      
      // Notify stale guests their party is over
      io.to('guests').emit('party:ended', { reason: 'Nouvelle soirée créée' });
      
      // Force all guests to leave the room
      const sockets = io.sockets.adapter.rooms.get('guests');
      if (sockets) {
        for (const sid of sockets) {
          const s = io.sockets.sockets.get(sid);
          if (s) s.leave('guests');
        }
      }
      
      // Full state reset
      partyState.currentTrack = null;
      partyState.nextTrack = null;
      partyState.trackHistory = [];
      partyState.genreVotes = {};
      partyState.vibeScore = 0;
      partyState.participants = [];
      partyState.guestVotes = {};
      partyState.suggestions = [];
      partyState.photos = [];
      partyState.costumeEntries = [];
      partyState.guestGenreVotes = {};
    }
    
    partyState.code = newCode;
    partyState.hostProfile = data.profile || null;
    console.log(`🎉 Party started: ${partyState.code}`);
    io.to('guests').emit('party:started', { code: partyState.code, profile: partyState.hostProfile });
  });

  // Host sends current track update
  socket.on('host:trackUpdate', (track) => {
    partyState.currentTrack = track;
    // Add to history if new
    if (track && (!partyState.trackHistory.length || 
        partyState.trackHistory[0]?.title !== track.title)) {
      partyState.trackHistory.unshift({ ...track, playedAt: new Date().toISOString() });
    }
    io.to('guests').emit('track:update', track);
    console.log(`🎵 Track: ${track?.title} — ${track?.artist}`);
  });

  // Host sends mode change (appMix / djLive)
  socket.on('host:modeChange', (data) => {
    partyState.mode = data.mode;
    io.to('guests').emit('mode:change', data);
    console.log(`🎛️ Mode: ${data.mode}`);
  });

  // Host sends genre vote results
  socket.on('host:voteResults', (data) => {
    partyState.genreVotes = data.genreVotes || {};
    partyState.vibeScore = data.vibeScore || 0;
    io.to('guests').emit('votes:update', data);
  });

  // Host sends track history
  socket.on('host:trackHistory', (history) => {
    partyState.trackHistory = history;
    io.to('guests').emit('history:update', history);
  });

  // Host sends next track info
  socket.on('host:nextTrack', (track) => {
    partyState.nextTrack = track;
    io.to('guests').emit('nextTrack:update', track);
  });

  // ═══════════════════════════════════════════════════════════════════
  // GUEST EVENTS (Web App → Server → Host)
  // ═══════════════════════════════════════════════════════════════════

  // Helper: validate guest belongs to current party
  function isValidGuest() {
    return socket.partyCode && socket.partyCode === partyState.code;
  }

  // Guest joins the party
  socket.on('guest:join', (data) => {
    const guestPartyCode = (data.partyCode || '').toUpperCase();
    
    // Validate party code
    if (partyState.code && guestPartyCode !== partyState.code) {
      socket.emit('party:wrongCode', { message: 'Code incorrect' });
      console.log(`⛔ Wrong code: ${guestPartyCode} (expected ${partyState.code})`);
      return;
    }
    
    // Store party code on socket for future validation
    socket.partyCode = partyState.code;
    socket.join('guests');
    
    const guest = {
      id: socket.id,
      name: data.name || 'Guest',
      emoji: data.emoji || '🎉',
      photo: data.photo || null,
      partyCode: guestPartyCode,
      joinedAt: new Date().toISOString()
    };
    
    // Avoid duplicates on reconnection
    partyState.participants = partyState.participants.filter(p => p.name !== guest.name);
    partyState.participants.push(guest);

    // Send full state to joining guest
    socket.emit('party:state', { ...partyState });
    
    // Notify host
    io.to('host').emit('guest:joined', guest);
    io.to('guests').emit('participants:update', partyState.participants);
    console.log(`👤 Guest joined: ${guest.emoji} ${guest.name} [${guestPartyCode}]`);
  });

  // Guest votes on current track
  socket.on('guest:vote', (data) => {
    if (!isValidGuest()) return;
    // Store vote
    if (!partyState.guestVotes[data.guestId]) {
      partyState.guestVotes[data.guestId] = {};
    }
    partyState.guestVotes[data.guestId][data.trackId || 'current'] = data.type;

    // Forward to host
    io.to('host').emit('guest:voted', data);
    // Broadcast to all guests (for live counters)
    io.to('guests').emit('vote:received', data);
    console.log(`🗳️ Vote: ${data.guestName} → ${data.type}`);
  });

  // Guest votes on genre trend
  socket.on('guest:genreVote', (data) => {
    if (!isValidGuest()) return;
    const guestId = data.guestId || socket.id;
    const genre = data.genre;
    
    // Remove previous genre vote for this guest
    if (partyState.guestGenreVotes && partyState.guestGenreVotes[guestId]) {
      const prevGenre = partyState.guestGenreVotes[guestId];
      if (partyState.genreVotes[prevGenre]) {
        partyState.genreVotes[prevGenre] = Math.max(0, partyState.genreVotes[prevGenre] - 1);
        if (partyState.genreVotes[prevGenre] === 0) delete partyState.genreVotes[prevGenre];
      }
    }
    
    // Track this guest's genre vote
    if (!partyState.guestGenreVotes) partyState.guestGenreVotes = {};
    partyState.guestGenreVotes[guestId] = genre;
    
    // Increment new genre
    partyState.genreVotes[genre] = (partyState.genreVotes[genre] || 0) + 1;
    
    io.to('host').emit('guest:genreVoted', data);
    console.log(`🎵 Genre vote: ${data.guestName} → ${genre} (total: ${partyState.genreVotes[genre]})`);
  });

  // Guest suggests a track
  socket.on('guest:suggest', (data) => {
    if (!isValidGuest()) return;
    const suggestion = { ...data, sentAt: new Date().toISOString() };
    partyState.suggestions.push(suggestion);
    io.to('host').emit('guest:suggested', suggestion);
    console.log(`💡 Suggestion: ${data.guestName} → "${data.query}"`);
  });

  // Guest shares a photo
  socket.on('guest:photo', (data) => {
    if (!isValidGuest()) return;
    const photo = {
      dataURL: data.dataURL,
      guestName: data.guestName || 'Guest',
      sentAt: new Date().toISOString()
    };
    partyState.photos.push(photo);
    io.to('guests').emit('photo:shared', photo);
    io.to('host').emit('guest:photo', photo);
    console.log(`📸 Photo shared by ${photo.guestName}`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // COSTUME CONTEST
  // ═══════════════════════════════════════════════════════════════════

  socket.on('costume:enter', (data) => {
    if (!isValidGuest()) return;
    // Prevent duplicates
    partyState.costumeEntries = partyState.costumeEntries.filter(e => e.guestId !== data.guestId);
    partyState.costumeEntries.push({
      guestId: data.guestId || socket.id,
      guestName: data.guestName || 'Guest',
      emoji: data.emoji || '🎭',
      photo: data.photo,
      votes: 0
    });
    // Broadcast all entries to all guests
    io.to('guests').emit('costume:entries', partyState.costumeEntries);
    io.to('host').emit('costume:entries', partyState.costumeEntries);
    console.log(`🎭 Costume entry: ${data.guestName}`);
  });

  socket.on('costume:vote', (data) => {
    if (!isValidGuest()) return;
    const entry = partyState.costumeEntries.find(e => e.guestId === data.targetId);
    if (entry) {
      entry.votes = (entry.votes || 0) + 1;
    }
    io.to('guests').emit('costume:entries', partyState.costumeEntries);
    io.to('host').emit('costume:entries', partyState.costumeEntries);
    console.log(`👍 Costume vote: ${data.voterName} → ${data.targetName}`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // DISCONNECT
  // ═══════════════════════════════════════════════════════════════════

  socket.on('disconnect', () => {
    // Remove genre vote for this guest
    if (partyState.guestGenreVotes && partyState.guestGenreVotes[socket.id]) {
      const genre = partyState.guestGenreVotes[socket.id];
      if (partyState.genreVotes[genre]) {
        partyState.genreVotes[genre] = Math.max(0, partyState.genreVotes[genre] - 1);
        if (partyState.genreVotes[genre] === 0) delete partyState.genreVotes[genre];
      }
      delete partyState.guestGenreVotes[socket.id];
      // Notify host of updated genre votes
      io.to('host').emit('guest:genreVoted', { genre, guestName: 'left', removed: true });
    }
    
    partyState.participants = partyState.participants.filter(p => p.id !== socket.id);
    io.to('guests').emit('participants:update', partyState.participants);
    io.to('host').emit('guest:left', { id: socket.id });
    console.log(`❌ Disconnected: ${socket.id}`);
  });
});

// ─── Start Server ───────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  🎧 ═══════════════════════════════════════════');
  console.log('  ║   SOCIAL MIX — Relay Server                ║');
  console.log('  ═══════════════════════════════════════════════');
  console.log(`  ║  Local:   http://localhost:${PORT}`);
  console.log(`  ║  Network: http://${ip}:${PORT}`);
  console.log(`  ║  Guest:   http://${ip}:${PORT} (same URL!)`);
  console.log('  ═══════════════════════════════════════════════');
  console.log('');
});
