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
  costumeEntries: [],       // [{guestId, guestName, emoji, photo, votes}]
  participantScores: {},     // {guestId: {name, score, voteCount}}
  guestGenreVotes: {}        // {guestId: genre}
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
    socket.partyCode = data.code || 'TEUF2025';  // So host passes isValidGuest() too
    const newCode = socket.partyCode;
    
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
      partyState.participantScores = {};
    }
    
    partyState.code = newCode;
    partyState.hostProfile = data.profile || null;
    
    // Add host as first participant
    const hostName = (data.profile && data.profile.name) || 'DJ';
    const hostEmoji = (data.profile && data.profile.emoji) || '🎧';
    partyState.participants = [{
      id: socket.id,
      name: hostName,
      emoji: hostEmoji,
      photo: null,
      partyCode: newCode,
      joinedAt: new Date().toISOString(),
      isHost: true
    }];
    
    console.log(`🎉 Party started: ${partyState.code} (host: ${hostName})`);
    io.to('guests').emit('party:started', { code: partyState.code, profile: partyState.hostProfile });
    io.to('guests').emit('participants:update', partyState.participants);
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
    if (!partyState.code) {
      socket.emit('party:wrongCode', { message: 'Aucune soirée active. Le DJ doit lancer la soirée depuis l\'app.' });
      console.log(`⛔ No party active. Guest tried: ${guestPartyCode}`);
      return;
    }
    if (guestPartyCode !== partyState.code) {
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
    
    // Scoring: Bof=1, TOP=2, Feu=4
    const scoreMap = { meh: 1, like: 2, fire: 4 };
    const pts = scoreMap[data.type] || 0;
    if (pts > 0 && data.guestId) {
      if (!partyState.participantScores[data.guestId]) {
        partyState.participantScores[data.guestId] = { name: data.guestName, score: 0, voteCount: 0 };
      }
      partyState.participantScores[data.guestId].score += pts;
      partyState.participantScores[data.guestId].voteCount += 1;
      // Broadcast updated scores
      io.to('guests').emit('scores:update', partyState.participantScores);
      io.to('host').emit('scores:update', partyState.participantScores);
    }
    console.log(`🗳️ Vote: ${data.guestName} → ${data.type} (+${pts}pts)`);
  });

  // Guest votes on genre trend
  // Client sends {genre (null=cancel), previousGenre (to decrement)}
  socket.on('guest:genreVote', (data) => {
    if (!isValidGuest()) return;
    const genre = data.genre;               // new genre (null if cancel)
    const previousGenre = data.previousGenre; // old genre to decrement
    
    // Decrement previous genre
    if (previousGenre && partyState.genreVotes[previousGenre]) {
      partyState.genreVotes[previousGenre] = Math.max(0, partyState.genreVotes[previousGenre] - 1);
      if (partyState.genreVotes[previousGenre] === 0) delete partyState.genreVotes[previousGenre];
    }
    
    // Increment new genre (if not cancel)
    if (genre) {
      partyState.genreVotes[genre] = (partyState.genreVotes[genre] || 0) + 1;
    }
    
    console.log(`🎵 Genre: ${data.guestName} ${previousGenre || '-'} → ${genre || 'CANCEL'} | ${JSON.stringify(partyState.genreVotes)}`);
    
    io.to('host').emit('guest:genreVoted', data);
    io.to('guests').emit('votes:update', { genreVotes: partyState.genreVotes });
    io.to('host').emit('votes:update', { genreVotes: partyState.genreVotes });
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
  // HOST VOTE (organizer votes also influence dancefloor)
  // ═══════════════════════════════════════════════════════════════════

  socket.on('host:vote', (data) => {
    // Forward host vote as if it were a guest vote
    const voteData = {
      ...data,
      trackTitle: data.trackTitle || (partyState.currentTrack && partyState.currentTrack.title) || 'Titre en cours',
      trackId: data.trackTitle || (partyState.currentTrack && partyState.currentTrack.title) || 'current'
    };
    io.to('guests').emit('vote:received', voteData);
    // Score the host too
    const scoreMap = { meh: 1, like: 2, fire: 4 };
    const pts = scoreMap[data.type] || 0;
    if (pts > 0) {
      if (!partyState.participantScores.host) {
        partyState.participantScores.host = { name: data.guestName || 'DJ', score: 0, voteCount: 0 };
      }
      partyState.participantScores.host.score += pts;
      partyState.participantScores.host.voteCount += 1;
      io.to('guests').emit('scores:update', partyState.participantScores);
      io.to('host').emit('scores:update', partyState.participantScores);
    }
    
    // Update vibe score for dancefloor
    const vibeMap = { meh: -1, like: 1, fire: 3 };
    partyState.vibeScore = Math.max(0, partyState.vibeScore + (vibeMap[data.type] || 0));
    io.to('guests').emit('votes:update', { genreVotes: partyState.genreVotes, vibeScore: partyState.vibeScore });
    
    console.log(`🎧 Host vote: ${data.type} (+${pts}pts, vibe=${partyState.vibeScore})`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // END PARTY
  // ═══════════════════════════════════════════════════════════════════

  socket.on('host:endParty', () => {
    io.to('guests').emit('party:ended', {
      reason: 'La soirée est terminée ! Merci d\'avoir participé 🎉',
      scores: partyState.participantScores,
      trackHistory: partyState.trackHistory,
      photos: partyState.photos
    });
    console.log('🎉 Party ended by host');
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
