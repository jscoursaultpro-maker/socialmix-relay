/* ═══════════════════════════════════════════
   SOCIAL MIX — Guest Web App v2
   5-screen architecture with Profile + Social Hub
   ═══════════════════════════════════════════ */

// ─── Config ──────────────────────────────────────────
const STORAGE_KEY = 'socialmix_guest';
const PROFILE_KEY = 'socialmix_profile';
const GENRES = ['Dance', 'Disco', 'Hip-Hop', 'House', 'Electro', 'Pop', 'R&B', 'Latin', 'Club', 'Rock'];
const EMOJIS = ['🎉','🕺','💃','🎶','🌟','🤩','😎','🎭','🔥','💪','✨','💫','🎵','🥳','😈','🦄'];

// ─── State ───────────────────────────────────────────
let socket = null;
let currentScreen = 'landing';
let state = {
  guestId: null,
  guestName: '',
  guestLastName: '',
  guestEmoji: '🎉',
  guestPhoto: null,
  guestPhone: '',
  guestInsta: '',
  partyCode: '',
  currentVote: null,
  selectedGenre: null,
  genreVotes: {},
  trackHistory: [],
  suggestions: [],
  currentTrack: null,
  mode: 'appMix',
  connected: false,
  diapoPhotos: []
};

// ─── DOM Helper ──────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ─── URL Params ──────────────────────────────────────
function getURLParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    code: params.get('code'),
    name: params.get('name'),
    emoji: params.get('emoji')
  };
}

// ─── LocalStorage ────────────────────────────────────
function saveProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({
    firstName: state.guestName,
    lastName: state.guestLastName,
    emoji: state.guestEmoji,
    photo: state.guestPhoto,
    phone: state.guestPhone,
    instagram: state.guestInsta
  }));
}

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (saved) {
      state.guestName = saved.firstName || '';
      state.guestLastName = saved.lastName || '';
      state.guestEmoji = saved.emoji || '🎉';
      state.guestPhoto = saved.photo || null;
      state.guestPhone = saved.phone || '';
      state.guestInsta = saved.instagram || '';
      return true;
    }
  } catch(e) {}
  return false;
}

function saveSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    guestId: state.guestId,
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
      state.partyCode = saved.partyCode || '';
      state.suggestions = saved.suggestions || [];
      state.trackHistory = saved.trackHistory || [];
      return true;
    }
  } catch(e) {}
  return false;
}

// ─── Screen Navigation ──────────────────────────────
function showScreen(name) {
  const previous = document.querySelector('.screen.active');
  const next = $(name + '-screen');
  
  if (previous) previous.classList.remove('active');
  if (next) {
    next.classList.add('active');
    next.scrollTop = 0;
  }
  currentScreen = name;
}

// ═══════════════════════════════════════════
// SCREEN 1: LANDING
// ═══════════════════════════════════════════
function setupLanding() {
  const params = getURLParams();
  
  // Show party name if code in URL
  if (params.code) {
    $('landing-party-name').textContent = `SOIRÉE ${params.code}`;
  }
  
  $('landing-cta').addEventListener('click', () => {
    showScreen('profile');
  });
}

// ═══════════════════════════════════════════
// SCREEN 2: PROFILE
// ═══════════════════════════════════════════
function setupProfile() {
  // Pre-fill if profile exists
  if (state.guestName) $('profile-firstname').value = state.guestName;
  if (state.guestLastName) $('profile-lastname').value = state.guestLastName;
  if (state.guestPhone) $('profile-phone').value = state.guestPhone;
  if (state.guestInsta) $('profile-instagram').value = state.guestInsta;
  if (state.guestPhoto) {
    $('profile-photo-preview').src = state.guestPhoto;
    $('profile-photo-preview').classList.remove('hidden');
    $('photo-placeholder').style.display = 'none';
    $('profile-photo-circle').classList.add('has-photo');
    $('photo-delete').classList.remove('hidden');
  }
  
  // Emoji grid
  setupEmojiGrid();
  
  // Photo handlers
  $('camera-input').addEventListener('change', handlePhotoInput);
  $('gallery-input').addEventListener('change', handlePhotoInput);
  $('photo-delete').addEventListener('click', () => {
    state.guestPhoto = null;
    $('profile-photo-preview').classList.add('hidden');
    $('photo-placeholder').style.display = '';
    $('profile-photo-circle').classList.remove('has-photo');
    $('photo-delete').classList.add('hidden');
  });
  
  // Back
  $('profile-back').addEventListener('click', () => {
    showScreen('landing');
  });
  
  // Save
  $('profile-save').addEventListener('click', () => {
    state.guestName = $('profile-firstname').value.trim() || 'Guest';
    state.guestLastName = $('profile-lastname').value.trim();
    state.guestPhone = $('profile-phone').value.trim();
    state.guestInsta = $('profile-instagram').value.trim();
    saveProfile();
    
    const params = getURLParams();
    if (params.code) {
      state.partyCode = params.code.toUpperCase();
      enterCockpit();
    } else {
      showScreen('code');
    }
  });
}

function handlePhotoInput(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (ev) => {
    // Resize to save localStorage space
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 200;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      
      // Center crop
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      
      state.guestPhoto = canvas.toDataURL('image/jpeg', 0.7);
      $('profile-photo-preview').src = state.guestPhoto;
      $('profile-photo-preview').classList.remove('hidden');
      $('photo-placeholder').style.display = 'none';
      $('profile-photo-circle').classList.add('has-photo');
      $('photo-delete').classList.remove('hidden');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function setupEmojiGrid() {
  const grid = $('emoji-grid');
  grid.innerHTML = '';
  
  EMOJIS.forEach(emoji => {
    const cell = document.createElement('button');
    cell.className = 'emoji-cell' + (state.guestEmoji === emoji ? ' selected' : '');
    cell.textContent = emoji;
    cell.addEventListener('click', () => {
      state.guestEmoji = emoji;
      grid.querySelectorAll('.emoji-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
    });
    grid.appendChild(cell);
  });
}

// ═══════════════════════════════════════════
// SCREEN 3: CODE ENTRY
// ═══════════════════════════════════════════
function setupCodeScreen() {
  $('code-back').addEventListener('click', () => {
    showScreen('profile');
  });
  
  $('code-join-btn').addEventListener('click', () => {
    state.partyCode = $('party-code').value.trim().toUpperCase() || 'TEUF2025';
    enterCockpit();
  });
}

// ═══════════════════════════════════════════
// SCREEN 4: COCKPIT (enter)
// ═══════════════════════════════════════════
function enterCockpit() {
  showScreen('cockpit');
  
  $('greeting').textContent = `Hey ${state.guestName} !`;
  
  setupVoteButtons();
  setupGenreTrends();
  setupSuggest();
  updateHistory();
  
  // Hub buttons
  $('hub-btn').addEventListener('click', () => showScreen('hub'));
  $('hub-card-btn').addEventListener('click', () => showScreen('hub'));
  
  // Quit button → shows modal
  $('quit-btn').addEventListener('click', () => {
    $('exit-modal').classList.remove('hidden');
  });
  
  // Connect
  connectToRelay();
  saveSession();
}

// ─── Socket.IO Connection ────────────────────────────
function connectToRelay() {
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
    
    socket.emit('guest:join', {
      name: state.guestName,
      lastName: state.guestLastName,
      emoji: state.guestEmoji,
      photo: state.guestPhoto,
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
  socket.on('party:state', (ps) => {
    if (ps.currentTrack) { state.currentTrack = ps.currentTrack; updateNowPlaying(ps.currentTrack); }
    if (ps.genreVotes) { state.genreVotes = ps.genreVotes; updateGenreChart(); }
    if (ps.trackHistory) { state.trackHistory = ps.trackHistory; updateHistory(); }
    if (ps.mode) { state.mode = ps.mode; updateDJMode(); }
    if (ps.participants) { updateTrombinoscope(ps.participants); }
    if (ps.photos && ps.photos.length) {
      ps.photos.forEach(p => addDiapoPhoto(p.dataURL, p.guestName));
    }
    saveSession();
  });

  socket.on('track:update', (track) => {
    state.currentTrack = track;
    state.currentVote = null;
    updateNowPlaying(track);
    updateVoteButtons();
    saveSession();
  });

  socket.on('mode:change', (data) => {
    state.mode = data.mode;
    updateDJMode();
  });

  socket.on('votes:update', (data) => {
    state.genreVotes = data.genreVotes || {};
    updateGenreChart();
  });

  socket.on('history:update', (history) => {
    state.trackHistory = history;
    updateHistory();
    saveSession();
  });

  socket.on('vote:received', () => {});

  // Participants list updated (for trombinoscope)
  socket.on('participants:update', (participants) => {
    updateTrombinoscope(participants);
  });

  // Photo shared by another guest (for diapo)
  socket.on('photo:shared', (photo) => {
    addDiapoPhoto(photo.dataURL, photo.guestName);
  });
}

// ─── UI Updates ──────────────────────────────────────
function updateConnection(status, text) {
  const dot = $('conn-dot');
  const txt = $('conn-text');
  dot.className = 'conn-dot ' + (status === 'connected' ? 'connected' : status === 'error' ? 'error' : '');
  txt.textContent = text;
}

function updateNowPlaying(track) {
  if (!track) return;
  $('np-title').textContent = track.title || 'En attente...';
  $('np-artist').textContent = track.artist || '—';
  $('np-bpm').textContent = `${track.bpm || '—'} BPM`;
  $('np-genre').textContent = (track.genre || '—').toUpperCase();
  
  const artworkEl = $('np-artwork');
  if (track.artworkURL) {
    artworkEl.innerHTML = `<img src="${track.artworkURL}" alt="cover">`;
  } else {
    artworkEl.innerHTML = '<span class="np-icon">🎵</span>';
  }
}

function updateDJMode() {
  const banner = $('dj-live-banner');
  if (state.mode === 'djLive') banner.classList.remove('hidden');
  else banner.classList.add('hidden');
}

// ─── Vote Buttons ────────────────────────────────────
function setupVoteButtons() {
  ['meh', 'like', 'fire'].forEach(type => {
    const btn = $(`vote-${type}`);
    // Remove old listeners by cloning
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    newBtn.addEventListener('click', () => {
      if (state.currentVote) return; // Already voted
      state.currentVote = type;
      updateVoteButtons();
      
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
    btn.classList.remove('selected', 'dimmed');
    if (state.currentVote === type) {
      btn.classList.add('selected');
    } else if (state.currentVote) {
      btn.classList.add('dimmed');
    }
  });
}

// ─── Genre Trends ────────────────────────────────────
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
      setupGenreTrends();
      if (socket && socket.connected) {
        socket.emit('guest:genreVote', { genre, guestName: state.guestName, guestId: state.guestId });
      }
    });
    grid.appendChild(btn);
  });
}

function updateGenreChart() {
  const container = $('chart-bars');
  const maxVotes = Math.max(...Object.values(state.genreVotes), 1);
  container.innerHTML = '';
  
  const sorted = Object.entries(state.genreVotes).sort((a,b) => b[1] - a[1]).slice(0, 6);
  
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
  
  if (sorted.length > 0) $('trending-genre').textContent = sorted[0][0];
  setupGenreTrends();
}

// ─── Suggest ─────────────────────────────────────────
function setupSuggest() {
  const input = $('suggest-input');
  const btn = $('suggest-btn');
  
  // Clone to remove old listeners
  const newInput = input.cloneNode(true);
  const newBtn = btn.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);
  newBtn.parentNode || btn.parentNode.replaceChild(newBtn, btn);
  
  const si = $('suggest-input');
  const sb = $('suggest-btn');
  
  si.addEventListener('input', () => { sb.disabled = si.value.trim() === ''; });
  
  sb.addEventListener('click', () => {
    const query = si.value.trim();
    if (!query) return;
    
    state.suggestions.push(query);
    if (socket && socket.connected) {
      socket.emit('guest:suggest', { query, guestName: state.guestName, guestId: state.guestId });
    }
    
    const list = $('suggestions-list');
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.innerHTML = `<span class="suggestion-check">✅</span> ${query} — envoyé`;
    list.appendChild(item);
    
    si.value = '';
    sb.disabled = true;
    saveSession();
  });
}

// ─── History ─────────────────────────────────────────
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

// ═══════════════════════════════════════════
// SCREEN 5: SOCIAL HUB
// ═══════════════════════════════════════════
function setupSocialHub() {
  // Back button
  $('hub-back').addEventListener('click', () => showScreen('cockpit'));
  
  // Populate sections (real data from server, start empty)
  populateTrombinoscope();
  populateEngagement();
  populateKaraoke();
  populateCostumes();
  populateMissions();
  
  // Diapo photo upload
  $('diapo-input').addEventListener('change', handleDiapoPhoto);
}

function populateTrombinoscope() {
  const grid = $('trombi-grid');
  const users = [
    { name: state.guestName || 'Toi', emoji: state.guestEmoji, photo: state.guestPhoto }
  ];
  renderTrombi(grid, users);
}

function updateTrombinoscope(participants) {
  const grid = $('trombi-grid');
  // Merge self + server participants (avoid duplicates)
  const users = [{ name: state.guestName || 'Toi', emoji: state.guestEmoji, photo: state.guestPhoto }];
  participants.forEach(p => {
    if (p.name !== state.guestName) {
      users.push({ name: p.name, emoji: p.emoji || '🎉', photo: p.photo || null });
    }
  });
  renderTrombi(grid, users);
}

function renderTrombi(grid, users) {
  grid.innerHTML = '';
  users.forEach(u => {
    const item = document.createElement('div');
    item.className = 'trombi-item';
    const bgColor = u.photo ? 'transparent' : `rgba(59, 130, 246, 0.3)`;
    const content = u.photo
      ? `<img src="${u.photo}" alt="${u.name}">`
      : u.emoji;
    item.innerHTML = `
      <div class="trombi-avatar" style="background: ${bgColor}">${content}</div>
      <div class="trombi-name">${u.name}</div>
    `;
    grid.appendChild(item);
  });
}

function populateEngagement() {
  // Start with empty data — will be populated from live votes
  const topLiked = [];
  renderRankedList('top-liked', topLiked, '\u{1F525}', 'var(--turquoise)');
  
  const topHated = [];
  renderRankedList('top-hated', topHated, '\u{1F44E}', 'var(--danger)');
  
  // Stats
  $('likers-count').textContent = '0';
  $('haters-count').textContent = '0';
  
  // Active users — empty until guests interact
  const active = [];
  renderUserList('active-users', active, false);
  
  // Ghosts
  const ghosts = [];
  renderUserList('ghost-users', ghosts, true);
}

function renderRankedList(containerId, items, icon, color) {
  const container = $(containerId);
  container.innerHTML = '';
  items.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'ranked-item';
    el.innerHTML = `
      <span class="ranked-num" style="color: ${color}">#${i + 1}</span>
      <div class="ranked-info">
        <div class="ranked-title">${item.title}</div>
        ${item.artist ? `<div class="ranked-subtitle">${item.artist}</div>` : ''}
      </div>
      <div class="ranked-value" style="color: ${color}">
        <span>${icon}</span>
        <span>${item.value}</span>
      </div>
    `;
    container.appendChild(el);
  });
}

function renderUserList(containerId, users, isGhost) {
  const container = $(containerId);
  container.innerHTML = '';
  users.forEach(u => {
    const el = document.createElement('div');
    el.className = 'user-item';
    el.innerHTML = `
      <span class="user-emoji">${u.emoji}</span>
      <span class="user-name" style="${isGhost ? 'color: var(--text-dim)' : ''}">${u.name}</span>
      <span class="user-value ${isGhost ? 'ghost' : ''}">${u.value}</span>
    `;
    container.appendChild(el);
  });
}

function populateKaraoke() {
  // Start empty — populated when guests add songs
  const queue = [];
  const container = $('karaoke-queue');
  container.innerHTML = '<div class="ranked-item" style="opacity: 0.5; justify-content: center;">Aucune chanson en attente</div>';
}

function populateCostumes() {
  // Start empty — populated when costume voting is activated
  const costumes = [];
  const grid = $('costume-grid');
  grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); font-size: 11px; padding: 12px;">Aucun participant pour le moment</div>';
}

function populateMissions() {
  const missions = [
    { icon: '🎤', title: 'Karaoké Master', desc: 'Chante 3 chansons ce soir' },
    { icon: '📸', title: 'Paparazzi', desc: 'Prends 5 photos de la soirée' },
    { icon: '🕺', title: 'Dance Machine', desc: 'Vote pour 10 titres' },
    { icon: '🎭', title: 'Social Butterfly', desc: 'Parle à 5 personnes différentes' },
    { icon: '🏆', title: 'Trendsetter', desc: 'Fais voter ta tendance en n°1' }
  ];
  const list = $('missions-list');
  list.innerHTML = '';
  missions.forEach(m => {
    const item = document.createElement('div');
    item.className = 'mission-item';
    item.innerHTML = `
      <div class="mission-icon">${m.icon}</div>
      <div class="mission-info">
        <div class="mission-title">${m.title}</div>
        <div class="mission-desc">${m.desc}</div>
      </div>
      <button class="mission-check" onclick="this.classList.toggle('done'); this.textContent = this.classList.contains('done') ? '✓' : ''">
      </button>
    `;
    list.appendChild(item);
  });
}

function handleDiapoPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataURL = ev.target.result;
    state.diapoPhotos.push(dataURL);
    addDiapoPhoto(dataURL, state.guestName);
    
    // Emit to server for broadcast to other guests
    if (socket && socket.connected) {
      socket.emit('guest:photo', {
        dataURL: dataURL,
        guestName: state.guestName
      });
    }
  };
  reader.readAsDataURL(file);
}

function addDiapoPhoto(dataURL, guestName) {
  const grid = $('diapo-grid');
  const thumb = document.createElement('div');
  thumb.className = 'diapo-thumb';
  thumb.innerHTML = `<img src="${dataURL}" alt="photo de ${guestName || 'guest'}">`;
  grid.appendChild(thumb);
}

// ═══════════════════════════════════════════
// EXIT MODAL
// ═══════════════════════════════════════════
function setupExitModal() {
  $('modal-stay').addEventListener('click', () => {
    $('exit-modal').classList.add('hidden');
  });
  
  $('modal-hub').addEventListener('click', () => {
    $('exit-modal').classList.add('hidden');
    showScreen('hub');
  });
  
  $('modal-leave').addEventListener('click', () => {
    $('exit-modal').classList.add('hidden');
    quitParty();
  });
}

function quitParty() {
  if (socket) { socket.disconnect(); socket = null; }
  localStorage.removeItem(STORAGE_KEY);
  
  // Reset all state
  state.partyCode = '';
  state.currentVote = null;
  state.selectedGenre = null;
  state.genreVotes = {};
  state.trackHistory = [];
  state.suggestions = [];
  state.currentTrack = null;
  state.mode = 'appMix';
  state.connected = false;
  
  // Also clear profile for clean restart
  state.guestName = '';
  state.guestEmoji = '';
  state.guestPhoto = null;
  localStorage.removeItem('socialmix-profile');
  
  // Reset cockpit UI
  $('np-title').textContent = 'En attente...';
  $('np-artist').textContent = '—';
  $('np-bpm').textContent = '— BPM';
  $('np-genre').textContent = '—';
  const vinylLabel = $('vinyl-label');
  if (vinylLabel) vinylLabel.innerHTML = '<span class="vinyl-note">♪</span>';
  $('vote-status').textContent = '';
  $('suggestions-list').innerHTML = '';
  $('dj-live-banner').classList.add('hidden');
  
  showScreen('landing');
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
function init() {
  const hasProfile = loadProfile();
  const hasSession = loadSession();
  const params = getURLParams();
  
  // Apply URL params
  if (params.name) state.guestName = params.name;
  if (params.emoji) state.guestEmoji = params.emoji;
  if (params.code) state.partyCode = params.code.toUpperCase();
  
  // Setup all screens
  setupLanding();
  setupProfile();
  setupCodeScreen();
  setupSocialHub();
  setupExitModal();
  
  // Auto-rejoin if session + profile exist
  if (hasSession && hasProfile && state.partyCode && state.guestName) {
    enterCockpit();
  } else {
    showScreen('landing');
  }
}

document.addEventListener('DOMContentLoaded', init);
