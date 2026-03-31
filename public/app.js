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
  guestEmail: '',
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
  diapoPhotos: [],
  allVotes: []
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
    email: state.guestEmail,
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
      state.guestEmail = saved.email || saved.phone || '';
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
  
  // Re-bind event handlers when hub screen opens
  if (name === 'hub') {
    bindCostumeButton();
    populateMissions();
    updateMyPhotosGrid();
  }
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
  if (state.guestEmail) $('profile-email').value = state.guestEmail;
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
    if (state.editingFromCockpit) {
      state.editingFromCockpit = false;
      showScreen('cockpit');
    } else {
      showScreen('landing');
    }
  });
  
  // Save
  $('profile-save').addEventListener('click', () => {
    state.guestName = $('profile-firstname').value.trim() || 'Guest';
    state.guestLastName = $('profile-lastname').value.trim();
    state.guestEmail = $('profile-email').value.trim();
    state.guestInsta = $('profile-instagram').value.trim();
    saveProfile();
    
    if (state.editingFromCockpit) {
      // Return to cockpit and update greeting
      state.editingFromCockpit = false;
      showScreen('cockpit');
      $('greeting').textContent = `Hey ${state.guestName} !`;
      // Re-emit join with updated profile
      if (socket && socket.connected) {
        socket.emit('guest:join', {
          name: state.guestName,
          emoji: state.guestEmoji,
          photo: state.guestPhoto,
          partyCode: state.partyCode
        });
      }
    } else {
      const params = getURLParams();
      if (params.code) {
        state.partyCode = params.code.toUpperCase();
        enterCockpit();
      } else {
        showScreen('code');
      }
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
  
  // Profile edit button → go to profile screen for editing
  $('edit-profile-btn').addEventListener('click', () => {
    state.editingFromCockpit = true;
    showScreen('profile');
    setupProfile();
  });
  
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

  // Party ended — show end screen with hub as final page
  socket.on('party:ended', (data) => {
    const reason = (data && data.reason) || '🎉 La soirée est terminée !';
    const scores = (data && data.scores) || {};
    
    // Build score leaderboard
    const sortedScores = Object.values(scores).sort((a, b) => b.score - a.score);
    let leaderboard = '';
    const medals = ['🥇', '🥈', '🥉'];
    sortedScores.forEach((p, i) => {
      const medal = medals[i] || `#${i + 1}`;
      leaderboard += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(255,255,255,0.05);border-radius:10px;margin-bottom:4px">
        <span style="font-size:14px;font-weight:700;color:white">${medal} ${p.name}</span>
        <span style="font-size:13px;font-weight:800;color:var(--turquoise)">${p.score} pts <span style="font-size:10px;color:var(--text-dim)">(${p.voteCount} votes)</span></span>
      </div>`;
    });
    
    // Build gallery photos
    const photos = (data && data.photos) || [];
    let galleryHTML = '';
    if (photos.length) {
      galleryHTML = `
        <div class="card" style="width:100%;max-width:340px;margin-bottom:12px">
          <div style="font-size:10px;font-weight:800;color:var(--turquoise);letter-spacing:1px;margin-bottom:8px">📸 PHOTOS DE LA SOIRÉE</div>
          <div class="gallery-grid">${photos.map(p => `<img src="${p.dataURL}" alt="${p.guestName}" style="border-radius:8px">`).join('')}</div>
        </div>`;
    }
    
    // Show end screen with hub
    const cockpit = $('cockpit-screen');
    cockpit.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;padding:24px;text-align:center;overflow-y:auto;max-height:100vh">
        <div style="font-size:60px;margin-bottom:12px">🎉</div>
        <h2 style="color:white;font-size:24px;font-weight:900;margin-bottom:2px">LA SOIRÉE EST TERMINÉE</h2>
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:20px">${reason}</p>
        
        ${sortedScores.length ? `
          <div class="card" style="width:100%;max-width:340px;margin-bottom:12px">
            <div style="font-size:10px;font-weight:800;color:var(--turquoise);letter-spacing:1px;margin-bottom:10px">🏆 CLASSEMENT DES PARTICIPANTS</div>
            ${leaderboard}
          </div>
        ` : ''}
        
        ${galleryHTML}
        
        <button onclick="showScreen('landing');sessionStorage.clear()" class="join-btn" style="width:100%;max-width:300px;margin-top:12px">QUITTER</button>
        <div style="height:40px"></div>
      </div>`;
    showScreen('cockpit');
  });
  
  // Live score updates
  socket.on('scores:update', (scores) => {
    state.participantScores = scores;
  });

  // Wrong party code
  socket.on('party:wrongCode', (data) => {
    alert(`⛔ ${data?.message || 'Code de soirée incorrect. Vérifie le QR code.'}`);
    showScreen('landing');
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
    setupGenreTrends();   // refresh genre button grid with new counts
    updateGenreChart();   // refresh chart bars + trending badge
  });

  socket.on('history:update', (history) => {
    state.trackHistory = history;
    updateHistory();
    saveSession();
  });

  socket.on('vote:received', (data) => {
    state.allVotes.push(data);
    updateEngagementFromVotes();
  });

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
        const voteData = {
          type,
          guestId: state.guestId,
          guestName: state.guestName,
          trackId: state.currentTrack?.title || 'current',
          trackTitle: state.currentTrack?.title || 'Titre en cours'
        };
        socket.emit('guest:vote', voteData);
        // Track own vote for engagement dashboard
        state.allVotes.push(voteData);
        updateEngagementFromVotes();
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
    const isSelected = state.selectedGenre === genre;
    btn.className = 'genre-btn' + (isSelected ? ' selected' : '');
    btn.innerHTML = `
      <div class="genre-name">${genre}</div>
      <div class="genre-count">${state.genreVotes[genre] || 0} votes</div>
    `;
    btn.addEventListener('click', () => {
      const previousGenre = state.selectedGenre;
      
      // Toggle off if same genre, otherwise select new
      if (state.selectedGenre === genre) {
        state.selectedGenre = null;
      } else {
        state.selectedGenre = genre;
      }
      
      // Update UI highlight only (counts come from server)
      setupGenreTrends();
      
      // Server handles all counting
      if (socket && socket.connected) {
        socket.emit('guest:genreVote', { 
          genre: state.selectedGenre,       // null = cancel
          previousGenre: previousGenre,     // what to decrement
          guestName: state.guestName, 
          guestId: state.guestId 
        });
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
  const diapoInput = $('diapo-input');
  if (diapoInput) {
    diapoInput.addEventListener('change', handleDiapoPhoto);
    console.log('[SocialHub] Photo input bound');
  } else {
    console.error('[SocialHub] diapo-input not found!');
  }
}

function populateTrombinoscope() {
  const grid = $('trombi-grid');
  const users = [
    { name: state.guestName || 'Toi', emoji: state.guestEmoji, photo: state.guestPhoto }
  ];
  renderTrombi(grid, users);
}

function updateTrombinoscope(participants) {
  // Only re-render if participants actually changed (prevents flicker)
  const key = participants.map(p => p.name).sort().join(',');
  if (state._lastTrombiKey === key) return;
  state._lastTrombiKey = key;
  
  state.participants = participants;
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
  updateEngagementFromVotes();
}

function updateEngagementFromVotes() {
  // Build per-track vote counts from state
  const trackFires = {};
  const trackMehs = {};
  const userVoteCounts = {};
  
  // Count votes from guestVotes stored on server state
  if (state.allVotes && state.allVotes.length) {
    state.allVotes.forEach(v => {
      const title = v.trackTitle || v.trackId || 'Unknown';
      if (v.type === 'fire') trackFires[title] = (trackFires[title] || 0) + 1;
      if (v.type === 'meh') trackMehs[title] = (trackMehs[title] || 0) + 1;
      userVoteCounts[v.guestName || 'Guest'] = (userVoteCounts[v.guestName || 'Guest'] || 0) + 1;
    });
  }
  
  // Top Liked
  const topLiked = Object.entries(trackFires)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([title, count]) => ({ title, count }));
  renderRankedList('top-liked', topLiked, '\u{1F525}', 'var(--turquoise)');
  
  // Top Hated
  const topHated = Object.entries(trackMehs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([title, count]) => ({ title, count }));
  renderRankedList('top-hated', topHated, '\u{1F44E}', 'var(--danger)');
  
  // Stats
  const el1 = $('likers-count');
  const el2 = $('haters-count');
  if (el1) el1.textContent = Object.values(trackFires).reduce((a, b) => a + b, 0);
  if (el2) el2.textContent = Object.values(trackMehs).reduce((a, b) => a + b, 0);
  
  // Active users
  const active = Object.entries(userVoteCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, votes]) => ({ name, votes, emoji: '🕺' }));
  renderUserList('active-users', active, false);
  
  // Ghosts — empty for now
  renderUserList('ghost-users', [], true);
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
        <span>${item.count || item.value}</span>
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
  state.costumeEntries = state.costumeEntries || [];
  state.costumeVoted = state.costumeVoted || null;
  state.costumeRegistered = state.costumeRegistered || false;
  state.myPhotos = state.myPhotos || [];
  
  bindCostumeButton();
  
  // Listen for costume entries from server
  if (socket) {
    socket.on('costume:entries', (entries) => {
      state.costumeEntries = entries;
      renderCostumeEntries();
    });
  }
  
  renderCostumeEntries();
}

function bindCostumeButton() {
  const enterBtn = $('costume-enter-btn');
  if (!enterBtn) {
    console.error('[Costume] Button #costume-enter-btn not found!');
    return;
  }
  console.log('[Costume] Binding button, registered:', state.costumeRegistered);
  
  if (state.costumeRegistered) {
    enterBtn.textContent = '✅ INSCRIT !';
    enterBtn.style.opacity = '0.6';
    enterBtn.style.pointerEvents = 'none';
    return;
  }
  
  // Remove old handlers and rebind
  enterBtn.style.opacity = '1';
  enterBtn.style.pointerEvents = 'auto';
  enterBtn.onclick = function() {
    console.log('[Costume] Button clicked!');
    if (state.costumeRegistered) return;
    state.costumeRegistered = true;
    
    enterBtn.textContent = '✅ INSCRIT !';
    enterBtn.style.opacity = '0.6';
    enterBtn.style.pointerEvents = 'none';
    
    const myEntry = {
      guestName: state.guestName,
      guestId: state.guestId,
      emoji: state.guestEmoji,
      votes: 0
    };
    state.costumeEntries = (state.costumeEntries || []).filter(e => e.guestId !== state.guestId);
    state.costumeEntries.push(myEntry);
    renderCostumeEntries();
    saveSession();
    
    if (socket && socket.connected) {
      socket.emit('costume:enter', {
        guestName: state.guestName,
        guestId: state.guestId,
        emoji: state.guestEmoji
      });
    }
  };
}

function renderCostumeEntries() {
  const grid = $('costume-grid');
  const entries = state.costumeEntries || [];
  
  if (!entries.length) {
    grid.innerHTML = '<div style="text-align: center; color: var(--text-dim); font-size: 11px; padding: 16px;">⏳ En attente de participants...</div>';
    return;
  }
  
  grid.innerHTML = '';
  entries.forEach(entry => {
    const card = document.createElement('div');
    const isVoted = state.costumeVoted === entry.guestId;
    const isMe = entry.guestId === state.guestId;
    card.className = 'costume-card' + (isVoted ? ' voted' : '');
    card.innerHTML = `
      <div class="costume-photo-wrap${isVoted ? ' selected' : ''}">
        ${entry.photo ? `<img src="${entry.photo}" alt="${entry.guestName}" class="costume-photo">` : `<div class="costume-emoji">${entry.emoji || '🎭'}</div>`}
      </div>
      <div class="costume-name">${entry.guestName}${isMe ? ' (toi)' : ''}</div>
      <div class="costume-votes">${entry.votes || 0} ❤️</div>
    `;
    
    // Click photo to vote (not on self)
    if (!isMe && !state.costumeVoted) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        state.costumeVoted = entry.guestId;
        if (socket && socket.connected) {
          socket.emit('costume:vote', {
            voterId: state.guestId,
            voterName: state.guestName,
            targetId: entry.guestId,
            targetName: entry.guestName
          });
        }
        renderCostumeEntries();
      });
    }
    grid.appendChild(card);
  });
  
  // Render podium (top 3 sorted by votes)
  renderCostumePodium(entries);
}

function renderCostumePodium(entries) {
  const podium = $('costume-podium');
  if (!podium) return;
  const sorted = [...entries].filter(e => (e.votes || 0) > 0).sort((a, b) => (b.votes || 0) - (a.votes || 0));
  if (!sorted.length) {
    podium.innerHTML = '<div style="text-align:center; color:var(--text-dim); font-size:11px; padding:12px;">Pas encore de votes</div>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  podium.innerHTML = '';
  sorted.slice(0, 3).forEach((entry, i) => {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px 12px; background:rgba(255,255,255,0.05); border-radius:10px; margin-bottom:4px;';
    el.innerHTML = `
      <span style="font-size:18px;">${medals[i] || ''}</span>
      <span style="font-size:14px;">${entry.emoji || '🎭'}</span>
      <span style="font-size:12px; font-weight:700; color:white; flex:1;">${entry.guestName}</span>
      <span style="font-size:12px; font-weight:800; color:#bb86fc;">${entry.votes || 0} ❤️</span>
    `;
    podium.appendChild(el);
  });
}

function populateMissions() {
  const voteCount = (state.allVotes || []).length;
  const photoCount = (state.myPhotos || []).length;
  const genreVoted = state.selectedGenre ? 1 : 0;
  const costumeJoined = state.costumeRegistered ? 1 : 0;
  
  const missions = [
    {
      icon: '📸', title: 'PAPARAZZI',
      desc: 'Capture les meilleurs moments ! Prends des photos via le Social Hub pour alimenter le diaporama de la soirée.',
      target: 5, current: photoCount, unit: 'photos',
      reward: '+50 pts'
    },
    {
      icon: '🕺', title: 'DANCE MACHINE',
      desc: 'Fais entendre ta voix ! Vote BOF, TOP ou LE FEU sur les titres du DJ pour influencer le mix.',
      target: 10, current: voteCount, unit: 'votes',
      reward: '+100 pts'
    },
    {
      icon: '🎯', title: 'TRENDSETTER',
      desc: 'Vote pour une tendance musicale dans VOTE TENDANCE. Si ton genre devient majoritaire, le DJ jouera ton style !',
      target: 1, current: genreVoted, unit: 'tendance',
      reward: '+30 pts'
    },
    {
      icon: '🎭', title: 'SHOWMAN',
      desc: 'Inscris-toi au Concours Déguisement dans le Social Hub et fais voter les autres pour toi !',
      target: 1, current: costumeJoined, unit: 'inscription',
      reward: '+40 pts'
    },
    {
      icon: '🔥', title: 'PYROMANE',
      desc: 'Deviens le guest le plus actif de la soirée ! Cumule votes, photos et tendances pour dominer le classement.',
      target: 20, current: voteCount + photoCount + genreVoted, unit: 'actions',
      reward: '+200 pts'
    }
  ];
  const list = $('missions-list');
  list.innerHTML = '';
  missions.forEach(m => {
    const progress = Math.min(100, Math.round((m.current / m.target) * 100));
    const done = m.current >= m.target;
    const item = document.createElement('div');
    item.className = 'mission-item';
    item.style.cssText = 'display:flex; gap:12px; align-items:flex-start; padding:12px; background:rgba(255,255,255,0.03); border-radius:12px; margin-bottom:8px;';
    item.innerHTML = `
      <div style="font-size:24px; flex-shrink:0; width:36px; text-align:center;">${done ? '✅' : m.icon}</div>
      <div style="flex:1; min-width:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-size:11px; font-weight:800; color:${done ? '#00e0c4' : 'white'}; letter-spacing:0.5px;">${m.title}</span>
          <span style="font-size:9px; font-weight:700; color:#ffc107; background:rgba(255,193,7,0.1); padding:2px 8px; border-radius:8px;">${m.reward}</span>
        </div>
        <div style="font-size:10px; color:rgba(255,255,255,0.5); line-height:1.4; margin-bottom:6px;">${m.desc}</div>
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="flex:1; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;">
            <div style="width:${progress}%; height:100%; background:${done ? '#00e0c4' : 'linear-gradient(90deg,#00d2ff,#8a2be2)'}; border-radius:2px; transition:width 0.5s ease;"></div>
          </div>
          <span style="font-size:9px; font-weight:700; color:${done ? '#00e0c4' : 'var(--text-dim)'}; white-space:nowrap;">${m.current}/${m.target}</span>
        </div>
      </div>
    `;
    list.appendChild(item);
  });
}

function handleDiapoPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  console.log('[Photo] File selected:', file.name, file.size, 'bytes');
  
  // Reset input so same photo can be re-selected
  e.target.value = '';
  
  // Initialize myPhotos if needed
  state.myPhotos = state.myPhotos || [];
  state.diapoPhotos = state.diapoPhotos || [];
  
  // Show loading feedback
  const grid = $('diapo-grid');
  const loadingEl = document.createElement('div');
  loadingEl.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(0,224,196,0.1);border-radius:8px;aspect-ratio:1;font-size:20px;';
  loadingEl.textContent = '⏳';
  if (grid) grid.appendChild(loadingEl);
  
  // Resize image via Canvas (max 800px, JPEG 70%)
  resizeImage(file, 800, 0.7, (dataURL) => {
    // Remove loading indicator
    if (loadingEl.parentNode) loadingEl.remove();
    
    if (!dataURL) {
      console.error('[Photo] Failed to resize photo');
      alert('❌ Erreur lors du traitement de la photo');
      return;
    }
    
    console.log('[Photo] Resized OK, dataURL length:', dataURL.length);
    
    state.diapoPhotos.push(dataURL);
    state.myPhotos.push(dataURL);
    addDiapoPhoto(dataURL, state.guestName);
    updateMyPhotosGrid();
    saveSession();
    
    // Emit to server for host slideshow + other guests
    if (socket && socket.connected) {
      socket.emit('guest:photo', {
        dataURL: dataURL,
        guestName: state.guestName
      });
      console.log('[Photo] Emitted to server');
    } else {
      console.warn('[Photo] Socket not connected, photo not sent to server');
    }
  });
}

function updateMyPhotosGrid() {
  const grid = $('my-photos-grid');
  const empty = $('my-photos-empty');
  if (!grid) return;
  const photos = state.myPhotos || [];
  if (!photos.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  // Build grid (don't re-render existing)
  grid.innerHTML = '';
  photos.forEach(dataURL => {
    const img = document.createElement('img');
    img.src = dataURL;
    img.alt = 'Ma photo';
    img.style.cssText = 'width:100%; border-radius:8px; aspect-ratio:1; object-fit:cover;';
    grid.appendChild(img);
  });
  grid.className = 'gallery-grid';
}

function resizeImage(file, maxSize, quality, callback) {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    let w = img.width, h = img.height;
    if (w > h) {
      if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
    } else {
      if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const dataURL = canvas.toDataURL('image/jpeg', quality);
    URL.revokeObjectURL(img.src);
    callback(dataURL);
  };
  img.onerror = () => {
    URL.revokeObjectURL(img.src);
    callback(null);
  };
  img.src = URL.createObjectURL(file);
}

function addDiapoPhoto(dataURL, guestName) {
  const grid = $('diapo-grid');
  const img = document.createElement('img');
  img.src = dataURL;
  img.alt = `photo de ${guestName || 'guest'}`;
  img.style.borderRadius = '8px';
  // Click to save
  img.addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = `socialmix_${guestName || 'photo'}_${Date.now()}.jpg`;
    link.click();
  });
  grid.appendChild(img);
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
  } else if (params.code && hasProfile && state.guestName) {
    // QR scan with existing profile → skip to cockpit directly
    enterCockpit();
  } else if (params.code) {
    // QR scan, no profile yet → skip landing, go to profile
    showScreen('profile');
  } else {
    showScreen('landing');
  }
}

document.addEventListener('DOMContentLoaded', init);
