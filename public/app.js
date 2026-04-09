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
    phone: state.guestPhone,
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
      state.guestPhone = saved.phone || '';
      state.guestEmail = saved.email || '';
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
  
  // Show/hide scroll indicator only on profile screen
  const scrollInd = $('scroll-indicator');
  if (scrollInd) scrollInd.style.display = (name === 'profile') ? 'flex' : 'none';
  
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
  if (state.guestPhone) $('profile-phone').value = state.guestPhone;
  if (state.guestEmail) $('profile-email').value = state.guestEmail;
  if (state.guestInsta) $('profile-instagram').value = state.guestInsta;
  
  // Hide scroll indicator on scroll
  const profileScreen = $('profile-screen');
  if (profileScreen) {
    profileScreen.addEventListener('scroll', () => {
      const ind = $('scroll-indicator');
      if (ind && profileScreen.scrollTop > 50) ind.style.opacity = '0';
      else if (ind) ind.style.opacity = '1';
    });
  }
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
    state.guestPhone = $('profile-phone').value.trim();
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
  
  // Hub buttons (top + bottom)
  $('hub-top-btn').addEventListener('click', () => showScreen('hub'));
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
      phone: state.guestPhone,
      email: state.guestEmail,
      instagram: state.guestInsta,
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
      // Clear diapo grid and rebuild from server (single source of truth)
      const grid = $('diapo-grid');
      if (grid) grid.innerHTML = '';
      state.diapoPhotos = new Set();
      ps.photos.forEach(p => {
        const key = (p.dataURL || '').substring(0, 100);
        if (!state.diapoPhotos.has(key)) {
          addDiapoPhoto(p.dataURL, p.guestName);
        }
      });
      // Also add my own photos that might not be on server yet
      (state.myPhotos || []).forEach(url => {
        const key = (url || '').substring(0, 100);
        if (!state.diapoPhotos.has(key)) {
          addDiapoPhoto(url, state.guestName);
        }
      });
    }
    // Costume contest entries: sync from server on join
    if (ps.costumeEntries && ps.costumeEntries.length) {
      state.costumeEntries = ps.costumeEntries;
      renderCostumeEntries();
    }
    saveSession();
  });

  // Party ended — show end screen with hub as final page
  socket.on('party:ended', (data) => {
    const reason = (data && data.reason) || '🎉 La soirée est terminée !';
    const scores = (data && data.scores) || {};
    const photos = (data && data.photos) || [];
    const participants = (data && data.participants) || state.participants || [];
    
    // Build score leaderboard
    const sortedScores = Object.values(scores).sort((a, b) => b.score - a.score);
    const medals = ['🥇', '🥈', '🥉'];
    let leaderboard = sortedScores.map((p, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(255,255,255,0.05);border-radius:10px;margin-bottom:4px">
        <span style="font-size:14px;font-weight:700;color:white">${medals[i] || '#'+(i+1)} ${p.name}</span>
        <span style="font-size:13px;font-weight:800;color:var(--turquoise)">${p.score} pts</span>
      </div>`).join('');
    
    // Build trombinoscope
    let trombiHTML = '';
    if (participants.length) {
      trombiHTML = participants.map((p, pidx) => {
        const shortName = (p.name || 'Guest').length > 6 ? (p.name || 'Guest').substring(0, 6) + '…' : (p.name || 'Guest');
        const avatarContent = p.photo
          ? `<img src="${p.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;">`
          : `<span style="font-size:28px;">${p.emoji || '🎉'}</span>`;
        return `
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer" onclick="showEndContactCard(${pidx})">
            <div style="width:56px;height:56px;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:rgba(59,130,246,0.2);border:2px solid rgba(0,224,196,0.3);">${avatarContent}</div>
            <div style="font-size:9px;font-weight:700;color:white;">${shortName}</div>
          </div>`;
      }).join('');
    }
    
    // Store participants globally for contact card access
    window._endPartyParticipants = participants;
    
    // Build photo gallery with selection checkboxes
    let galleryHTML = '';
    if (photos.length) {
      galleryHTML = photos.map((p, i) => `
        <div style="position:relative;" data-photo-idx="${i}">
          <img src="${p.dataURL}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;border:2px solid rgba(255,255,255,0.1);cursor:pointer" onclick="showEndPhotoLightbox('${i}')">
          <div class="end-photo-check" onclick="event.stopPropagation();toggleEndPhotoSelect(${i})" style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:6px;border:2px solid rgba(255,255,255,0.4);background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;"></div>
          <div style="font-size:8px;font-weight:700;color:rgba(255,255,255,0.5);text-align:center;margin-top:2px;">${(p.guestName || 'Guest').substring(0, 8)}</div>
        </div>`).join('');
    }
    
    // Store photos globally for lightbox access
    window._endPartyPhotos = photos;
    
    // Build favorite tracks (tracks user voted 🔥 on)
    const trackHistory = (data && data.trackHistory) || state.trackHistory || [];
    const myFires = (state.allVotes || []).filter(v => v.type === 'fire' && v.guestName === state.guestName);
    const fireTrackTitles = [...new Set(myFires.map(v => v.trackTitle))];
    const favTracks = trackHistory.filter(t => fireTrackTitles.includes(t.title));
    
    let favTracksHTML = '';
    if (favTracks.length) {
      favTracksHTML = favTracks.map(t => {
        const q = encodeURIComponent(`${t.artist} ${t.title}`);
        const genreBadge = t.genre ? `<span style="font-size:8px;font-weight:700;color:#00d2ff;background:rgba(0,210,255,0.1);padding:1px 5px;border-radius:4px;">${t.genre}</span>` : '';
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.03);border-radius:10px;margin-bottom:4px;">
            <span style="font-size:18px;">🔥</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:800;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.title} ${genreBadge}</div>
              <div style="font-size:10px;color:var(--text-dim);">${t.artist}</div>
            </div>
            <a href="https://open.spotify.com/search/${q}" target="_blank" style="font-size:9px;font-weight:700;color:#1DB954;text-decoration:none;">Spotify</a>
          </div>`;
      }).join('');
    }
    
    const cockpit = $('cockpit-screen');
    cockpit.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;padding:20px;text-align:center;overflow-y:auto;max-height:100vh;-webkit-overflow-scrolling:touch">
        <div style="font-size:50px;margin-bottom:8px">🎉</div>
        <h2 style="color:white;font-size:22px;font-weight:900;margin-bottom:2px">SOIRÉE TERMINÉE</h2>
        <p style="color:var(--text-dim);font-size:12px;margin-bottom:16px">${reason}</p>
        
        ${sortedScores.length ? `
          <div class="card" style="width:100%;max-width:340px;margin-bottom:12px">
            <div style="font-size:10px;font-weight:800;color:var(--turquoise);letter-spacing:1px;margin-bottom:10px">🏆 CLASSEMENT</div>
            ${leaderboard}
          </div>` : ''}
        
        ${favTracksHTML ? `
          <div class="card" style="width:100%;max-width:340px;margin-bottom:12px">
            <div style="font-size:10px;font-weight:800;color:var(--turquoise);letter-spacing:1px;margin-bottom:10px">🎵 MES TITRES PRÉFÉRÉS</div>
            ${favTracksHTML}
          </div>` : ''}
        
        ${trombiHTML ? `
          <div class="card" style="width:100%;max-width:340px;margin-bottom:12px">
            <div style="font-size:10px;font-weight:800;color:var(--turquoise);letter-spacing:1px;margin-bottom:10px">👥 PARTICIPANTS</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">${trombiHTML}</div>
            <div style="font-size:9px;color:var(--text-dim);margin-top:8px">Tape un nom pour ajouter à tes contacts</div>
          </div>` : ''}
        
        ${galleryHTML ? `
          <div class="card" style="width:100%;max-width:340px;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <div style="font-size:10px;font-weight:800;color:var(--turquoise);letter-spacing:1px;">📸 PHOTOS (${photos.length})</div>
              <button onclick="toggleSelectAllEndPhotos()" style="font-size:9px;font-weight:700;color:#00d2ff;background:rgba(0,210,255,0.1);border:1px solid rgba(0,210,255,0.2);border-radius:6px;padding:3px 8px;cursor:pointer;">☑ TOUT SÉLEC.</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px" id="end-photo-grid">${galleryHTML}</div>
            <button id="end-batch-download" onclick="downloadSelectedEndPhotos()" style="display:none;width:100%;margin-top:8px;padding:8px;background:linear-gradient(135deg,#00c853,#00bfa5);border:none;border-radius:10px;font-size:11px;font-weight:800;color:#0a0e1a;cursor:pointer;">💾 TÉLÉCHARGER LA SÉLECTION</button>
          </div>` : ''}
        
        <button onclick="showScreen('landing');sessionStorage.clear()" class="join-btn" style="width:100%;max-width:300px;margin-top:12px">QUITTER</button>
        
        <div style="margin-top:16px;padding:14px 20px;background:linear-gradient(135deg,rgba(0,210,255,0.08),rgba(138,43,226,0.06));border:1px solid rgba(0,210,255,0.15);border-radius:12px;width:100%;max-width:300px;text-align:center;">
          <div style="font-size:20px;margin-bottom:4px;">📱</div>
          <div style="font-size:11px;font-weight:800;color:white;margin-bottom:2px;">TÉLÉCHARGE L'APP</div>
          <div style="font-size:9px;color:var(--text-dim);margin-bottom:8px;">Garde un accès à tes soirées Social Mix</div>
          <button onclick="alert('Bientôt disponible sur l\\'App Store ! 🎧')" style="padding:8px 20px;background:linear-gradient(135deg,#00d2ff,#8a2be2);border:none;border-radius:10px;font-size:11px;font-weight:800;color:white;cursor:pointer;">🍎 DISPONIBLE BIENTÔT</button>
        </div>
        
        <div style="height:40px"></div>
      </div>
      
      <!-- Contact card overlay -->
      <div id="end-contact-card" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:20px" onclick="this.style.display='none'">
        <div id="end-contact-emoji" style="font-size:60px"></div>
        <div id="end-contact-name" style="font-size:22px;font-weight:900;color:white"></div>
        <button id="end-contact-btn" style="padding:10px 24px;background:linear-gradient(135deg,#00e0c4,#00b8a9);border:none;border-radius:10px;font-size:12px;font-weight:800;color:#0a0e1a;cursor:pointer" onclick="event.stopPropagation()">📇 AJOUTER AUX CONTACTS</button>
        <div onclick="event.stopPropagation();this.parentElement.style.display='none'" style="margin-top:8px;font-size:11px;font-weight:800;color:rgba(255,255,255,0.4);cursor:pointer">✕ FERMER</div>
      </div>
      
      <!-- Photo lightbox overlay -->
      <div id="end-photo-lightbox" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.92);z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:14px;padding:20px" onclick="this.style.display='none'">
        <img id="end-photo-img" style="max-width:90%;max-height:60vh;border-radius:14px;border:2px solid rgba(0,224,196,0.3)">
        <div id="end-photo-author" style="font-size:12px;font-weight:700;color:var(--text-dim)"></div>
        <button id="end-photo-save" style="padding:10px 24px;background:linear-gradient(135deg,#00c853,#00bfa5);border:none;border-radius:10px;font-size:12px;font-weight:800;color:#0a0e1a;cursor:pointer" onclick="event.stopPropagation()">💾 ENREGISTRER</button>
        <div onclick="event.stopPropagation();this.parentElement.style.display='none'" style="margin-top:4px;font-size:11px;font-weight:800;color:rgba(255,255,255,0.4);cursor:pointer">✕ FERMER</div>
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

  // Costume entries updated from server
  socket.on('costume:entries', (entries) => {
    state.costumeEntries = entries;
    renderCostumeEntries();
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
  
  // Album artwork (from Shazam)
  const artworkEl = $('np-artwork');
  const vinylLabel = $('vinyl-label');
  if (track.artworkURL) {
    artworkEl.innerHTML = `<img src="${track.artworkURL}" style="width:100%;height:100%;object-fit:cover;">`;
    artworkEl.style.display = 'block';
    // Also show in vinyl center
    vinylLabel.innerHTML = `<img src="${track.artworkURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  } else {
    artworkEl.style.display = 'none';
    artworkEl.innerHTML = '';
    vinylLabel.innerHTML = '<span class="vinyl-note">♪</span>';
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
        populateMissions(); // refresh mission progress
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
      populateMissions(); // refresh mission progress
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
    const genreBadge = track.genre ? `<span style="font-size:8px;font-weight:700;color:#00d2ff;background:rgba(0,210,255,0.1);padding:1px 6px;border-radius:4px;margin-left:6px;">${track.genre}</span>` : '';
    
    item.innerHTML = `
      <span class="history-num">${i + 1}</span>
      <div class="history-info">
        <div class="history-title">${track.title}${genreBadge}</div>
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
  
  // Gallery photo: same binding pattern as costume (which works!)
  const galleryInput = $('gallery-photo-input');
  if (galleryInput) {
    galleryInput.onchange = handleGalleryPhoto;
    console.log('[SocialHub] Gallery photo input bound to handleGalleryPhoto');
  }
  
  // Camera photo input (direct camera capture)
  const cameraInput = $('camera-photo-input');
  if (cameraInput) {
    cameraInput.onchange = handleGalleryPhoto;
    console.log('[SocialHub] Camera photo input bound');
  }
  
  // Send message button
  const sendBtn = $('send-message-btn');
  const msgInput = $('guest-message-input');
  if (sendBtn && msgInput) {
    const doSend = () => {
      const message = msgInput.value.trim();
      if (!message) return;
      if (socket && socket.connected) {
        socket.emit('guest:message', {
          guestName: state.guestName || 'Guest',
          message: message
        });
        console.log('[Message] Sent:', message);
        msgInput.value = '';
        // Visual feedback
        sendBtn.textContent = '✅ ENVOYÉ !';
        setTimeout(() => { sendBtn.textContent = '📤 ENVOYER'; }, 1500);
      } else {
        alert('❌ Connexion perdue. Recharge la page.');
      }
    };
    // Both click AND touchend for iOS Safari compatibility
    sendBtn.addEventListener('click', (e) => { e.preventDefault(); doSend(); });
    sendBtn.addEventListener('touchend', (e) => { e.preventDefault(); doSend(); });
    // Also allow Enter key
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSend(); }
    });
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
  const key = participants.map(p => p.name).sort().join(',');
  if (state._lastTrombiKey === key) return;
  state._lastTrombiKey = key;
  
  state.participants = participants;
  const grid = $('trombi-grid');
  // Merge self + server participants (avoid duplicates)
  const users = [{ name: state.guestName || 'Toi', emoji: state.guestEmoji, photo: state.guestPhoto, phone: state.guestPhone, email: state.guestEmail, instagram: state.guestInsta }];
  participants.forEach(p => {
    if (p.name !== state.guestName) {
      // Host: show real name with 🎧 badge (not "DJ")
      const displayName = p.isHost ? `${p.name} 🎧` : p.name;
      users.push({ name: displayName, emoji: p.emoji || '🎉', photo: p.photo || null, phone: p.phone || '', email: p.email || '', instagram: p.instagram || '', isHost: p.isHost || false });
    }
  });
  renderTrombi(grid, users);
}

function renderTrombi(grid, users) {
  grid.innerHTML = '';
  // Store all users for VOIR TOUS
  window._trombiAllUsers = users;
  
  const MAX_VISIBLE = 10;
  const visibleUsers = users.slice(0, MAX_VISIBLE);
  const remaining = users.length - MAX_VISIBLE;
  
  visibleUsers.forEach((u, idx) => {
    const item = document.createElement('div');
    item.className = 'trombi-item';
    item.style.cursor = 'pointer';
    const bgColor = u.photo ? 'transparent' : `rgba(59, 130, 246, 0.3)`;
    const content = u.photo
      ? `<img src="${u.photo}" alt="${u.name}">`
      : u.emoji;
    const shortName = u.name.length > 6 ? u.name.substring(0, 6) + '…' : u.name;
    item.innerHTML = `
      <div class="trombi-avatar" style="background: ${bgColor}">${content}</div>
      <div class="trombi-name">${shortName}</div>
    `;
    // Contact lightbox on tap
    item.addEventListener('click', () => showTrombiContact(idx));
    grid.appendChild(item);
  });
  
  // "VOIR TOUS" button if more than MAX_VISIBLE
  if (remaining > 0) {
    const more = document.createElement('div');
    more.className = 'trombi-item';
    more.style.cursor = 'pointer';
    more.innerHTML = `
      <div class="trombi-avatar" style="background:rgba(0,210,255,0.15);font-size:14px;font-weight:900;color:#00d2ff;">+${remaining}</div>
      <div class="trombi-name" style="color:#00d2ff;">VOIR TOUS</div>
    `;
    more.addEventListener('click', () => showAllContacts());
    grid.appendChild(more);
  }
}

// Show contact lightbox for a single participant
function showTrombiContact(idx) {
  const users = window._trombiAllUsers || [];
  const u = users[idx];
  if (!u) return;
  const lb = $('trombi-lightbox');
  if (!lb) return;
  const photoEl = $('trombi-lightbox-photo');
  const nameEl = $('trombi-lightbox-name');
  const badgeEl = $('trombi-lightbox-badge');
  if (u.photo) {
    photoEl.innerHTML = `<img src="${u.photo}" style="width:100%;height:100%;object-fit:cover;">`;
  } else {
    photoEl.innerHTML = u.emoji;
  }
  nameEl.textContent = u.name;
  
  // Contact details
  let details = [];
  if (u.phone) details.push(`📞 ${u.phone}`);
  if (u.email) details.push(`✉️ ${u.email}`);
  if (u.instagram) details.push(`📷 ${u.instagram}`);
  badgeEl.innerHTML = details.length 
    ? details.join(' · ') 
    : (u.name.includes('👑') ? '👑 HÔTE DE LA SOIRÉE' : `${u.emoji} Guest`);
  
  // Add/update vCard download button
  let vcardBtn = lb.querySelector('.trombi-vcard-btn');
  if (!vcardBtn) {
    vcardBtn = document.createElement('button');
    vcardBtn.className = 'trombi-vcard-btn';
    vcardBtn.style.cssText = 'padding:8px 20px;background:linear-gradient(135deg,#00e0c4,#00b8a9);border:none;border-radius:10px;font-size:11px;font-weight:800;color:#0a0e1a;cursor:pointer;margin-top:8px;';
    badgeEl.parentNode.insertBefore(vcardBtn, badgeEl.nextSibling);
  }
  vcardBtn.textContent = '📇 AJOUTER AUX CONTACTS';
  vcardBtn.style.background = 'linear-gradient(135deg,#00e0c4,#00b8a9)';
  vcardBtn.style.color = '#0a0e1a';
  vcardBtn.onclick = (e) => {
    e.stopPropagation();
    downloadVCard(u.name, u.emoji, u.phone || '', u.email || '', u.instagram || '');
    vcardBtn.textContent = '✅ CONTACT AJOUTÉ';
    vcardBtn.style.background = 'rgba(0,224,196,0.2)';
    vcardBtn.style.color = '#00e0c4';
  };
  lb.style.display = 'flex';
}

// Show all contacts in a full-screen overlay
function showAllContacts() {
  const users = window._trombiAllUsers || [];
  let overlay = $('all-contacts-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'all-contacts-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:var(--bg-dark);z-index:9998;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:20px;';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="color:white;font-size:18px;font-weight:900;margin:0;">👥 TOUS LES CONTACTS (${users.length})</h3>
      <button onclick="document.getElementById('all-contacts-overlay').remove()" style="background:none;border:none;font-size:14px;color:rgba(255,255,255,0.5);font-weight:800;cursor:pointer;">✕ FERMER</button>
    </div>
    ${users.map((u, i) => {
      const avatar = u.photo 
        ? `<img src="${u.photo}" style="width:44px;height:44px;border-radius:12px;object-fit:cover;">`
        : `<div style="width:44px;height:44px;border-radius:12px;background:rgba(59,130,246,0.2);display:flex;align-items:center;justify-content:center;font-size:20px;">${u.emoji}</div>`;
      const contactLine = [u.phone, u.email, u.instagram].filter(Boolean).join(' · ') || 'Pas d\'infos';
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px;background:rgba(255,255,255,0.03);border-radius:12px;margin-bottom:6px;cursor:pointer;" onclick="document.getElementById('all-contacts-overlay').remove();showTrombiContact(${i})">
          ${avatar}
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:800;color:white;">${u.name}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${contactLine}</div>
          </div>
          <div style="font-size:14px;color:rgba(0,210,255,0.5);">›</div>
        </div>`;
    }).join('')}
    <div style="height:40px;"></div>
  `;
  overlay.style.display = 'block';
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
  
  renderCostumeEntries();
}

function bindCostumeButton() {
  const enterBtn = $('costume-enter-btn');
  if (!enterBtn) {
    console.error('[Costume] Button #costume-enter-btn not found!');
    return;
  }
  
  if (state.costumeRegistered) {
    // Already registered — show photo upload button
    showCostumePhotoUpload();
    return;
  }
  
  enterBtn.style.opacity = '1';
  enterBtn.style.pointerEvents = 'auto';
  enterBtn.style.display = '';
  enterBtn.textContent = '🎭 JE PARTICIPE !';
  enterBtn.onclick = function() {
    if (state.costumeRegistered) return;
    state.costumeRegistered = true;
    
    const myEntry = {
      guestName: state.guestName,
      guestId: state.guestId,
      emoji: state.guestEmoji,
      votes: 0
    };
    state.costumeEntries = (state.costumeEntries || []).filter(e => e.guestId !== state.guestId);
    state.costumeEntries.push(myEntry);
    renderCostumeEntries();
    populateMissions(); // refresh mission progress
    saveSession();
    
    if (socket && socket.connected) {
      socket.emit('costume:enter', {
        guestName: state.guestName,
        guestId: state.guestId,
        emoji: state.guestEmoji
      });
    }
    
    // Switch to photo upload mode
    showCostumePhotoUpload();
  };
}

function showCostumePhotoUpload() {
  const container = $('costume-participate');
  if (!container) return;
  container.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; background:rgba(0,224,196,0.08); border:1px solid rgba(0,224,196,0.3); border-radius:12px;">
      <span style="font-size:18px;">✅</span>
      <div style="flex:1;">
        <div style="font-size:11px; font-weight:800; color:#00e0c4;">INSCRIT !</div>
        <div style="font-size:9px; color:var(--text-dim);">Ajoute une photo de ton déguisement</div>
      </div>
      <div style="position:relative; overflow:hidden; display:inline-flex; align-items:center; gap:4px; padding:6px 14px; background:linear-gradient(135deg,#bb86fc,#7c4dff); border-radius:8px; cursor:pointer; font-size:10px; font-weight:800; color:white;">
        📷 PHOTO
        <input type="file" id="costume-photo-input" accept="image/*" style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer; font-size:0;">
      </div>
    </div>
  `;
  // Bind photo input
  const photoInput = $('costume-photo-input');
  if (photoInput) {
    photoInput.onchange = handleCostumePhoto;
  }
}

function handleCostumePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  
  readFileAsDataURL(file, (dataURL) => {
    if (!dataURL) { alert('❌ Erreur photo'); return; }
    
    // Update local entry
    const myEntry = (state.costumeEntries || []).find(en => en.guestId === state.guestId);
    if (myEntry) myEntry.photo = dataURL;
    renderCostumeEntries();
    
    // Also add to MES PHOTOS
    state.myPhotos = state.myPhotos || [];
    state.myPhotos.push(dataURL);
    updateMyPhotosGrid();
    populateMissions(); // refresh Paparazzi mission
    
    // Send costume photo to server
    if (socket && socket.connected) {
      socket.emit('costume:photo', {
        guestId: state.guestId,
        photo: dataURL
      });
      // Also send as gallery photo so it appears in host diaporama
      socket.emit('guest:photo', {
        dataURL: dataURL,
        guestName: state.guestName
      });
      console.log('[CostumePhoto] Emitted costume:photo + guest:photo');
    }
    saveSession();
  });
}

// Gallery photo handler — clone of handleCostumePhoto WITHOUT costume entry update
function handleGalleryPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  
  readFileAsDataURL(file, (dataURL) => {
    if (!dataURL) { alert('❌ Erreur photo'); return; }
    
    // Add to MES PHOTOS
    state.myPhotos = state.myPhotos || [];
    state.myPhotos.push(dataURL);
    updateMyPhotosGrid();
    populateMissions(); // refresh Paparazzi mission
    
    // Send as gallery photo to host diaporama
    if (socket && socket.connected) {
      socket.emit('guest:photo', {
        dataURL: dataURL,
        guestName: state.guestName
      });
      console.log('[GalleryPhoto] Emitted guest:photo');
    }
    saveSession();
  });
}

function renderCostumeEntries() {
  const grid = $('costume-grid');
  const entries = state.costumeEntries || [];
  
  if (!entries.length) {
    grid.innerHTML = '<div style="text-align: center; color: var(--text-dim); font-size: 11px; padding: 16px;">⏳ En attente de participants...</div>';
    renderCostumePodium([]);
    return;
  }
  
  grid.innerHTML = '';
  grid.style.cssText = 'display:grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap:8px;';
  
  entries.forEach(entry => {
    const isVoted = state.costumeVoted === entry.guestId;
    const isMe = entry.guestId === state.guestId;
    const card = document.createElement('div');
    card.style.cssText = 'display:flex; flex-direction:column; align-items:center; padding:8px 6px; background:rgba(255,255,255,0.04); border-radius:12px;' + (isVoted ? 'border:2px solid #bb86fc;' : 'border:2px solid transparent;');
    
    // VOTER button on top (centered)
    let topBtn = '';
    if (isMe) {
      topBtn = '<div style="font-size:8px;color:var(--text-dim);font-weight:700;margin-bottom:4px;">TOI</div>';
    } else if (isVoted) {
      topBtn = '<button class="costume-vote-btn voted" style="margin-bottom:4px;padding:3px 10px;background:rgba(187,134,252,0.2);border:1px solid #bb86fc;border-radius:6px;color:#bb86fc;font-size:8px;font-weight:800;cursor:pointer;">✓ VOTE</button>';
    } else {
      topBtn = '<button class="costume-vote-btn" style="margin-bottom:4px;padding:3px 10px;background:linear-gradient(135deg,#bb86fc,#7c4dff);border:none;border-radius:6px;color:white;font-size:8px;font-weight:800;cursor:pointer;">VOTER</button>';
    }
    
    const shortName = entry.guestName.length > 6 ? entry.guestName.substring(0, 6) + '…' : entry.guestName;
    
    card.innerHTML = `
      ${topBtn}
      ${entry.photo ? `<img src="${entry.photo}" class="costume-thumb" style="width:60px;height:60px;border-radius:10px;object-fit:cover;cursor:pointer;">` : `<div style="width:60px;height:60px;border-radius:10px;background:rgba(187,134,252,0.15);display:flex;align-items:center;justify-content:center;font-size:28px;">${entry.emoji || '🎭'}</div>`}
      <div style="font-size:10px;font-weight:700;color:white;margin-top:4px;text-align:center;">${shortName}</div>
      <div style="font-size:9px;font-weight:800;color:#bb86fc;">${entry.votes || 0} ❤️</div>
    `;
    
    // Photo click to enlarge
    const thumb = card.querySelector('.costume-thumb');
    if (thumb) {
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        showPhotoLightbox(entry.photo, entry.guestName, entry.guestId);
      });
    }
    
    // Vote button
    const voteBtn = card.querySelector('.costume-vote-btn');
    if (voteBtn && !isMe) {
      voteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isVoted) {
          state.costumeVoted = null;
          entry.votes = Math.max(0, (entry.votes || 0) - 1);
          if (socket && socket.connected) socket.emit('costume:unvote', { voterId: state.guestId, targetId: entry.guestId });
        } else {
          if (state.costumeVoted) {
            const old = entries.find(en => en.guestId === state.costumeVoted);
            if (old) old.votes = Math.max(0, (old.votes || 0) - 1);
            if (socket && socket.connected) socket.emit('costume:unvote', { voterId: state.guestId, targetId: state.costumeVoted });
          }
          state.costumeVoted = entry.guestId;
          entry.votes = (entry.votes || 0) + 1;
          if (socket && socket.connected) socket.emit('costume:vote', { voterId: state.guestId, voterName: state.guestName, targetId: entry.guestId, targetName: entry.guestName });
        }
        renderCostumeEntries();
        saveSession();
      });
    }
    grid.appendChild(card);
  });
  
  renderCostumePodium(entries);
}

function showPhotoLightbox(src, name, entryGuestId) {
  // Remove existing lightbox
  const existing = document.querySelector('.photo-lightbox');
  if (existing) existing.remove();
  
  // Build vote button if we have an entry to vote on
  let voteHTML = '';
  if (entryGuestId && entryGuestId !== state.guestId) {
    const isVoted = state.costumeVoted === entryGuestId;
    if (isVoted) {
      voteHTML = `<button class="lb-vote-btn" style="padding:10px 24px;background:rgba(187,134,252,0.2);border:1px solid #bb86fc;border-radius:12px;color:#bb86fc;font-size:12px;font-weight:800;cursor:pointer;">✓ VOTÉ</button>`;
    } else {
      voteHTML = `<button class="lb-vote-btn" style="padding:10px 24px;background:linear-gradient(135deg,#bb86fc,#7c4dff);border:none;border-radius:12px;color:white;font-size:12px;font-weight:800;cursor:pointer;">❤️ VOTER</button>`;
    }
  }
  
  const overlay = document.createElement('div');
  overlay.className = 'photo-lightbox';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="color:white;font-size:14px;font-weight:800;margin-bottom:12px;">${name || 'Photo'}</div>
    <img src="${src}" style="max-width:90%;max-height:65vh;border-radius:12px;object-fit:contain;">
    <div style="display:flex;gap:12px;margin-top:16px;align-items:center;">
      ${voteHTML}
      <button class="lb-close-btn" style="padding:10px 30px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:12px;color:white;font-size:12px;font-weight:800;cursor:pointer;">FERMER</button>
    </div>
  `;
  
  // Close button
  overlay.querySelector('.lb-close-btn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  
  // Vote button
  const voteBtn = overlay.querySelector('.lb-vote-btn');
  if (voteBtn && entryGuestId) {
    voteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const entries = state.costumeEntries || [];
      const isVoted = state.costumeVoted === entryGuestId;
      
      if (isVoted) {
        state.costumeVoted = null;
        const entry = entries.find(en => en.guestId === entryGuestId);
        if (entry) entry.votes = Math.max(0, (entry.votes || 0) - 1);
        if (socket && socket.connected) socket.emit('costume:unvote', { voterId: state.guestId, targetId: entryGuestId });
      } else {
        if (state.costumeVoted) {
          const old = entries.find(en => en.guestId === state.costumeVoted);
          if (old) old.votes = Math.max(0, (old.votes || 0) - 1);
          if (socket && socket.connected) socket.emit('costume:unvote', { voterId: state.guestId, targetId: state.costumeVoted });
        }
        state.costumeVoted = entryGuestId;
        const entry = entries.find(en => en.guestId === entryGuestId);
        if (entry) entry.votes = (entry.votes || 0) + 1;
        if (socket && socket.connected) socket.emit('costume:vote', { voterId: state.guestId, voterName: state.guestName, targetId: entryGuestId, targetName: name });
      }
      renderCostumeEntries();
      saveSession();
      overlay.remove();
    });
  }
  
  document.body.appendChild(overlay);
}

function renderCostumePodium(entries) {
  const podium = $('costume-podium');
  if (!podium) return;
  const sorted = [...entries].filter(e => (e.votes || 0) > 0).sort((a, b) => (b.votes || 0) - (a.votes || 0));
  if (!sorted.length) {
    podium.innerHTML = '<div style="text-align:center; color:var(--text-dim); font-size:11px; padding:12px;">Pas encore de votes</div>';
    return;
  }
  const winner = sorted[0];
  const photoHTML = winner.photo
    ? `<img src="${winner.photo}" style="width:80px;height:80px;border-radius:14px;object-fit:cover;border:2px solid rgba(255,215,0,0.5);cursor:pointer;" onclick="showPhotoLightbox('${winner.photo.replace(/'/g, "\\'")}','${winner.guestName}')">`
    : `<div style="width:80px;height:80px;border-radius:14px;background:rgba(255,215,0,0.1);display:flex;align-items:center;justify-content:center;font-size:36px;border:2px solid rgba(255,215,0,0.3);">${winner.emoji || '🎭'}</div>`;
  podium.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;padding:12px;background:linear-gradient(135deg,rgba(255,215,0,0.08),rgba(255,215,0,0.02));border:1px solid rgba(255,215,0,0.2);border-radius:14px;">
      ${photoHTML}
      <div style="flex:1;">
        <div style="font-size:9px;font-weight:800;color:rgba(255,215,0,0.7);letter-spacing:1px;margin-bottom:4px;">👑 MEILLEUR DÉGUISEMENT</div>
        <div style="font-size:16px;font-weight:900;color:white;margin-bottom:2px;">${winner.guestName}</div>
        <div style="font-size:13px;font-weight:800;color:#bb86fc;">${winner.votes} ❤️</div>
      </div>
    </div>
  `;
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
  
  // Calculate and display total points
  const rewardValues = { '+50 pts': 50, '+100 pts': 100, '+30 pts': 30, '+40 pts': 40, '+200 pts': 200 };
  let totalPoints = 0;
  missions.forEach(m => {
    if (m.current >= m.target) totalPoints += (rewardValues[m.reward] || 0);
  });
  const pointsEl = $('points-total');
  if (pointsEl) pointsEl.textContent = totalPoints;
}

function handleDiapoPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  console.log('[Photo] File selected:', file.name, file.size, 'bytes');
  
  e.target.value = '';
  state.myPhotos = state.myPhotos || [];
  state.diapoPhotos = state.diapoPhotos || [];
  
  // Use FileReader (more reliable on mobile than createObjectURL)
  readFileAsDataURL(file, (dataURL) => {
    if (!dataURL) {
      console.error('[Photo] Failed to read file');
      alert('❌ Erreur lors de la lecture de la photo');
      return;
    }
    
    console.log('[Photo] Read OK, length:', dataURL.length);
    
    state.diapoPhotos.push(dataURL);
    state.myPhotos.push(dataURL);
    addDiapoPhoto(dataURL, state.guestName);
    updateMyPhotosGrid();
    saveSession();
    
    if (socket && socket.connected) {
      socket.emit('guest:photo', {
        dataURL: dataURL,
        guestName: state.guestName
      });
      console.log('[Photo] Emitted to server');
    } else {
      console.warn('[Photo] Socket not connected!');
    }
  });
}

// Reliable file reading + forced resize for mobile
function readFileAsDataURL(file, callback) {
  // Resize to keep Socket.IO payloads under 1MB (camera photos can be 12MP+)
  resizeImage(file, 600, 0.6, (resized) => {
    if (resized) {
      console.log('[Photo] Resized OK, length:', resized.length);
      callback(resized);
    } else {
      // Canvas failed — fallback to raw FileReader
      console.warn('[Photo] Canvas resize failed, using raw FileReader');
      const reader = new FileReader();
      reader.onload = () => callback(reader.result);
      reader.onerror = () => { console.error('[Photo] FileReader error'); callback(null); };
      reader.readAsDataURL(file);
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
  grid.innerHTML = '';
  grid.className = 'gallery-grid';
  photos.forEach(dataURL => {
    const img = document.createElement('img');
    img.src = dataURL;
    img.alt = 'Ma photo';
    img.style.cssText = 'width:100%; border-radius:8px; aspect-ratio:1; object-fit:cover; cursor:pointer;';
    img.addEventListener('click', () => showPhotoLightbox(dataURL, state.guestName || 'Moi'));
    grid.appendChild(img);
  });
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
  if (!grid) { console.error('[Photo] diapo-grid not found!'); return; }
  
  // Track for dedup
  if (!state.diapoPhotos) state.diapoPhotos = new Set();
  const key = (dataURL || '').substring(0, 100);
  if (state.diapoPhotos.has(key)) {
    console.log('[Photo] Duplicate skipped');
    return;
  }
  state.diapoPhotos.add(key);
  
  const img = document.createElement('img');
  img.src = dataURL;
  img.alt = `photo de ${guestName || 'guest'}`;
  img.style.cssText = 'width:100%; border-radius:8px; aspect-ratio:1; object-fit:cover; cursor:pointer;';
  img.addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = `socialmix_${guestName || 'photo'}_${Date.now()}.jpg`;
    link.click();
  });
  grid.appendChild(img);
  console.log('[Photo] Added to diapo-grid, total:', grid.children.length);
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
// END-OF-PARTY MULTI-SELECT HELPERS
// ═══════════════════════════════════════════
window._selectedEndPhotos = new Set();

function toggleEndPhotoSelect(idx) {
  if (window._selectedEndPhotos.has(idx)) {
    window._selectedEndPhotos.delete(idx);
  } else {
    window._selectedEndPhotos.add(idx);
  }
  // Update checkbox visuals
  document.querySelectorAll('.end-photo-check').forEach((el, i) => {
    const parent = el.closest('[data-photo-idx]');
    const photoIdx = parent ? parseInt(parent.dataset.photoIdx) : i;
    if (window._selectedEndPhotos.has(photoIdx)) {
      el.innerHTML = '✓';
      el.style.background = '#00c853';
      el.style.borderColor = '#00c853';
      el.style.color = 'white';
    } else {
      el.innerHTML = '';
      el.style.background = 'rgba(0,0,0,0.4)';
      el.style.borderColor = 'rgba(255,255,255,0.4)';
    }
  });
  // Show/hide batch download button
  const batchBtn = document.getElementById('end-batch-download');
  if (batchBtn) {
    batchBtn.style.display = window._selectedEndPhotos.size > 0 ? 'block' : 'none';
    batchBtn.textContent = `💾 TÉLÉCHARGER ${window._selectedEndPhotos.size} PHOTO${window._selectedEndPhotos.size > 1 ? 'S' : ''}`;
  }
}

function toggleSelectAllEndPhotos() {
  const photos = window._endPartyPhotos || [];
  const allSelected = window._selectedEndPhotos.size === photos.length;
  window._selectedEndPhotos.clear();
  if (!allSelected) {
    photos.forEach((_, i) => window._selectedEndPhotos.add(i));
  }
  // Re-update all checkboxes
  document.querySelectorAll('.end-photo-check').forEach((el, i) => {
    const parent = el.closest('[data-photo-idx]');
    const photoIdx = parent ? parseInt(parent.dataset.photoIdx) : i;
    if (window._selectedEndPhotos.has(photoIdx)) {
      el.innerHTML = '✓';
      el.style.background = '#00c853';
      el.style.borderColor = '#00c853';
      el.style.color = 'white';
    } else {
      el.innerHTML = '';
      el.style.background = 'rgba(0,0,0,0.4)';
      el.style.borderColor = 'rgba(255,255,255,0.4)';
    }
  });
  const batchBtn = document.getElementById('end-batch-download');
  if (batchBtn) {
    batchBtn.style.display = window._selectedEndPhotos.size > 0 ? 'block' : 'none';
    batchBtn.textContent = `💾 TÉLÉCHARGER ${window._selectedEndPhotos.size} PHOTO${window._selectedEndPhotos.size > 1 ? 'S' : ''}`;
  }
}

function downloadSelectedEndPhotos() {
  const photos = window._endPartyPhotos || [];
  window._selectedEndPhotos.forEach(idx => {
    if (idx < photos.length) {
      const a = document.createElement('a');
      a.href = photos[idx].dataURL;
      a.download = `soiree_photo_${idx + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  });
  const batchBtn = document.getElementById('end-batch-download');
  if (batchBtn) {
    batchBtn.textContent = '✅ PHOTOS ENREGISTRÉES';
    batchBtn.style.background = 'rgba(0,200,83,0.2)';
    batchBtn.style.color = '#00c853';
    setTimeout(() => {
      batchBtn.textContent = `💾 TÉLÉCHARGER ${window._selectedEndPhotos.size} PHOTOS`;
      batchBtn.style.background = 'linear-gradient(135deg,#00c853,#00bfa5)';
      batchBtn.style.color = '#0a0e1a';
    }, 2000);
  }
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

// ═══════════════════════════════════════════
// END OF PARTY HELPERS
// ═══════════════════════════════════════════

function showEndContactCard(index) {
  const participants = window._endPartyParticipants || [];
  const p = participants[index];
  if (!p) return;
  const card = document.getElementById('end-contact-card');
  if (!card) return;
  const name = p.name || 'Guest';
  const emoji = p.emoji || '🎉';
  document.getElementById('end-contact-emoji').textContent = emoji;
  document.getElementById('end-contact-name').textContent = name;
  
  // Show contact details if available
  let details = [];
  if (p.phone) details.push(`📞 ${p.phone}`);
  if (p.email) details.push(`✉️ ${p.email}`);
  if (p.instagram) details.push(`📷 ${p.instagram}`);
  const badgeEl = document.getElementById('trombi-lightbox-badge') || document.createElement('div');
  
  // Create/update details area
  let detailsEl = document.getElementById('end-contact-details');
  if (!detailsEl) {
    detailsEl = document.createElement('div');
    detailsEl.id = 'end-contact-details';
    detailsEl.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.6);text-align:center;line-height:1.8;';
    const nameEl = document.getElementById('end-contact-name');
    nameEl.parentNode.insertBefore(detailsEl, nameEl.nextSibling);
  }
  detailsEl.innerHTML = details.length ? details.join('<br>') : '<span style="color:rgba(255,255,255,0.3)">Pas d\'infos partagées</span>';
  
  const btn = document.getElementById('end-contact-btn');
  btn.onclick = function(e) {
    e.stopPropagation();
    downloadVCard(name, emoji, p.phone || '', p.email || '', p.instagram || '');
    btn.textContent = '✅ CONTACT AJOUTÉ';
    btn.style.background = 'rgba(0,224,196,0.2)';
    btn.style.color = '#00e0c4';
    setTimeout(() => { card.style.display = 'none'; }, 1200);
  };
  btn.textContent = '📇 AJOUTER AUX CONTACTS';
  btn.style.background = 'linear-gradient(135deg,#00e0c4,#00b8a9)';
  btn.style.color = '#0a0e1a';
  card.style.display = 'flex';
}

function downloadVCard(name, emoji, phone, email, insta) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${emoji} ${name}`,
    `N:${name};;;;`
  ];
  if (phone) lines.push(`TEL;TYPE=CELL:${phone}`);
  if (email) lines.push(`EMAIL:${email}`);
  if (insta) lines.push(`X-SOCIALPROFILE;TYPE=instagram:${insta}`);
  lines.push(`NOTE:Rencontré(e) à la soirée Social Mix 🎧`);
  lines.push('END:VCARD');
  const vcard = lines.join('\r\n');
  const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-zA-Z0-9]/g, '_')}.vcf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showEndPhotoLightbox(index) {
  const photos = window._endPartyPhotos || [];
  const idx = parseInt(index);
  if (idx < 0 || idx >= photos.length) return;
  const photo = photos[idx];
  const lb = document.getElementById('end-photo-lightbox');
  if (!lb) return;
  document.getElementById('end-photo-img').src = photo.dataURL;
  document.getElementById('end-photo-author').textContent = `📷 ${photo.guestName || 'Guest'}`;
  const saveBtn = document.getElementById('end-photo-save');
  saveBtn.onclick = function(e) {
    e.stopPropagation();
    // Download the image
    const a = document.createElement('a');
    a.href = photo.dataURL;
    a.download = `soiree_photo_${idx + 1}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    saveBtn.textContent = '✅ ENREGISTRÉ';
    saveBtn.style.background = 'rgba(0,200,83,0.2)';
    saveBtn.style.color = '#00c853';
    setTimeout(() => {
      saveBtn.textContent = '💾 ENREGISTRER';
      saveBtn.style.background = 'linear-gradient(135deg,#00c853,#00bfa5)';
      saveBtn.style.color = '#0a0e1a';
    }, 1500);
  };
  lb.style.display = 'flex';
}
