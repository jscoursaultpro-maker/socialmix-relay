/* ═══════════════════════════════════════════
   SOCIAL MIX — Guest Web App
   Socket.IO connection + UI Logic
   ═══════════════════════════════════════════ */

// ─── Config ──────────────────────────────────────────
const RELAY_PORT = 3069;
const STORAGE_KEY = 'socialmix_guest';
const GENRES = ['Electro', 'Disco', 'Hip-Hop', 'Latino', 'Pop', 'Rock'];

// ─── State ───────────────────────────────────────────
let socket = null;
let state = {
  guestId: null,
  guestName: '',
  guestEmoji: '🎉',
  partyCode: '',
  currentVote: null,
  selectedGenre: null,
  genreVotes: {},
  trackHistory: [],
  suggestions: [],
  currentTrack: null,
  mode: 'appMix',
  connected: false
};

// ─── DOM Elements ────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ─── LocalStorage Persistence ────────────────────────
function saveSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    guestId: state.guestId,
    guestName: state.guestName,
    guestEmoji: state.guestEmoji,
    partyCode: state.partyCode,
    suggestions: state.suggestions,
    trackHistory: state.trackHistory
  }));
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      state.guestId = saved.guestId;
      state.guestName = saved.guestName || '';
      state.guestEmoji = saved.guestEmoji || '🎉';
      state.partyCode = saved.partyCode || '';
      state.suggestions = saved.suggestions || [];
      state.trackHistory = saved.trackHistory || [];
      return true;
    }
  } catch (e) {}
  return false;
}

// ─── Socket.IO Connection ────────────────────────────
function connectToRelay() {
  // Connect to the same server that's hosting this page
  const url = window.location.origin;
  
  updateConnection('connecting', 'Connexion...');
  
  socket = io(url, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
    timeout: 5000
  });

  socket.on('connect', () => {
    state.connected = true;
    state.guestId = socket.id;
    updateConnection('connected', 'Connecté');
    
    // Re-join party on reconnection
    socket.emit('guest:join', {
      name: state.guestName,
      emoji: state.guestEmoji,
      partyCode: state.partyCode
    });
  });

  socket.on('disconnect', () => {
    state.connected = false;
    updateConnection('error', 'Déconnecté — reconnexion...');
  });

  socket.on('connect_error', () => {
    updateConnection('error', 'Serveur introuvable');
  });

  // ═══ HOST → GUEST Events ═══

  // Full state on join
  socket.on('party:state', (partyState) => {
    if (partyState.currentTrack) {
      state.currentTrack = partyState.currentTrack;
      updateNowPlaying(partyState.currentTrack);
    }
    if (partyState.genreVotes) {
      state.genreVotes = partyState.genreVotes;
      updateGenreChart();
    }
    if (partyState.trackHistory) {
      state.trackHistory = partyState.trackHistory;
      updateHistory();
    }
    if (partyState.mode) {
      state.mode = partyState.mode;
      updateDJMode();
    }
    saveSession();
  });

  // Track update
  socket.on('track:update', (track) => {
    state.currentTrack = track;
    state.currentVote = null; // Reset vote on new track
    updateNowPlaying(track);
    updateVoteButtons();
    saveSession();
  });

  // Mode change
  socket.on('mode:change', (data) => {
    state.mode = data.mode;
    updateDJMode();
  });

  // Vote results
  socket.on('votes:update', (data) => {
    state.genreVotes = data.genreVotes || {};
    updateGenreChart();
  });

  // History update
  socket.on('history:update', (history) => {
    state.trackHistory = history;
    updateHistory();
    saveSession();
  });

  // Another guest's vote received
  socket.on('vote:received', (data) => {
    // Could show a real-time vote indicator
  });
}

// ─── UI: Connection Status ───────────────────────────
function updateConnection(status, text) {
  const dot = $('conn-dot');
  const txt = $('conn-text');
  dot.className = 'conn-dot ' + (status === 'connected' ? 'connected' : status === 'error' ? 'error' : '');
  txt.textContent = text;
}

// ─── UI: Now Playing ─────────────────────────────────
function updateNowPlaying(track) {
  if (!track) return;
  $('np-title').textContent = track.title || 'En attente...';
  $('np-artist').textContent = track.artist || '—';
  $('np-bpm').textContent = `${track.bpm || '—'} BPM`;
  $('np-genre').textContent = (track.genre || '—').toUpperCase();
  
  // Artwork
  const artworkEl = $('np-artwork');
  if (track.artworkURL) {
    artworkEl.innerHTML = `<img src="${track.artworkURL}" alt="cover">`;
  } else {
    artworkEl.innerHTML = '<span class="np-icon">🎵</span>';
  }
}

// ─── UI: DJ Mode Banner ─────────────────────────────
function updateDJMode() {
  const banner = $('dj-live-banner');
  if (state.mode === 'djLive') {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

// ─── UI: Vote Buttons ────────────────────────────────
function setupVoteButtons() {
  ['meh', 'like', 'fire'].forEach(type => {
    $(`vote-${type}`).addEventListener('click', () => {
      state.currentVote = type;
      updateVoteButtons();
      
      // Send vote to server
      if (socket && socket.connected) {
        socket.emit('guest:vote', {
          type,
          guestId: state.guestId,
          guestName: state.guestName,
          trackId: state.currentTrack?.title || 'current'
        });
      }
      
      $('vote-status').textContent = '✅ Vote enregistré';
      setTimeout(() => { $('vote-status').textContent = ''; }, 3000);
    });
  });
}

function updateVoteButtons() {
  ['meh', 'like', 'fire'].forEach(type => {
    const btn = $(`vote-${type}`);
    btn.classList.toggle('selected', state.currentVote === type);
  });
}

// ─── UI: Genre Trends ────────────────────────────────
function setupGenreTrends() {
  const grid = $('genre-grid');
  grid.innerHTML = '';
  
  GENRES.forEach(genre => {
    const btn = document.createElement('button');
    btn.className = 'genre-btn' + (state.selectedGenre === genre ? ' selected' : '');
    btn.innerHTML = `
      <div class="genre-name">${genre}</div>
      <div class="genre-count">${state.genreVotes[genre] || 0} votes</div>
    `;
    btn.addEventListener('click', () => {
      state.selectedGenre = genre;
      setupGenreTrends(); // Re-render
      
      if (socket && socket.connected) {
        socket.emit('guest:genreVote', {
          genre,
          guestName: state.guestName,
          guestId: state.guestId
        });
      }
    });
    grid.appendChild(btn);
  });
}

// ─── UI: Genre Chart ─────────────────────────────────
function updateGenreChart() {
  const container = $('chart-bars');
  const maxVotes = Math.max(...Object.values(state.genreVotes), 1);
  
  container.innerHTML = '';
  
  const sorted = Object.entries(state.genreVotes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  
  sorted.forEach(([genre, votes]) => {
    const pct = (votes / maxVotes * 100).toFixed(0);
    const row = document.createElement('div');
    row.className = 'chart-row';
    row.innerHTML = `
      <span class="chart-label">${genre}</span>
      <div class="chart-bar-container">
        <div class="chart-bar" style="width: ${pct}%"></div>
      </div>
      <span class="chart-value">${votes}</span>
    `;
    container.appendChild(row);
  });
  
  // Update trending badge
  if (sorted.length > 0) {
    $('trending-genre').textContent = sorted[0][0];
  }
  
  // Update genre buttons counts
  setupGenreTrends();
}

// ─── UI: Suggest Track ───────────────────────────────
function setupSuggest() {
  const input = $('suggest-input');
  const btn = $('suggest-btn');
  
  input.addEventListener('input', () => {
    btn.disabled = input.value.trim() === '';
  });
  
  btn.addEventListener('click', () => {
    const query = input.value.trim();
    if (!query) return;
    
    state.suggestions.push(query);
    
    if (socket && socket.connected) {
      socket.emit('guest:suggest', {
        query,
        guestName: state.guestName,
        guestId: state.guestId
      });
    }
    
    // Show in UI
    const list = $('suggestions-list');
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.innerHTML = `<span class="suggestion-check">✅</span> ${query} — envoyé`;
    list.appendChild(item);
    
    input.value = '';
    btn.disabled = true;
    saveSession();
  });
}

// ─── UI: Track History ───────────────────────────────
function updateHistory() {
  const list = $('history-list');
  const count = $('history-count');
  
  if (!state.trackHistory.length) {
    list.innerHTML = '<div class="empty-state">Aucun titre joué pour le moment</div>';
    count.textContent = '0 titres';
    return;
  }
  
  count.textContent = `${state.trackHistory.length} titres`;
  list.innerHTML = '';
  
  state.trackHistory.forEach((track, i) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    
    const query = encodeURIComponent(`${track.artist} ${track.title}`);
    
    item.innerHTML = `
      <span class="history-num">${i + 1}</span>
      <div class="history-info">
        <div class="history-title">${track.title}</div>
        <div class="history-artist">${track.artist}</div>
        <div class="history-links">
          <a class="stream-link spotify" href="https://open.spotify.com/search/${query}" target="_blank">Spotify</a>
          <a class="stream-link apple" href="https://music.apple.com/search?term=${query}" target="_blank">Apple</a>
          <a class="stream-link deezer" href="https://www.deezer.com/search/${query}" target="_blank">Deezer</a>
        </div>
      </div>
    `;
    list.appendChild(item);
  });
}

// ─── JOIN Flow ───────────────────────────────────────
function setupJoinFlow() {
  const nameInput = $('guest-name');
  const codeInput = $('party-code');
  const joinBtn = $('join-btn');
  
  // Pre-fill from saved session
  if (state.guestName) nameInput.value = state.guestName;
  if (state.partyCode) codeInput.value = state.partyCode;
  
  joinBtn.addEventListener('click', () => {
    state.guestName = nameInput.value.trim() || 'Guest';
    state.partyCode = codeInput.value.trim().toUpperCase() || 'TEUF2025';
    
    enterCockpit();
  });
}

function enterCockpit() {
  // Switch to cockpit
  $('join-screen').classList.remove('active');
  $('cockpit-screen').classList.add('active');
  
  // Update greeting
  $('greeting').textContent = `Hey ${state.guestName} !`;
  
  // Initialize UI
  setupVoteButtons();
  setupGenreTrends();
  setupSuggest();
  updateHistory();
  
  // Wire quit button
  $('quit-btn').addEventListener('click', quitParty);
  
  // Connect to relay server
  connectToRelay();
  saveSession();
}

// ─── Quit Party ──────────────────────────────────────
function quitParty() {
  // Disconnect socket
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  
  // Clear session
  localStorage.removeItem(STORAGE_KEY);
  
  // Reset state
  state = {
    guestId: null,
    guestName: '',
    guestEmoji: '🎉',
    partyCode: '',
    currentVote: null,
    selectedGenre: null,
    genreVotes: {},
    trackHistory: [],
    suggestions: [],
    currentTrack: null,
    mode: 'appMix',
    connected: false
  };
  
  // Reset UI elements
  $('np-title').textContent = 'En attente...';
  $('np-artist').textContent = '—';
  $('np-bpm').textContent = '— BPM';
  $('np-genre').textContent = '—';
  $('np-artwork').innerHTML = '<span class="np-icon">🎵</span>';
  $('vote-status').textContent = '';
  $('suggestions-list').innerHTML = '';
  $('dj-live-banner').classList.add('hidden');
  updateConnection('connecting', 'Connexion...');
  
  // Clear inputs
  $('guest-name').value = '';
  $('party-code').value = '';
  
  // Switch back to join screen
  $('cockpit-screen').classList.remove('active');
  $('join-screen').classList.add('active');
}

// ─── Auto-Rejoin on Page Load ────────────────────────
function init() {
  const hasSession = loadSession();
  
  // Always set up join flow (needed after quit too)
  setupJoinFlow();
  
  if (hasSession && state.partyCode && state.guestName) {
    // Auto-rejoin: skip join screen
    enterCockpit();
  }
}

// ─── Start ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

