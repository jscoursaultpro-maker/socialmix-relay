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
  },
  maxHttpBufferSize: 10e6,  // 10MB — base64 photos inflate ~33% vs raw
  pingTimeout: 60000,       // 60s timeout for slow mobile connections
  pingInterval: 25000
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
  costumeOpen: true,         // Whether costume contest is still accepting votes
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
// Prevent caching of HTML/JS/CSS to ensure latest code is always served
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
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
app.get('/status', (req, res) => {
  res.json({
    status: 'Social Mix Relay Server 🎧',
    version: 'v12',
    party: partyState.code || 'No active party',
    participants: partyState.participants.length,
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// ─── Deezer API Proxy (bypass CORS for browser guests) ─────────
app.get('/api/deezer/search', async (req, res) => {
  const q = req.query.q || '';
  const limit = req.query.limit || 6;
  try {
    const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}&order=RANKING`);
    const json = await r.json();
    res.json(json);
  } catch (err) {
    console.error('[Deezer Proxy] Search error:', err.message);
    res.status(500).json({ error: 'Deezer search failed' });
  }
});

app.get('/api/deezer/chart', async (req, res) => {
  const limit = req.query.limit || 8;
  try {
    const r = await fetch(`https://api.deezer.com/chart/0/tracks?limit=${limit}`);
    const json = await r.json();
    res.json(json);
  } catch (err) {
    console.error('[Deezer Proxy] Chart error:', err.message);
    res.status(500).json({ error: 'Deezer chart failed' });
  }
});

app.get('/api/state', (req, res) => {
  res.json(partyState);
});

// Centralized photo add with hash dedup
function addPhotoToParty(photo) {
  if (!partyState.photoHashes) partyState.photoHashes = new Set();
  const url = photo.dataURL || '';
  const mid = Math.floor(url.length / 2);
  const hash = url.length + ':' + url.substring(mid, mid + 80);
  if (partyState.photoHashes.has(hash)) return false;
  partyState.photoHashes.add(hash);
  partyState.photos.push(photo);
  return true;
}

// ─── Points System ──────────────────────────────────────────────────
function addPoints(participantId, name, points, reason) {
  // Resolve stable key: 'host' for host, guestName for guests
  // Using name as key eliminates socket.id vs guestId dedup issues
  let key;
  if (participantId === 'host') {
    key = 'host';
  } else {
    // For guests: try to find by participantId in existing entries, else use name
    const existing = Object.entries(partyState.participantScores).find(([k, v]) =>
      v.participantId === participantId || k === name
    );
    key = existing ? existing[0] : (name || participantId);
  }
  
  if (!partyState.participantScores[key]) {
    partyState.participantScores[key] = { name: name || key, score: 0, voteCount: 0, participantId: participantId || key };
  }
  partyState.participantScores[key].score += points;
  // Update display name if meaningful
  if (name && name !== 'DJ' && name !== 'Guest') {
    partyState.participantScores[key].name = name;
  }
  // Keep participantId fresh for leaderboard id
  if (participantId) {
    partyState.participantScores[key].participantId = participantId;
  }
  console.log(`⭐ +${points}pts → ${name} [key=${key}] (${reason}) [total: ${partyState.participantScores[key].score}]`);
  broadcastLeaderboard();
}

function broadcastLeaderboard() {
  const leaderboard = Object.values(partyState.participantScores)
    .map(data => ({
      id: data.participantId === 'host' ? 'host' : data.name,
      name: data.name,
      points: data.score
    }))
    .sort((a, b) => b.points - a.points);
  io.to('guests').emit('leaderboard:update', leaderboard);
  io.to('host').emit('leaderboard:update', leaderboard);
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
  // HOST EVENTS (iOS app → Server → Guests)
  // ═══════════════════════════════════════════════════════════════════

  // Helper: recompute genreVotes from individual guest votes
  function recomputeGenreVotes() {
    const totals = {};
    if (partyState.guestGenreVotes) {
      Object.values(partyState.guestGenreVotes).forEach(g => {
        totals[g] = (totals[g] || 0) + 1;
      });
    }
    partyState.genreVotes = totals;
    return totals;
  }

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
      partyState.photoHashes = new Set();
      partyState.costumeEntries = [];
      partyState.guestGenreVotes = {};
      partyState.participantScores = {};
      partyState.costumeVoters = {};
      partyState.costumeOpen = true;
      partyState.profilePointsGiven = new Set();
    }
    
    partyState.code = newCode;
    partyState.hostProfile = data.profile || null;
    
    // Build host participant entry
    const hostName = (data.profile && data.profile.name) || 'Hôte';
    const hostEmoji = (data.profile && data.profile.emoji) || '🎧';
    const hostEntry = {
      id: socket.id,
      name: hostName,
      emoji: hostEmoji,
      photo: (data.profile && data.profile.photo) || null,
      phone: (data.profile && data.profile.phone) || '',
      email: (data.profile && data.profile.email) || '',
      instagram: (data.profile && data.profile.instagram) || '',
      partyCode: newCode,
      joinedAt: new Date().toISOString(),
      isHost: true
    };
    
    // IMPORTANT: Only replace host entry, preserve guest participants
    partyState.participants = partyState.participants.filter(p => !p.isHost);
    partyState.participants.unshift(hostEntry);
    
    console.log(`🎉 Party started: ${partyState.code} (host: "${hostName}", profile.name: "${data.profile && data.profile.name}", participants: ${partyState.participants.length})`);
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

  // Host votes on a genre trend (same tracking as guests)
  socket.on('host:genreVote', (data) => {
    if (!partyState.guestGenreVotes) partyState.guestGenreVotes = {};
    const genre = data.genre; // null = cancel
    if (genre) {
      // Award points only first time host votes a genre
      if (!partyState.guestGenreVotes['__HOST__']) {
        const hostName = data.guestName || 'DJ';
        addPoints('host', hostName, 15, 'genre vote');
      }
      partyState.guestGenreVotes['__HOST__'] = genre;
    } else {
      delete partyState.guestGenreVotes['__HOST__'];
    }
    const totals = recomputeGenreVotes();
    console.log(`🎵 HOST genre: ${genre || 'CANCEL'} | votes: ${JSON.stringify(totals)}`);
    io.to('guests').emit('votes:update', { genreVotes: totals });
    // Also send back to host so it sees guest votes merged
    io.to('host').emit('votes:update', { genreVotes: totals });
  });

  // Host votes for a costume
  socket.on('host:costumeVote', (data) => {
    if (!partyState.costumeVoters) partyState.costumeVoters = {};
    const voterId = 'host';
    const targetId = data.targetId;
    
    // Already voted for this target? Ignore
    if (partyState.costumeVoters[voterId] === targetId) {
      console.log(`👑 HOST costume vote ignored (duplicate) → ${data.targetName}`);
      return;
    }
    
    // If voted for someone else, remove old vote
    if (partyState.costumeVoters[voterId]) {
      const oldTarget = partyState.costumeEntries.find(e => e.guestId === partyState.costumeVoters[voterId]);
      if (oldTarget) oldTarget.votes = Math.max(0, (oldTarget.votes || 0) - 1);
    }
    
    partyState.costumeVoters[voterId] = targetId;
    const entry = partyState.costumeEntries.find(e => e.guestId === targetId);
    if (entry) entry.votes = (entry.votes || 0) + 1;
    
    io.to('guests').emit('costume:entries', partyState.costumeEntries);
    io.to('host').emit('costume:entries', partyState.costumeEntries);
    console.log(`👑 HOST costume vote → ${data.targetName || targetId}`);
  });

  // Host adds a costume photo
  socket.on('host:costumePhoto', (data) => {
    const entry = partyState.costumeEntries.find(e => e.guestId === 'host');
    if (entry) {
      entry.photo = data.photo;
    }
    io.to('guests').emit('costume:entries', partyState.costumeEntries);
    io.to('host').emit('costume:entries', partyState.costumeEntries);
    // Add to gallery for guests (NOT echoed back to host — host already has it locally)
    const photo = {
      dataURL: data.photo,
      guestName: entry?.guestName || 'Host',
      sentAt: new Date().toISOString()
    };
    if (addPhotoToParty(photo)) {
      io.to('guests').emit('photo:shared', photo);
      console.log(`📸 HOST costume photo added to gallery`);
    }
  });

  // Host sends vibe score only (genreVotes are tracked via host:genreVote)
  socket.on('host:voteResults', (data) => {
    partyState.vibeScore = data.vibeScore || 0;
  });

  // Host sends track history — enrich with vote counts before broadcasting
  socket.on('host:trackHistory', (history) => {
    // Compute per-track vote counts from guestVotes
    const trackVotes = {};
    for (const guestId in partyState.guestVotes) {
      const votes = partyState.guestVotes[guestId];
      for (const trackId in votes) {
        if (!trackVotes[trackId]) trackVotes[trackId] = { fire: 0, like: 0, meh: 0 };
        const type = votes[trackId];
        if (type === 'fire') trackVotes[trackId].fire++;
        else if (type === 'like') trackVotes[trackId].like++;
        else if (type === 'meh') trackVotes[trackId].meh++;
      }
    }
    
    // Enrich each track with its vote counts
    const enriched = (history || []).map(t => ({
      ...t,
      fireCount: trackVotes[t.title]?.fire || 0,
      likeCount: trackVotes[t.title]?.like || 0,
      mehCount: trackVotes[t.title]?.meh || 0
    }));
    
    partyState.trackHistory = enriched;
    io.to('guests').emit('history:update', enriched);
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
      phone: data.phone || '',
      email: data.email || '',
      instagram: data.instagram || '',
      partyCode: guestPartyCode,
      joinedAt: new Date().toISOString()
    };
    
    // Avoid duplicates on reconnection
    partyState.participants = partyState.participants.filter(p => p.name !== guest.name);
    partyState.participants.push(guest);

    // Recompute genreVotes from ground truth before sending
    recomputeGenreVotes();
    socket.emit('party:state', { ...partyState });
    
    // Notify host
    io.to('host').emit('guest:joined', guest);
    io.to('guests').emit('participants:update', partyState.participants);
    
    // +25 pts for completing profile (having a proper name) — only once per name
    if (guest.name && guest.name !== 'Guest') {
      if (!partyState.profilePointsGiven) partyState.profilePointsGiven = new Set();
      if (!partyState.profilePointsGiven.has(guest.name)) {
        partyState.profilePointsGiven.add(guest.name);
        addPoints(socket.id, guest.name, 25, 'profile complete');
      }
    }
    
    console.log(`👤 Guest joined: ${guest.emoji} ${guest.name} [${guestPartyCode}]`);
  });

  // Guest requests full state refresh (e.g. when navigating back to hub)
  socket.on('guest:requestState', () => {
    if (!isValidGuest()) return;
    socket.emit('party:state', { ...partyState });
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
    
    // Scoring via addPoints (cumulative): flat 10 pts per vote
    const pts = 10;
    if (data.guestId) {
      addPoints(data.guestId, data.guestName || 'Guest', pts, `vote ${data.type}`);
    }
    console.log(`🗳️ Vote: ${data.guestName} → ${data.type} (+${pts}pts)`);
  });

  // Guest votes on genre trend
  // BULLETPROOF: store each guest's vote, recompute totals from scratch
  socket.on('guest:genreVote', (data) => {
    if (!isValidGuest()) return;
    const voterKey = data.guestName || data.guestId || socket.id;
    const genre = data.genre; // null = cancel
    
    // Store/remove this guest's current vote
    if (!partyState.guestGenreVotes) partyState.guestGenreVotes = {};
    if (genre) {
      partyState.guestGenreVotes[voterKey] = genre;
      // +15 pts for first genre vote only
      if (!partyState._genreVotedOnce) partyState._genreVotedOnce = {};
      if (!partyState._genreVotedOnce[voterKey]) {
        partyState._genreVotedOnce[voterKey] = true;
        addPoints(data.guestId || socket.id, data.guestName || voterKey, 15, 'genre vote');
      }
    } else {
      delete partyState.guestGenreVotes[voterKey];
    }
    
    // RECOMPUTE totals from scratch — impossible to drift
    const totals = recomputeGenreVotes();
    
    console.log(`🎵 Genre: ${voterKey} → ${genre || 'CANCEL'} | votes: ${JSON.stringify(totals)} | tracking: ${JSON.stringify(partyState.guestGenreVotes)}`);
    
    io.to('host').emit('guest:genreVoted', data);
    io.to('guests').emit('votes:update', { genreVotes: totals });
    io.to('host').emit('votes:update', { genreVotes: totals });
  });

  // Guest suggests a track
  socket.on('guest:suggest', (data) => {
    if (!isValidGuest()) return;
    const suggestion = { ...data, sentAt: new Date().toISOString() };
    partyState.suggestions.push(suggestion);
    io.to('host').emit('guest:suggested', suggestion);
    // +5 pts per suggestion sent
    if (data.guestId || data.guestName) {
      addPoints(data.guestId || socket.id, data.guestName || 'Guest', 5, `suggestion: ${data.title || data.query}`);
    }
    console.log(`💡 Suggestion: ${data.guestName} → "${data.title || data.query}" (+5pts)`);
  });

  // Host played a guest's suggestion → +10 bonus pts to guest + 5 pts to host
  socket.on('host:suggestionPlayed', (data) => {
    const guestName = data.guestName;
    const trackTitle = data.trackTitle || 'Unknown';
    if (guestName) {
      addPoints(guestName, guestName, 10, `suggestion played: ${trackTitle}`);
      // Host also earns points for handling suggestions
      addPoints('host', 'DJ', 5, `handled suggestion: ${trackTitle}`);
      console.log(`🎯 Suggestion played! +10pts → ${guestName}, +5pts → Host (${trackTitle})`);
    }
  });

  // Guest shares a photo
  socket.on('guest:photo', (data) => {
    if (!isValidGuest()) return;
    const photo = {
      dataURL: data.dataURL,
      guestName: data.guestName || 'Guest',
      caption: data.caption || null,
      sentAt: new Date().toISOString()
    };
    if (!addPhotoToParty(photo)) {
      console.log(`📸 Photo duplicate skipped from ${photo.guestName}`);
      return;
    }
    // Broadcast to OTHER guests only (sender already has the photo locally)
    socket.broadcast.to('guests').emit('photo:shared', photo);
    io.to('host').emit('guest:photo', photo);
    // +20 pts for taking a photo
    addPoints(data.guestId || socket.id, data.guestName || 'Guest', 20, 'photo');
    const sizeKB = Math.round((data.dataURL || '').length / 1024);
    console.log(`📸 Photo shared by ${photo.guestName} (${sizeKB} KB, total: ${partyState.photos.length})`);
  });

  // Guest sends a text message for the slideshow
  socket.on('guest:message', (data) => {
    if (!isValidGuest()) return;
    const msg = {
      guestName: data.guestName || 'Guest',
      message: data.message || '',
      guestPhoto: data.guestPhoto || null,
      guestEmoji: data.guestEmoji || '🎉'
    };
    io.to('host').emit('guest:message', msg);
    // +10 pts for sending a message
    addPoints(data.guestId || socket.id, data.guestName || 'Guest', 10, 'message');
    console.log(`💬 Message from ${msg.guestName}: ${msg.message}`);
  });

  // Host sends a post-it message
  socket.on('host:message', (data) => {
    const msg = {
      guestName: data.guestName || 'DJ',
      message: data.message || '',
      guestEmoji: data.guestEmoji || '🎧'
    };
    io.to('guests').emit('guest:message', msg);
    // +10 pts for the host
    addPoints('host', data.guestName || 'DJ', 10, 'message');
    console.log(`💬 Host message: ${msg.message} (+10pts)`);
  });

  // Host shares a gallery photo (no isValidGuest check needed)
  socket.on('host:photo', (data) => {
    const photo = {
      dataURL: data.dataURL,
      guestName: data.guestName || 'Host',
      sentAt: new Date().toISOString()
    };
    if (!addPhotoToParty(photo)) {
      console.log(`📸 Host photo duplicate skipped`);
      return;
    }
    io.to('guests').emit('photo:shared', photo);
    // Award host +20 pts per photo
    addPoints('host', data.guestName || 'DJ', 20, 'photo');
    const sizeKB = Math.round((data.dataURL || '').length / 1024);
    console.log(`📸 HOST photo shared by ${photo.guestName} (${sizeKB} KB, total: ${partyState.photos.length})`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // COSTUME CONTEST
  // ═══════════════════════════════════════════════════════════════════

  socket.on('costume:enter', (data) => {
    if (!isValidGuest()) return;
    // Prevent duplicates by guestId AND guestName (safety net for reconnections)
    partyState.costumeEntries = partyState.costumeEntries.filter(e => 
      e.guestId !== data.guestId && e.guestName !== data.guestName
    );
    partyState.costumeEntries.push({
      guestId: data.guestId || socket.id,
      guestName: data.guestName || 'Guest',
      emoji: data.emoji || '🎭',
      photo: data.photo,
      votes: 0
    });
    
    // If host enters costume, update their participant name too
    if (data.guestId === 'host' && data.guestName && data.guestName !== 'DJ') {
      const hostP = partyState.participants.find(p => p.isHost);
      if (hostP) {
        hostP.name = data.guestName;
        io.to('guests').emit('participants:update', partyState.participants);
        console.log(`👑 Host name updated to: ${data.guestName}`);
      }
    }
    
    // Broadcast all entries to all guests
    io.to('guests').emit('costume:entries', partyState.costumeEntries);
    io.to('host').emit('costume:entries', partyState.costumeEntries);
    // +30 pts for entering costume contest
    addPoints(data.guestId || socket.id, data.guestName || 'Guest', 30, 'costume entry');
    console.log(`🎭 Costume entry: ${data.guestName}`);
  });

  socket.on('costume:vote', (data) => {
    if (!partyState.costumeOpen) return; // Contest closed
    const voterId = data.voterId || socket.id;
    const targetId = data.targetId;
    if (!partyState.costumeVoters) partyState.costumeVoters = {};
    
    // Already voted for this target? Ignore
    if (partyState.costumeVoters[voterId] === targetId) {
      console.log(`👍 Costume vote ignored (duplicate): ${data.voterName} → ${data.targetName}`);
      return;
    }
    
    // If voted for someone else, remove old vote first
    if (partyState.costumeVoters[voterId]) {
      const oldTarget = partyState.costumeEntries.find(e => e.guestId === partyState.costumeVoters[voterId]);
      if (oldTarget) oldTarget.votes = Math.max(0, (oldTarget.votes || 0) - 1);
    }
    
    // Record new vote
    partyState.costumeVoters[voterId] = targetId;
    const entry = partyState.costumeEntries.find(e => e.guestId === targetId);
    if (entry) entry.votes = (entry.votes || 0) + 1;
    
    io.to('guests').emit('costume:entries', partyState.costumeEntries);
    io.to('host').emit('costume:entries', partyState.costumeEntries);
    console.log(`👍 Costume vote: ${data.voterName} → ${data.targetName} (total voters: ${Object.keys(partyState.costumeVoters).length})`);
  });

  socket.on('costume:unvote', (data) => {
    if (!isValidGuest()) return;
    const voterId = data.voterId || socket.id;
    if (!partyState.costumeVoters) partyState.costumeVoters = {};
    
    // Only unvote if this voter actually voted for this target
    if (partyState.costumeVoters[voterId] !== data.targetId) return;
    
    delete partyState.costumeVoters[voterId];
    const entry = partyState.costumeEntries.find(e => e.guestId === data.targetId);
    if (entry) entry.votes = Math.max(0, (entry.votes || 0) - 1);
    
    io.to('guests').emit('costume:entries', partyState.costumeEntries);
    io.to('host').emit('costume:entries', partyState.costumeEntries);
    console.log(`👎 Costume unvote: ${voterId} ← ${data.targetId}`);
  });

  socket.on('costume:photo', (data) => {
    if (!isValidGuest()) return;
    const entry = partyState.costumeEntries.find(e => e.guestId === data.guestId);
    if (entry) {
      entry.photo = data.photo;
    }
    io.to('guests').emit('costume:entries', partyState.costumeEntries);
    io.to('host').emit('costume:entries', partyState.costumeEntries);
    // Also add to gallery so host sees it in photos
    if (data.photo) {
      const photo = {
        dataURL: data.photo,
        guestName: entry?.guestName || 'Guest',
        sentAt: new Date().toISOString()
      };
      if (addPhotoToParty(photo)) {
        io.to('host').emit('guest:photo', photo);
        socket.broadcast.to('guests').emit('photo:shared', photo);
      }
    }
    console.log(`📸 Costume photo: ${data.guestId} → gallery`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // MISSIONS & POINTS
  // ═══════════════════════════════════════════════════════════════════

  socket.on('mission:complete', (data) => {
    const id = data.participantId || data.guestId || socket.id;
    const name = data.name || 'Guest';
    const pts = data.points || 0;
    const mission = data.mission || 'unknown';
    if (pts > 0) {
      addPoints(id, name, pts, `mission: ${mission}`);
    }
  });

  socket.on('costume:winner', (data) => {
    // Award 150 pts to costume winner
    const winnerId = data.guestId || data.winnerId;
    const winnerName = data.guestName || data.winnerName || 'Winner';
    if (winnerId) {
      addPoints(winnerId, winnerName, 150, 'costume winner 🏆');
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // HOST CLOSES COSTUME CONTEST
  // ═══════════════════════════════════════════════════════════════════
  socket.on('host:closeCostume', () => {
    if (!partyState.costumeOpen) {
      console.log('🎭 Costume contest already closed');
      return;
    }
    partyState.costumeOpen = false;

    // Determine winner (highest votes)
    const entries = partyState.costumeEntries || [];
    const sorted = [...entries].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const winner = sorted.length > 0 && sorted[0].votes > 0 ? sorted[0] : null;

    // Award 150 pts to winner
    if (winner) {
      addPoints(winner.guestId, winner.guestName, 150, 'costume winner 🏆');
    }

    // Build podium (top 3)
    const podium = sorted.slice(0, 3).map((e, i) => ({
      rank: i + 1,
      guestId: e.guestId,
      guestName: e.guestName,
      emoji: e.emoji,
      votes: e.votes || 0,
      photo: e.photo || null
    }));

    // Broadcast to everyone
    const closedData = {
      winner: winner ? { guestId: winner.guestId, guestName: winner.guestName, emoji: winner.emoji, votes: winner.votes || 0, photo: winner.photo || null } : null,
      podium: podium,
      totalEntries: entries.length
    };
    io.to('guests').emit('costume:closed', closedData);
    io.to('host').emit('costume:closed', closedData);
    console.log(`🎭🏆 Costume contest CLOSED! Winner: ${winner ? winner.guestName + ' (' + winner.votes + ' votes)' : 'No winner'}, ${entries.length} entries`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // HOST VOTE (organizer votes also influence dancefloor)
  // ═══════════════════════════════════════════════════════════════════

  socket.on('host:vote', (data) => {
    // Forward host vote as if it were a guest vote
    const trackTitle = data.trackTitle || (partyState.currentTrack && partyState.currentTrack.title) || 'Titre en cours';
    const voteData = {
      ...data,
      trackTitle: trackTitle,
      trackId: trackTitle
    };
    io.to('guests').emit('vote:received', voteData);
    
    // Store host vote in guestVotes so history enrichment includes it
    if (!partyState.guestVotes['host']) partyState.guestVotes['host'] = {};
    partyState.guestVotes['host'][trackTitle] = data.type;
    
    // Score the host via unified addPoints — flat 10 pts per vote
    addPoints('host', data.guestName || 'DJ', 10, `vote ${data.type}`);
    
    // Update vibe score for dancefloor
    const vibeMap = { meh: -1, like: 1, fire: 3 };
    partyState.vibeScore = Math.max(0, partyState.vibeScore + (vibeMap[data.type] || 0));
    io.to('guests').emit('votes:update', { genreVotes: partyState.genreVotes, vibeScore: partyState.vibeScore });
    
    console.log(`🎧 Host vote: ${data.type} on "${trackTitle}" (+10pts, vibe=${partyState.vibeScore})`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // END PARTY
  // ═══════════════════════════════════════════════════════════════════

  socket.on('host:endParty', () => {
    io.to('guests').emit('party:ended', {
      reason: 'La soirée est terminée ! Merci d\'avoir participé 🎉',
      scores: partyState.participantScores,
      trackHistory: partyState.trackHistory,
      photos: partyState.photos,
      participants: partyState.participants
    });
    console.log('🎉 Party ended by host');
  });

  // Host deletes a photo from the gallery
  socket.on('host:deletePhoto', (data) => {
    const idx = data && data.index;
    if (typeof idx === 'number' && idx >= 0 && idx < partyState.photos.length) {
      const removed = partyState.photos.splice(idx, 1);
      console.log(`🗑️ Host deleted photo #${idx} by ${removed[0]?.guestName}`);
      // Broadcast updated photo list to all
      io.to('host').emit('photos:update', partyState.photos);
      io.to('guests').emit('photos:update', partyState.photos);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // DISCONNECT
  // ═══════════════════════════════════════════════════════════════════

  socket.on('disconnect', () => {
    // Remove genre vote for this guest on disconnect
    if (partyState.guestGenreVotes) {
      // Find and remove by guestName (stable key)
      const participant = partyState.participants.find(p => p.id === socket.id);
      if (participant && partyState.guestGenreVotes[participant.name]) {
        delete partyState.guestGenreVotes[participant.name];
        recomputeGenreVotes();
        io.to('host').emit('votes:update', { genreVotes: partyState.genreVotes });
        io.to('guests').emit('votes:update', { genreVotes: partyState.genreVotes });
      }
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
