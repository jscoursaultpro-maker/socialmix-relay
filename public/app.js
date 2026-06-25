/* ═══════════════════════════════════════════
   AhOuai — Guest Web App v2
   5-screen architecture with Profile + Social Hub
   ═══════════════════════════════════════════ */

// ─── Config ──────────────────────────────────────────
const STORAGE_KEY = 'socialmix_guest';
const PROFILE_KEY = 'socialmix_profile';
const SESSION_KEY = 'socialmix_session';
const CONSENT_KEY = 'socialmix_consent';
const GENRES = ['Chill', 'Pop', 'Rock', 'Rap', 'Latin', 'Old school', 'Urban Groove', 'Dance', 'Électro'];
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
  nextTrack: null,
  mode: 'appMix',
  connected: false,
  diapoPhotos: new Set(),
  allVotes: [],
  missionPoints: 0,
  leaderboard: [],
  missionsCompleted: {}
};

// ─── DOM Helper ──────────────────────────────────────
const $ = (id) => document.getElementById(id);

function showToast(message, duration = 3000) {
  let toast = document.getElementById('reconnect-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'reconnect-toast';
    toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#00e0c4,#00b8a9);color:#0a0e1a;padding:10px 20px;border-radius:12px;font-size:13px;font-weight:800;z-index:99999;opacity:0;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

function showSuggestionToast(message, status) {
  const colors = {
    pending: 'linear-gradient(135deg,#666,#888)',
    queued: 'linear-gradient(135deg,#00b8a9,#00e0c4)',
    next: 'linear-gradient(135deg,#ff6b35,#ff9f00)',
    played: 'linear-gradient(135deg,#ffd700,#ffaa00)',
    dismissed: 'linear-gradient(135deg,#667,#889)',
    // Legacy compat
    accepted: 'linear-gradient(135deg,#00b8a9,#00e0c4)',
    refused: 'linear-gradient(135deg,#667,#889)'
  };
  let toast = document.getElementById('suggestion-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'suggestion-toast';
    toast.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%) scale(0.9);color:#fff;padding:12px 24px;border-radius:14px;font-size:14px;font-weight:700;z-index:99999;opacity:0;transition:all 0.4s cubic-bezier(0.34,1.56,0.64,1);pointer-events:none;text-align:center;max-width:85vw;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.background = colors[status] || colors.pending;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) scale(1)';
  const duration = (status === 'played' || status === 'next') ? 5000 : 3500;
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) scale(0.9)';
  }, duration);
}

function updateSuggestionBadge(title, status, message) {
  // Find the suggestion item in the list by title
  const items = document.querySelectorAll('.suggestion-item[data-suggest-title]');
  for (const item of items) {
    if (item.getAttribute('data-suggest-title') === title) {
      const badge = item.querySelector('.suggest-status-badge');
      if (!badge) continue;

      const configs = {
        pending:        { dot: '#888',    icon: '💡', label: 'Envoyée au DJ' },
        received:       { dot: '#00c853', icon: '✅', label: 'Reçue par le DJ' },
        already_played: { dot: '#ff9800', icon: '🔄', label: 'Déjà joué ce soir' },
        duplicate:      { dot: '#ab47bc', icon: '👥', label: 'Déjà demandé' },
        phase_wait:     { dot: '#ffc107', icon: '⏳', label: 'Gardée pour plus tard' },
        queued:         { dot: '#00b8a9', icon: '🎶', label: 'En file d\'attente' },
        next:           { dot: '#ff6b35', icon: '🔥', label: 'C\'est la prochaine !' },
        played:         { dot: '#ffd700', icon: '🎉', label: 'Bien joué !' },
        dismissed:      { dot: '#667',    icon: '😉', label: 'Peut-être plus tard' },
        accepted:       { dot: '#00c853', icon: '✅', label: 'Acceptée par le DJ !' },
        refused:        { dot: '#667',    icon: '😉', label: 'Pas pour ce soir' }
      };
      const c = configs[status] || configs.pending;
      const displayMsg = message || `${c.icon} ${c.label}`;

      badge.style.color = c.dot;
      badge.innerHTML = `
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c.dot};box-shadow:0 0 4px ${c.dot};"></span>
        ${escapeHtml(displayMsg)}
      `;
      // Subtle pulse animation
      badge.style.animation = 'none';
      badge.offsetHeight; // trigger reflow
      badge.style.animation = 'fadeIn 0.4s ease';
      break;
    }
  }
}

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
    alias: state.guestAlias,
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
      state.guestAlias = saved.alias || '';
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
  // Save session token separately for reconnection
  if (state.sessionToken && state.partyCode) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      sessionToken: state.sessionToken,
      partyCode: state.partyCode,
      guestName: state.guestName,
      guestEmoji: state.guestEmoji,
      savedAt: Date.now()
    }));
  }
}

function loadSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      const urlParams = new URLSearchParams(window.location.search);
      const urlCode = urlParams.get('code');
      
      state.guestId = saved.guestId;
      state.partyCode = saved.partyCode || '';
      
      if (urlCode && state.partyCode && urlCode.toUpperCase() !== state.partyCode.toUpperCase()) {
        // The user is joining a NEW party via URL link. We MUST ignore the old suggestions.
        state.partyCode = urlCode.toUpperCase();
        state.suggestions = [];
        state.trackHistory = [];
      } else {
        // Keep only pending or active suggestions to avoid clutter across reloads
        const rawSuggestions = saved.suggestions || [];
        state.suggestions = rawSuggestions.filter(s => s.status === 'pending' || s.status === 'queued' || s.status === 'next');
        state.trackHistory = saved.trackHistory || [];
      }
      return true;
    }
  } catch(e) {}
  return false;
}

function loadResumeSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (saved && saved.sessionToken && saved.partyCode) {
      // Expire after 4h
      if (Date.now() - saved.savedAt > 6 * 60 * 60 * 1000) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return saved;
    }
  } catch(e) {}
  return null;
}

function clearResumeSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch(e) {
    console.warn("Could not clear session", e);
  }
  state.sessionToken = null;
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
  if (name === 'hub') { renderMissions(); renderLeaderboard(); }
  
  // Show/hide scroll indicator only on profile screen
  const scrollInd = $('scroll-indicator');
  if (scrollInd) scrollInd.style.display = (name === 'profile') ? 'flex' : 'none';
  
  // Re-bind event handlers when hub screen opens
  if (name === 'hub') {
    bindCostumeButton();
    populateMissions();
    updateMyPhotosGrid();
    refreshAllPhotos();
    renderCostumeEntries();
  }
}

function updatePrePartyTrombinoscope(guests, hostProfile) {
  const container = $('pre-party-trombi');
  if (!container) return;
  container.innerHTML = '';
  
  window._trombiAllUsers = [];
  let userIndex = 0;
  
  // Host
  if (hostProfile) {
    const hostUser = { name: hostProfile.name || 'HÔTE', emoji: hostProfile.emoji || '🎧', isHost: true, photo: hostProfile.photo || null };
    window._trombiAllUsers.push(hostUser);
    
    const wrapper = document.createElement('div');
    wrapper.style.cssText = "display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; cursor: pointer; width: 60px;";
    
    const d = document.createElement('div');
    d.style.cssText = "width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; background: rgba(0, 224, 196, 0.2); border: 2px solid #00e0c4; position: relative;";
    
    if (hostUser.photo) {
      const img = document.createElement('img');
      img.src = hostUser.photo;
      img.style.cssText = "width: 100%; height: 100%; object-fit: cover; border-radius: 50%;";
      d.appendChild(img);
    } else {
      d.textContent = hostUser.emoji;
    }
    
    const badge = document.createElement('div');
    badge.style.cssText = "position: absolute; bottom: -5px; background: #00e0c4; color: #000; font-size: 8px; font-weight: 900; padding: 2px 4px; border-radius: 4px; letter-spacing: 1px;";
    badge.textContent = "HÔTE";
    d.appendChild(badge);
    
    const nameLabel = document.createElement('div');
    nameLabel.style.cssText = "font-size: 10px; color: #fff; font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center;";
    nameLabel.textContent = (hostUser.name || '').substring(0, 7);
    
    wrapper.appendChild(d);
    wrapper.appendChild(nameLabel);
    
    let currentIndex = userIndex++;
    wrapper.addEventListener('click', () => showTrombiContact(currentIndex));
    
    container.appendChild(wrapper);
  }
  
  // Guests
  if (guests && guests.length > 0) {
    guests.forEach(g => {
      if (g.isHost) return; // Skip host as they're already added
      
      const guestUser = { name: g.name, emoji: g.emoji || '😎', photo: g.photo || null, phone: g.phone, email: g.email, instagram: g.instagram, userId: g.userId };
      window._trombiAllUsers.push(guestUser);
      
      const wrapper = document.createElement('div');
      wrapper.style.cssText = "display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; cursor: pointer; width: 60px;";
      
      const d = document.createElement('div');
      d.style.cssText = "width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255,255,255,0.2); overflow: hidden;";
      if (g.photo) {
        const img = document.createElement('img');
        img.src = g.photo;
        img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
        d.appendChild(img);
      } else {
        d.textContent = guestUser.emoji;
      }
      
      const nameLabel = document.createElement('div');
      nameLabel.style.cssText = "font-size: 10px; color: #fff; font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center;";
      nameLabel.textContent = (guestUser.name || '').substring(0, 7);
      
      wrapper.appendChild(d);
      wrapper.appendChild(nameLabel);
      
      let currentIndex = userIndex++;
      wrapper.addEventListener('click', () => showTrombiContact(currentIndex));
      
      container.appendChild(wrapper);
    });
  }
}

// ═══════════════════════════════════════════
// SCREEN 1: LANDING
// ═══════════════════════════════════════════
async function setupLanding(activeCode) {
  const params = getURLParams();
  let code = activeCode || (params.code ? params.code.toUpperCase() : '');
  
  if (code) {
    state.partyCode = code;
    
    try {
      const res = await fetch(`/api/party/${code}/meta`);
      if (res.ok) {
        const meta = await res.json();
        
        if (meta.isPreParty) {
          state.isPreParty = true;
          
          $('pre-party-host').textContent = `AVEC ${meta.hostName || 'DJ'}`;
          if (meta.welcomeText) {
            $('pre-party-text').textContent = `"${meta.welcomeText}"`;
          }
          if (meta.coverPhoto) {
            $('pre-party-cover').src = meta.coverPhoto;
            $('pre-party-cover-container').style.display = 'block';
          }
          
          if (meta.scheduledFor) {
            startCountdown(meta.scheduledFor);
          }

          if (meta.guests) {
            updatePrePartyTrombinoscope(meta.guests, meta.hostProfile);
          }
          
          $('pre-party-prepare-btn').addEventListener('click', () => {
            if (hasConsent()) showScreen('profile');
            else showScreen('consent');
          });
          
          // Check auto-refresh to transition to live party
          setInterval(async () => {
             const r = await fetch(`/api/party/${code}/meta`);
             if (r.ok) {
               const m = await r.json();
               if (!m.isPreParty && state.isPreParty) {
                 // The party just started!
                 state.isPreParty = false;
                 // If user is already on pre-party screen or profile, they can just proceed
                 if (currentScreen === 'pre-party') {
                   enterCockpit();
                 }
               } else if (m.isPreParty) {
                 updatePrePartyTrombinoscope(m.guests, m.hostProfile);
               }
             }
          }, 15000); // Check every 15s
          
          showScreen('pre-party');
          return true;
        }
      }
    } catch (e) {
      console.warn("Could not fetch meta:", e);
    }
    
    // Normal Landing
    if (code) {
      $('landing-party-name').textContent = `SOIRÉE ${code}`;
      
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
      if (isIOS) {
        const appURL = `socialmix://join?code=${code}`;
        const banner = document.createElement('div');
        banner.className = 'app-banner';
        banner.innerHTML = `
          <div class="app-banner-content">
            <span class="app-banner-icon">📱</span>
            <span class="app-banner-text">Tu as l'app AhOuai ?</span>
            <a href="${appURL}" class="app-banner-open">OUVRIR</a>
            <button class="app-banner-close" onclick="this.parentElement.parentElement.remove()">✕</button>
          </div>
        `;
        document.body.prepend(banner);
      }
    } else {
      $('landing-party-name').textContent = `L'EXPÉRIENCE SOCIALE DE TA SOIRÉE`;
    }
  }
  
  if ($('show-qr-btn')) {
    $('show-qr-btn').addEventListener('click', showPartyQR);
  }
  
  $('landing-cta').addEventListener('click', () => {
    // Check if consent already given
    if (hasConsent()) {
      showScreen('profile');
    } else {
      showScreen('consent');
    }
  });
  
  return false;
}

// ═══════════════════════════════════════════
// SCREEN 1b: GDPR CONSENT
// ═══════════════════════════════════════════
function setupConsent() {
  const checkbox = $('consent-checkbox');
  const btn = $('consent-continue');
  
  checkbox.addEventListener('change', () => {
    btn.disabled = !checkbox.checked;
  });
  
  btn.addEventListener('click', () => {
    if (!checkbox.checked) return;
    // Store consent
    const consent = {
      version: '1.0',
      timestamp: Date.now(),
      date: new Date().toISOString()
    };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    showScreen('profile');
  });
}

function hasConsent() {
  try {
    const c = localStorage.getItem(CONSENT_KEY);
    return c !== null;
  } catch(e) { return false; }
}

function getConsent() {
  try {
    return JSON.parse(localStorage.getItem(CONSENT_KEY)) || null;
  } catch(e) { return null; }
}

// ═══════════════════════════════════════════
// SCREEN 2: PROFILE
// ═══════════════════════════════════════════
function setupProfile() {
  // Pre-fill if profile exists
  if (state.guestName) $('profile-firstname').value = state.guestName;
  if (state.guestLastName) $('profile-lastname').value = state.guestLastName;
  if (state.guestAlias && $('profile-alias')) $('profile-alias').value = state.guestAlias;
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
    const fn = $('profile-firstname').value.trim();
    const ln = $('profile-lastname').value.trim();
    const alias = $('profile-alias') ? $('profile-alias').value.trim() : '';
    const ph = $('profile-phone').value.trim();
    const em = $('profile-email').value.trim();
    const insta = $('profile-instagram').value.trim();

    if (!fn || !ln) {
      alert("Veuillez remplir au moins votre Prénom et Nom pour valider votre profil.");
      return;
    }

    state.guestName = fn;
    state.guestLastName = ln;
    state.guestAlias = alias;
    state.guestPhone = ph;
    state.guestEmail = em;
    state.guestInsta = insta;
    saveProfile();
    
    if (state.editingFromCockpit) {
      // Return to cockpit and update greeting
      state.editingFromCockpit = false;
      showScreen('cockpit');
      $('greeting').textContent = `Hey ${state.guestName} ! 🎉`;
      // Re-emit join with updated profile
      if (socket && socket.connected) {
        socket.emit('guest:join', {
          name: state.guestName,
          lastName: state.guestLastName,
          alias: state.guestAlias,
          emoji: state.guestEmoji,
          photo: state.guestPhoto,
          partyCode: state.partyCode
        });
      }
    } else {
      const params = getURLParams();
      if (params.code) {
        state.partyCode = params.code.toUpperCase();
        if (state.isPreParty) {
          showScreen('pre-party');
          if (!socket || !socket.connected) {
            connectToRelay();
          } else {
            socket.emit('guest:join', { name: state.guestName, lastName: state.guestLastName, alias: state.guestAlias, emoji: state.guestEmoji, photo: state.guestPhoto, partyCode: state.partyCode });
          }
          // Also fetch meta once to update trombinoscope immediately
          fetch(`/api/party/${state.partyCode}/meta`).then(r => r.json()).then(m => {
            if (typeof updatePrePartyTrombinoscope === 'function') updatePrePartyTrombinoscope(m.guests, m.hostProfile);
          }).catch(()=>{});
        } else {
          enterCockpit();
        }
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
  
  $('code-join-btn').addEventListener('click', async () => {
    const code = $('party-code').value.trim().toUpperCase() || 'TEUF2025';
    state.partyCode = code;
    
    // Check if the party is in pre-party mode before jumping to cockpit
    try {
      const res = await fetch(`/api/party/${code}/meta`);
      if (res.ok) {
        const meta = await res.json();
        if (meta.isPreParty) {
          state.isPreParty = true;
          $('pre-party-host').textContent = `AVEC ${meta.hostName || 'DJ'}`;
          if (meta.welcomeText) $('pre-party-text').textContent = `"${meta.welcomeText}"`;
          if (meta.coverPhoto) {
            $('pre-party-cover').src = meta.coverPhoto;
            $('pre-party-cover-container').style.display = 'block';
          }
          if (meta.scheduledFor) startCountdown(meta.scheduledFor);
          if (meta.guests) updatePrePartyTrombinoscope(meta.guests, meta.hostProfile);
          
          showScreen('pre-party');
          if (!socket || !socket.connected) {
            connectToRelay();
          } else {
            socket.emit('guest:join', { name: state.guestName, lastName: state.guestLastName, alias: state.guestAlias, emoji: state.guestEmoji, photo: state.guestPhoto, partyCode: state.partyCode });
          }
          return; // Stop here, wait for host
        }
      }
    } catch (e) {
      console.warn("Could not fetch meta for code join:", e);
    }
    
    // If not pre-party (or fetch failed), enter cockpit normally
    enterCockpit();
  });
}

// ═══════════════════════════════════════════
// SCREEN 4: COCKPIT (enter)
// ═══════════════════════════════════════════
function enterCockpit() {
  showScreen('cockpit');
  
  // ★ Reset suggestions from previous party
  // Check if we changed party
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if (saved.partyCode !== state.partyCode) {
    state.suggestions = [];
    state.trackHistory = [];
    saveSession();
  }

  const suggestList = $('suggestions-list');
  if (suggestList) suggestList.innerHTML = '';
  
  $('greeting').textContent = `Hey ${state.guestName} ! 🎉`;
  
  if (state.guestPhoto) {
    const avatarImg = $('header-avatar-img');
    const avatarFallback = $('header-avatar-fallback');
    if (avatarImg && avatarFallback) {
      avatarImg.src = state.guestPhoto;
      avatarImg.style.display = 'block';
      avatarFallback.style.display = 'none';
    }
  }
  
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
    // Preserve stable guestId across reconnections (only set if no saved one)
    if (!state.guestId) {
      state.guestId = 'guest_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
    }
    updateConnection('connected', 'Connecté');
    
    // Try to resume existing session first
    const resumeData = loadResumeSession();
    if (resumeData && resumeData.partyCode === state.partyCode) {
      socket.emit('guest:resume', {
        partyCode: resumeData.partyCode,
        sessionToken: resumeData.sessionToken
      }, (response) => {
        if (response && response.ok) {
          console.log('[Resume] ✅ Session restored for', response.profile?.name);
          showToast('🔄 Reconnexion réussie !');
        } else {
          console.log('[Resume] ❌ Failed:', response?.reason, '— doing fresh join');
          clearResumeSession();
          freshJoin();
        }
      });
    } else {
      freshJoin();
    }
  });

  function freshJoin() {
    const consent = getConsent();
    socket.emit('guest:join', {
      guestId: state.guestId,
      userId: state.userId || null,
      name: state.guestName,
      lastName: state.guestLastName,
      alias: state.guestAlias,
      emoji: state.guestEmoji,
      photo: state.guestPhoto,
      phone: state.guestPhone,
      email: state.guestEmail,
      instagram: state.guestInsta,
      partyCode: state.partyCode,
      consentVersion: consent?.version || '1.0',
      consentTimestamp: consent?.timestamp || Date.now()
    });
  }

  // Store session token + userId for reconnection and friends API
  socket.on('session:token', (data) => {
    state.sessionToken = data.sessionToken;
    if (data.userId) state.userId = data.userId;
    saveSession();
    console.log('[Session] Token saved:', data.sessionToken.substring(0, 8) + '... userId:', data.userId || 'n/a');
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
      // Only rebuild diapo if photos have actual dataURL (full state).
      // Lightweight state (resync) sends metadata only — skip grid rebuild.
      const hasFullPhotos = ps.photos.some(p => p.dataURL);
      if (hasFullPhotos) {
        const grid = $('diapo-grid');
        if (grid) grid.innerHTML = '';
        state.diapoPhotos = new Set();
        ps.photos.forEach(p => {
          if (!p.dataURL) return;
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
    }
    // Costume contest entries: sync from server on join
    if (ps.costumeEntries && ps.costumeEntries.length) {
      state.costumeEntries = ps.costumeEntries;
      renderCostumeEntries();
    }
    // Restore next track
    if (ps.nextTrack) { state.nextTrack = ps.nextTrack; updateNextTrack(ps.nextTrack); }
    // Restore guest's own vote for current track (prevent double-voting after reconnect)
    if (ps.guestVotes && state.guestId && ps.currentTrack) {
      const myVotes = ps.guestVotes[state.guestId];
      const trackKey = ps.currentTrack.title || 'current';
      if (myVotes && myVotes[trackKey]) {
        state.currentVote = myVotes[trackKey];
        updateVoteButtons();
      }
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
        // Vote counts
        const fire = t.fireCount || 0;
        const like = t.likeCount || 0;
        const meh = t.mehCount || 0;
        let voteLine = '';
        if (fire > 0) voteLine += `<span style="font-size:9px;font-weight:800;color:#00bfff;">🔥${fire}</span> `;
        if (like > 0) voteLine += `<span style="font-size:9px;font-weight:800;color:#84cc16;">👍${like}</span> `;
        if (meh > 0) voteLine += `<span style="font-size:9px;font-weight:800;color:rgba(255,255,255,0.35);">👎${meh}</span>`;
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.03);border-radius:10px;margin-bottom:4px;">
            <span style="font-size:18px;">🔥</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:800;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.title} ${genreBadge}</div>
              <div style="font-size:10px;color:var(--text-dim);">${t.artist}</div>
              ${voteLine ? `<div style="margin-top:2px;">${voteLine}</div>` : ''}
              <div style="display:flex;gap:6px;margin-top:3px;">
                <a href="https://open.spotify.com/search/${q}" target="_blank" style="font-size:8px;font-weight:700;color:#1DB954;background:rgba(29,185,84,0.1);padding:2px 6px;border-radius:4px;text-decoration:none;">Spotify</a>
                <a href="https://music.apple.com/search?term=${q}" target="_blank" style="font-size:8px;font-weight:700;color:#fc3c44;background:rgba(252,60,68,0.1);padding:2px 6px;border-radius:4px;text-decoration:none;">Apple</a>
                <a href="https://www.deezer.com/search/${q}" target="_blank" style="font-size:8px;font-weight:700;color:#a855f7;background:rgba(168,85,247,0.1);padding:2px 6px;border-radius:4px;text-decoration:none;">Deezer</a>
              </div>
            </div>
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
          <div style="font-size:9px;color:var(--text-dim);margin-bottom:8px;">Garde un accès à tes soirées AhOuai</div>
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
    const isNew = state.currentTrack?.title !== track?.title;
    state.currentTrack = track;
    state.currentVote = null;
    updateNowPlaying(track);
    // Re-setup vote buttons — cloning removes old listeners and rebinds fresh ones
    // This ensures guests can vote once PER SONG, not once for the entire party
    setupVoteButtons();
    saveSession();
    console.log('[Track] New track → vote reset, buttons re-bound');
    
    // ★ Phase Visibilité : Moment de gloire (Haptic + Toast)
    if (isNew && track?.suggestedBy && track.suggestedBy === state.guestName) {
      if (navigator.vibrate) navigator.vibrate([100, 100, 200]);
      showToast('🎉 Ton morceau passe maintenant ! Regarde la piste !', 5000);
    }
  });

  socket.on('nextTrack:update', (track) => {
    state.nextTrack = track;
    updateNextTrack(track);
  });

  socket.on('mode:change', (data) => {
    state.mode = data.mode;
    updateDJMode();
  });

  socket.on('votes:update', (data) => {
    const prevVotes = state.genreVotes || {};
    state.genreVotes = data.genreVotes || {};
    // Si le serveur signale un fallback (tous les votes ont expiré)
    if (data.fallbackGenre) state._fallbackGenre = data.fallbackGenre;

    // Détecter si MON vote a expiré : mon genre n'est plus dans les votes actifs
    if (state.selectedGenre && !state.genreVotes[state.selectedGenre]) {
      const hadVotes = Object.values(prevVotes).length > 0;
      if (hadVotes) {
        // Mon vote a disparu → il a expiré
        console.log('[Trend] Mon vote a expiré :', state.selectedGenre);
        state._genreVoteExpired = true;
        // NE PAS reset state.selectedGenre ici — on montre juste le badge
      }
    }
    setupGenreTrends();   // refresh genre button grid with new counts
    updateGenreChart();   // refresh chart bars + trending badge
  });

  socket.on('history:update', (history) => {
    state.trackHistory = history;
    updateHistory();
    renderGuestSuggestions();
    populateMissions();
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

  socket.on('photos:update', (photos) => {
    if ($('end-screen') && !$('end-screen').classList.contains('hidden')) {
      refreshAllPhotos();
    } else if ($('socialhub-screen') && !$('socialhub-screen').classList.contains('hidden')) {
      refreshAllPhotos();
    }
  });

  // Photo error from server (cap exceeded, payload too large, etc.)
  socket.on('photo:error', (data) => {
    console.warn('[Photo] Server error:', data.error);
    alert(data.message || data.error || 'Erreur photo');
  });

  // Suggestion status feedback from host
  socket.on('suggestion:status', (data) => {
    // Only show notification to the guest who sent the suggestion
    if (data.guestName && data.guestName !== state.guestName) return;
    console.log('[Suggestion] Status update:', data.status, data.title);
    
    // Update state to persist status across reloads
    const sugg = state.suggestions.find(s => s.title === data.title);
    if (sugg) {
      sugg.status = data.status;
      saveSession();
    }
    
    showSuggestionToast(data.message || `Suggestion: ${data.status}`, data.status);
    
    // Update persistent status badge in suggestion list
    updateSuggestionBadge(data.title, data.status, data.message);
  });

  // ★ Bug 5b fix — Hydrate pending suggestion after reconnect
  // Server emits this on guest:resume / guest:join when a pending suggestion exists
  socket.on('suggestion:confirmed', (data) => {
    console.log('[Suggestion] confirmed:', data.title, '— fromReconnect:', data.fromReconnect);

    // Persist in local state (prevent double add)
    const alreadyInState = state.suggestions.find(s =>
      (s.title || '').toLowerCase() === (data.title || '').toLowerCase()
    );
    if (!alreadyInState) {
      state.suggestions.push({
        title: data.title,
        artist: data.artist,
        coverURL: data.coverURL || null,
        deezerID: data.deezerID || null,
        status: data.status || 'queued',
        sentAt: data.sentAt || new Date().toISOString()
      });
    } else {
      // Update status in case it changed (e.g. queued → next)
      alreadyInState.status = data.status || alreadyInState.status;
    }
    saveSession();

    if (data.fromReconnect) {
      // Reconnexion : suggestion existait déjà → toast discret
      showSuggestionToast(
        `✓ "${data.title}" est toujours en queue (pos. ${data.position || '?'})`,
        'pending'
      );
    } else {
      // Fresh suggestion confirmée par le serveur
      showSuggestionToast(
        `🎵 Suggestion envoyée ! Pos. ${data.position || '?'} dans la queue`,
        'queued'
      );
    }

    // Refresh suggestion badge in UI if the function exists
    updateSuggestionBadge(data.title, data.status || 'queued', null);
  });

  // ★ Bug 5b fix — Hydrate guest's previous votes on reconnect
  socket.on('votes:hydrate', (data) => {
    if (!data || !data.myVotes) return;
    console.log('[Votes] Hydrating previous votes:', Object.keys(data.myVotes).length, 'tracks');

    // Restore vote for the current track if we voted on it before disconnect
    const currentTitle = state.currentTrack?.title;
    if (currentTitle && data.myVotes[currentTitle]) {
      state.currentVote = data.myVotes[currentTitle];
      updateVoteButtons();
      console.log('[Votes] Restored vote for current track:', state.currentVote);
    }
  });

  // Costume entries updated from server
  socket.on('costume:entries', (entries) => {
    state.costumeEntries = entries;
    renderCostumeEntries();
  });

  // Costume contest closed by host
  socket.on('costume:closed', (data) => {
    state.costumeOpen = false;
    state.costumeEntries = data.podium || state.costumeEntries;
    // Track if this guest won
    if (data.winner && data.winner.guestId === state.guestId) {
      state.costumeWon = true;
    }
    renderCostumeEntries();
    showCostumeWinnerModal(data);
  });

  // Leaderboard updates from server
  socket.on('leaderboard:update', (leaderboard) => {
    state.leaderboard = leaderboard;
    renderLeaderboard();
    // Update my points from server data — match by id OR name
    const me = leaderboard.find(p => p.id === state.guestId || p.name === state.guestName);
    if (me) {
      state.missionPoints = me.points;
      const el = $('points-total');
      if (el) el.textContent = state.missionPoints;
      const headerEl = $('header-points-total');
      if (headerEl) headerEl.textContent = state.missionPoints;
    }
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
  
  // ★ NEW: Suggester Badge
  const suggesterEl = $('np-suggester');
  const suggesterName = $('np-suggester-name');
  const suggesterIcon = $('np-suggester-icon');
  const suggesterText = $('np-suggester-text');
  
  if (suggesterEl && suggesterName && suggesterIcon && suggesterText) {
    if (track.source === 'live_dj_shazam') {
      suggesterEl.style.display = 'inline-flex';
      suggesterName.textContent = 'DJ Live';
      suggesterIcon.textContent = '🎧';
      suggesterText.textContent = 'Choisi par le';
    } else if (track.source === 'guest_suggestion_fulfilled' || track.suggestedBy) {
      suggesterEl.style.display = 'inline-flex';
      suggesterName.textContent = track.suggestedBy || track.requestedBy?.guestName || 'Guest';
      suggesterIcon.textContent = '✨';
      suggesterText.textContent = 'Suggéré par';
    } else if (track.source === 'host_jukebox_manual') {
      suggesterEl.style.display = 'inline-flex';
      suggesterName.textContent = 'Jukebox';
      suggesterIcon.textContent = '🎚️';
      suggesterText.textContent = 'Choix';
    } else if (state.mode === 'appMix') { // appMix = Jukebox mode
      suggesterEl.style.display = 'inline-flex';
      suggesterName.textContent = 'DJ Brain';
      suggesterIcon.textContent = '🤖';
      suggesterText.textContent = 'Mixé par le';
    } else {
      // In DJ Live mode, don't show DJ Brain
      suggesterEl.style.display = 'none';
    }
  }

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

function updateNextTrack(track) {
  const bar = $('next-track-bar');
  if (!bar) return;
  if (!track || !track.title) {
    bar.style.display = 'none';
    return;
  }
  $('next-track-title').textContent = track.title;
  $('next-track-artist').textContent = track.artist || '';
  bar.style.display = 'block';
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
  // Reset visual state — cloneNode(true) preserves selected/dimmed classes
  updateVoteButtons();
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

  // Bandeau "vote expiré" si mon vote n'est plus actif
  const myVoteExpired = state._genreVoteExpired && state.selectedGenre &&
    !(state.genreVotes[state.selectedGenre] > 0);

  if (myVoteExpired) {
    const banner = document.createElement('div');
    banner.id = 'genre-expiry-banner';
    banner.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(255,152,0,0.12);border:1px solid rgba(255,152,0,0.3);border-radius:10px;margin-bottom:10px;cursor:pointer;-webkit-tap-highlight-color:transparent;';
    banner.innerHTML = `
      <span style="font-size:18px;">⏰</span>
      <div style="flex:1;">
        <div style="font-size:11px;font-weight:800;color:#ffb300;">Vote expiré après 30 min</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.5);">Ton vote pour <b style="color:#ffb300">${state.selectedGenre}</b> n'est plus actif. Revote !</div>
      </div>
      <span style="font-size:18px;">🔁</span>
    `;
    // Tap sur la banniere = re-voter le même genre
    banner.addEventListener('click', () => {
      state._genreVoteExpired = false;
      if (socket && socket.connected) {
        socket.emit('guest:genreVote', {
          genre: state.selectedGenre,
          guestName: state.guestName,
          guestId: state.guestId
        });
        showToast('🗳️ Vote renouvellé !');
      }
      setupGenreTrends();
    });
    grid.insertBefore(banner, grid.firstChild);
  }

  GENRES.forEach(genre => {
    const btn = document.createElement('button');
    const isSelected = state.selectedGenre === genre && !myVoteExpired;
    const isExpired  = state.selectedGenre === genre && myVoteExpired;
    btn.className = 'genre-btn' + (isSelected ? ' selected' : '') + (isExpired ? ' expired' : '');
    if (isExpired) btn.style.cssText = 'opacity:0.5;border-color:rgba(255,152,0,0.4);';
    btn.innerHTML = `
      <div class="genre-name">${genre}${isExpired ? ' ⏰' : ''}</div>
      <div class="genre-count">${state.genreVotes[genre] || 0} votes</div>
    `;
    btn.addEventListener('click', () => {
      const previousGenre = state.selectedGenre;
      state._genreVoteExpired = false; // Reset expiry on new vote

      // Toggle off if same genre, otherwise select new
      if (state.selectedGenre === genre && !myVoteExpired) {
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

  if (sorted.length === 0 && state._fallbackGenre) {
    // Aucun vote actif — afficher le genre de fallback
    container.innerHTML = `
      <div style="text-align:center;padding:10px;">
        <div style="font-size:10px;font-weight:800;color:rgba(255,152,0,0.8);letter-spacing:1px;margin-bottom:4px;">TENDANCE (dernière active)</div>
        <div style="font-size:18px;font-weight:900;color:white;">${state._fallbackGenre}</div>
        <div style="font-size:9px;color:rgba(255,255,255,0.4);margin-top:4px;">Vote pour influencer le DJ !</div>
      </div>`;
    $('trending-genre').textContent = state._fallbackGenre + ' *';
    setupGenreTrends();
    return;
  }

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

// ─── Suggest with Deezer Search ──────────────────────
let _suggestDebounce = null;

function setupSuggest() {
  const input = $('suggest-input');
  const searchBtn = $('suggest-search-btn');
  
  // Debounced auto-search on typing
  input.addEventListener('input', () => {
    const q = input.value.trim();
    // Show/hide search button
    searchBtn.style.display = q.length >= 2 ? 'block' : 'none';
    // Hide hint when typing
    const hint = $('suggest-hint');
    if (hint) hint.style.display = q.length > 0 ? 'none' : 'block';
    
    if (q.length < 2) {
      $('suggest-results').innerHTML = '';
      return;
    }
    
    // Debounce 500ms
    clearTimeout(_suggestDebounce);
    _suggestDebounce = setTimeout(() => {
      searchDeezerSuggestions();
    }, 500);
  });
  
  // Search on Enter
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(_suggestDebounce);
      searchDeezerSuggestions();
    }
  });
}

function searchDeezerSuggestions() {
  const input = $('suggest-input');
  const q = input.value.trim();
  if (q.length < 2) return;
  
  const container = $('suggest-results');
  container.innerHTML = '<div style="text-align:center;padding:10px;font-size:11px;color:rgba(255,255,255,0.4);">🔍 Recherche...</div>';
  
  fetch(`/api/deezer/search?q=${encodeURIComponent(q)}&limit=6`)
    .then(r => r.json())
    .then(json => {
      const tracks = (json.data || []);
      renderSuggestResults(tracks);
    })
    .catch(err => {
      console.error('[Suggest] Search error:', err);
      container.innerHTML = '<div style="text-align:center;padding:8px;font-size:10px;color:#ff6b6b;">❌ Erreur de recherche</div>';
    });
}

function loadTrendingSuggestions() {
  const container = $('suggest-results');
  container.innerHTML = '<div style="text-align:center;padding:10px;font-size:11px;color:rgba(255,255,255,0.4);">🌟 Chargement des suggestions...</div>';
  const hint = $('suggest-hint');
  if (hint) hint.style.display = 'none';
  
  // Use party explore endpoint (random picks from curated DB) instead of static Deezer chart
  const code = state.partyCode || '';
  fetch(`/api/party/${encodeURIComponent(code)}/explore?limit=12`)
    .then(r => r.json())
    .then(json => {
      const tracks = (json.data || []).filter(t => t.id); // filter out tracks without deezerID
      if (tracks.length === 0) {
        // Fallback to Deezer chart if explore returns nothing
        fetch('/api/deezer/chart?limit=8')
          .then(r => r.json())
          .then(j => renderSuggestResults(j.data || []))
          .catch(() => {
            container.innerHTML = '<div style="text-align:center;padding:8px;font-size:10px;color:#ff6b6b;">❌ Impossible de charger</div>';
          });
        return;
      }
      renderSuggestResults(tracks);
    })
    .catch(err => {
      console.error('[Suggest] Explore error:', err);
      // Fallback to Deezer chart
      fetch('/api/deezer/chart?limit=8')
        .then(r => r.json())
        .then(j => renderSuggestResults(j.data || []))
        .catch(() => {
          container.innerHTML = '<div style="text-align:center;padding:8px;font-size:10px;color:#ff6b6b;">❌ Impossible de charger</div>';
        });
    });
}


function renderSuggestResults(tracks) {
  const container = $('suggest-results');
  
  if (!tracks.length) {
    container.innerHTML = '<div style="text-align:center;padding:8px;font-size:10px;color:rgba(255,255,255,0.3);">Aucun résultat</div>';
    return;
  }

  // Genre color map for badges
  const genreColors = {
    'Pop': '#ff6bca', 'Dance': '#00d2ff', 'Rock': '#ff4444', 'Rap': '#ffa726',
    'Latin': '#ff5252', 'Old school': '#ce93d8', 'Urban Groove': '#ab47bc',
    'Électro': '#00e5ff', 'Chill': '#69f0ae', 'Hip-Hop': '#ffa726',
    'House': '#00bcd4', 'Electro': '#00e5ff', 'Disco': '#e040fb',
    'R&B': '#ab47bc', 'COCOVARIET': '#ff7043', 'Afro': '#66bb6a',
    'Rock': '#ef5350', 'Jazz': '#78909c'
  };

  // Get current trending genre
  const trendingGenre = $('trending-genre')?.textContent || '';
  
  container.innerHTML = tracks.map(t => {
    // Cover art: prefer Deezer CDN, then coverArtURL from DB
    const cover = t.album?.cover_medium || t.album?.cover_small || '';
    const artist = t.artist?.name || 'Unknown';
    const dur = t.duration ? `${Math.floor(t.duration/60)}:${String(t.duration%60).padStart(2,'0')}` : '';
    const id = t.id;
    const title = t.title || '';
    
    // Genre / UI category badge
    const genre = t.uiCategoryPrimary || t.genre || '';
    const genreColor = genreColors[genre] || 'rgba(0,210,255,0.6)';
    
    // Energy score (1-10) → fire display
    const energy = t.energy || 0;
    const energyDisplay = energy > 0 ? (energy >= 8 ? '🔥' : energy >= 6 ? '⚡' : '✨') : '';
    
    // BPM
    const bpm = t.bpm || 0;
    
    // Is this track trending (matches current party genre)?
    const isTrending = genre && (genre === trendingGenre || t.genre === trendingGenre);
    
    return `
      <div class="suggest-result-item" data-id="${id}" style="
        display:flex;align-items:center;gap:10px;padding:8px 10px;
        background:${isTrending ? 'rgba(0,210,255,0.06)' : 'rgba(255,255,255,0.03)'};
        border:1px solid ${isTrending ? 'rgba(0,210,255,0.15)' : 'transparent'};
        border-radius:12px;margin-bottom:5px;
        cursor:pointer;transition:all 0.2s;
      " onmouseover="this.style.background='rgba(0,210,255,0.1)';this.style.borderColor='rgba(0,210,255,0.2)'"
         onmouseout="this.style.background='${isTrending ? 'rgba(0,210,255,0.06)' : 'rgba(255,255,255,0.03)'}';this.style.borderColor='${isTrending ? 'rgba(0,210,255,0.15)' : 'transparent'}'">
        ${cover 
          ? `<img src="${cover}" style="width:50px;height:50px;border-radius:10px;object-fit:cover;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,0.3);" onerror="this.outerHTML='<div style=\\'width:50px;height:50px;border-radius:10px;background:linear-gradient(135deg,rgba(0,210,255,0.15),rgba(138,43,226,0.1));display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;\\'>🎵</div>'">`
          : `<div style="width:50px;height:50px;border-radius:10px;background:linear-gradient(135deg,rgba(0,210,255,0.15),rgba(138,43,226,0.1));display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🎵</div>`}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="font-size:13px;font-weight:700;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHtml(title)}</span>
            ${isTrending ? '<span style="font-size:8px;background:rgba(0,210,255,0.2);color:#00d2ff;padding:1px 5px;border-radius:6px;font-weight:800;flex-shrink:0;">TREND</span>' : ''}
          </div>
          <div style="font-size:10px;color:rgba(255,255,255,0.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;">${escapeHtml(artist)}</div>
          <div style="display:flex;align-items:center;gap:5px;margin-top:3px;flex-wrap:wrap;">
            ${genre ? `<span style="font-size:8px;font-weight:800;color:${genreColor};background:${genreColor}15;padding:1px 6px;border-radius:6px;letter-spacing:0.3px;">${escapeHtml(genre)}</span>` : ''}
            ${bpm > 0 ? `<span style="font-size:8px;font-weight:700;color:rgba(255,255,255,0.3);">${bpm} BPM</span>` : ''}
            ${dur ? `<span style="font-size:8px;color:rgba(255,255,255,0.2);">· ${dur}</span>` : ''}
            ${energyDisplay ? `<span style="font-size:9px;" title="Énergie ${energy}/10">${energyDisplay}${energy}</span>` : ''}
          </div>
        </div>
        <button onclick="event.stopPropagation();sendSuggestion(${id}, '${escapeAttr(title)}', '${escapeAttr(artist)}', '${escapeAttr(cover)}', ${t.duration || 0})" style="
          display:flex;align-items:center;gap:3px;padding:7px 12px;
          background:linear-gradient(135deg,rgba(0,210,255,0.15),rgba(138,43,226,0.1));
          border:1px solid rgba(0,210,255,0.25);
          border-radius:20px;cursor:pointer;font-size:8px;font-weight:800;
          color:#00d2ff;letter-spacing:0.3px;flex-shrink:0;transition:all 0.2s;
        " id="suggest-send-${id}">
          <span>📤</span> PROPOSER
        </button>
      </div>`;
  }).join('');
}

function sendSuggestion(deezerID, title, artist, coverURL, duration) {
  if (!socket || !socket.connected) return;
  
  const btn = $(`suggest-send-${deezerID}`);
  if (btn) {
    btn.innerHTML = '<span>✅</span> ENVOYÉ';
    btn.style.background = 'rgba(0,200,83,0.2)';
    btn.style.borderColor = 'rgba(0,200,83,0.4)';
    btn.style.color = '#00c853';
    btn.style.pointerEvents = 'none';
  }
  
  // Send structured data to server
  socket.emit('guest:suggest', {
    title: title,
    artist: artist,
    deezerID: deezerID,
    coverURL: coverURL,
    duration: duration,
    query: `${title} - ${artist}`,
    guestName: state.guestName,
    guestId: state.guestId
  });
  
  console.log(`[Suggest] ✅ Sent: ${title} by ${artist} (ID: ${deezerID})`);
  
  // ★ D5: Dismiss mobile keyboard immediately
  const searchInput = $('suggest-input');
  if (searchInput) searchInput.blur();
  
  // Close dialog & clear autocomplete (delayed for visual feedback)
  setTimeout(() => {
    const searchResults = $('suggest-results');
    if (searchInput) searchInput.value = '';
    if (searchResults) searchResults.innerHTML = '';
  }, 1000);
  
  
  // Add to sent list
  state.suggestions.push({ title, artist, deezerID, status: 'pending' });
  
  const list = $('suggestions-list');
  const item = document.createElement('div');
  item.className = 'suggestion-item';
  item.setAttribute('data-suggest-title', title);
  item.innerHTML = `
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="suggestion-check">✅</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(title)} — ${escapeHtml(artist)}</span>
      </div>
      <div class="suggest-status-badge" style="margin-top:4px;font-size:9px;font-weight:800;color:rgba(255,255,255,0.4);display:flex;align-items:center;gap:4px;">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#888;"></span>
        💡 Envoyée au DJ
      </div>
    </div>`;
  list.appendChild(item);
  
  saveSession();
}

function renderGuestSuggestions() {
  const list = $('suggestions-list');
  if (!list) return;
  list.innerHTML = '';
  
  (state.suggestions || []).forEach(sugg => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.setAttribute('data-suggest-title', sugg.title);
    
    // Configs for status
    const configs = {
      pending:        { dot: '#888',    icon: '💡', label: 'Envoyée au DJ' },
      received:       { dot: '#00c853', icon: '✅', label: 'Reçue par le DJ' },
      already_played: { dot: '#ff9800', icon: '🔄', label: 'Déjà joué ce soir' },
      duplicate:      { dot: '#ab47bc', icon: '👥', label: 'Déjà demandé' },
      phase_wait:     { dot: '#ffc107', icon: '⏳', label: 'Gardée pour plus tard' },
      queued:         { dot: '#00b8a9', icon: '🎶', label: 'En file d\'attente' },
      next:           { dot: '#ff6b35', icon: '🔥', label: 'C\'est la prochaine !' },
      played:         { dot: '#ffd700', icon: '🎉', label: 'Bien joué !' },
      dismissed:      { dot: '#667',    icon: '😉', label: 'Peut-être plus tard' },
      accepted:       { dot: '#00c853', icon: '✅', label: 'Acceptée par le DJ !' },
      refused:        { dot: '#667',    icon: '😉', label: 'Pas pour ce soir' }
    };
    const c = configs[sugg.status] || configs.pending;
    const msg = sugg.message || `${c.icon} ${c.label}`;
    
    item.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="suggestion-check">✅</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(sugg.title)} — ${escapeHtml(sugg.artist)}</span>
        </div>
        <div class="suggest-status-badge" style="margin-top:4px;font-size:9px;font-weight:800;color:${c.dot};display:flex;align-items:center;gap:4px;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c.dot};box-shadow:0 0 4px ${c.dot};"></span>
          ${escapeHtml(msg)}
        </div>
      </div>`;
    list.appendChild(item);
  });
}

// Helpers for safe HTML rendering
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
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
  
  // Build local vote map as fallback (server enriches too but local may be fresher)
  const localVotes = {};
  (state.allVotes || []).forEach(v => {
    const t = v.trackTitle || v.trackId || '';
    if (!localVotes[t]) localVotes[t] = { fire: 0, like: 0, meh: 0 };
    if (v.type === 'fire') localVotes[t].fire++;
    else if (v.type === 'like') localVotes[t].like++;
    else if (v.type === 'meh') localVotes[t].meh++;
  });
  
  state.trackHistory.forEach((track, i) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const query = encodeURIComponent(`${track.artist} ${track.title}`);
    const genreBadge = track.genre ? `<span style="font-size:8px;font-weight:700;color:#00d2ff;background:rgba(0,210,255,0.1);padding:1px 6px;border-radius:4px;margin-left:6px;">${track.genre}</span>` : '';
    
    // Votes: prefer server-enriched data, fallback to local
    const sv = { fire: track.fireCount || 0, like: track.likeCount || 0, meh: track.mehCount || 0 };
    const lv = localVotes[track.title] || { fire: 0, like: 0, meh: 0 };
    const fire = Math.max(sv.fire, lv.fire);
    const like = Math.max(sv.like, lv.like);
    const meh = Math.max(sv.meh, lv.meh);
    
    let voteBadges = '';
    if (fire > 0) voteBadges += `<span style="font-size:9px;font-weight:800;color:#00bfff;">🔥${fire}</span> `;
    if (like > 0) voteBadges += `<span style="font-size:9px;font-weight:800;color:#84cc16;">👍${like}</span> `;
    if (meh > 0) voteBadges += `<span style="font-size:9px;font-weight:800;color:rgba(255,255,255,0.35);">👎${meh}</span>`;
    
    item.innerHTML = `
      <span class="history-num">${i + 1}</span>
      <div class="history-info">
        <div class="history-title">${track.title}${genreBadge}</div>
        <div class="history-artist">${track.artist}</div>
        ${(() => {
          const rb = track.requestedBy;
          const byGuest = rb?.source === 'suggestion' && rb?.guestName ? rb.guestName : (track.suggestedBy || null);
          
          if (track.source === 'live_dj_shazam') {
             return `<div style="margin-top:2px;font-size:10px;color:#00e0c4;font-weight:700;">🎧 Choisi par le DJ</div>`;
          } else if (track.source === 'guest_suggestion_fulfilled' || byGuest) {
             return `<div style="margin-top:2px;font-size:10px;color:#00d2ff;font-weight:700;">✨ Suggéré par ${escapeHtml(byGuest || 'Guest')}</div>`;
          } else if (track.source === 'host_jukebox_manual') {
             return `<div style="margin-top:2px;font-size:10px;color:#ffb300;font-weight:700;">🎚️ Choix Jukebox</div>`;
          } else {
             return `<div style="margin-top:2px;font-size:10px;color:rgba(187,134,252,0.8);font-weight:600;">🤖 DJ Brain</div>`;
          }
        })()}
        ${voteBadges ? `<div style="margin-top:2px;">${voteBadges}</div>` : ''}
        <div class="history-links">
          <a class="stream-link spotify" href="https://open.spotify.com/search/${query}" target="_blank">Spotify</a>
          <a class="stream-link apple" href="https://music.apple.com/search?term=${query}" target="_blank">Apple</a>
          <a class="stream-link deezer" href="https://www.deezer.com/search/${query}" target="_blank">Deezer</a>
        </div>
      </div>
    `;
    list.appendChild(item);
  });
  
  // Send message button — also bound via inline onclick="sendGuestMessage()"
  const sendBtn = $('send-message-btn');
  const msgInput = $('guest-message-input');
  if (sendBtn && msgInput) {
    sendBtn.addEventListener('click', (e) => { e.preventDefault(); sendGuestMessage(); });
    sendBtn.addEventListener('touchend', (e) => { e.preventDefault(); sendGuestMessage(); });
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendGuestMessage(); }
    });
  }
}

// Global function: send guest reaction message (callable from inline onclick)
let _sendLock = false;
function sendGuestMessage() {
  if (_sendLock) return; // Prevent double-fire from touchend+click
  const msgInput = $('guest-message-input');
  const statusEl = $('message-status');
  if (!msgInput) return;
  const message = msgInput.value.trim();
  if (!message) return; // Silently ignore empty — no nagging
  
  _sendLock = true;
  setTimeout(() => { _sendLock = false; }, 500);
  
  if (socket && socket.connected) {
    socket.emit('guest:message', {
      guestName: state.guestName || 'Guest',
      message: message,
      guestPhoto: state.guestPhoto || null,
      guestEmoji: state.guestEmoji || '🎉',
      guestId: state.guestId
    });
    console.log('[Message] Sent:', message);
    state.messagesSent = (state.messagesSent || 0) + 1;
    msgInput.value = '';
    if (statusEl) statusEl.textContent = '✅ Réaction envoyée !';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    populateMissions(); // refresh mission progress
  } else {
    if (statusEl) statusEl.textContent = '❌ Connexion perdue, recharge la page';
  }
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
    galleryInput.onchange = handleDiapoPhoto;
    console.log('[SocialHub] Gallery photo input bound to handleDiapoPhoto');
  }
  
  // Camera photo input (direct camera capture)
  const cameraInput = $('camera-photo-input');
  if (cameraInput) {
    cameraInput.onchange = handleDiapoPhoto;
    console.log('[SocialHub] Camera photo input bound');
  }
  
  // Send message: handled by global sendGuestMessage() + inline onclick
}

function populateTrombinoscope() {
  const grid = $('trombi-grid');
  const users = [
    { name: state.guestName || 'Toi', emoji: state.guestEmoji, photo: state.guestPhoto }
  ];
  renderTrombi(grid, users);
  renderCockpitTrombi(users);
}

function updateTrombinoscope(participants) {
  const key = participants.map(p => p.name).sort().join(',');
  if (state._lastTrombiKey === key) return;
  state._lastTrombiKey = key;
  
  state.participants = participants;
  const grid = $('trombi-grid');
  // Merge self + server participants (avoid duplicates)
  const users = [{ name: state.guestName || 'Toi', emoji: state.guestEmoji, photo: state.guestPhoto, phone: state.guestPhone, email: state.guestEmail, instagram: state.guestInsta, userId: state.userId, isSelf: true }];
  participants.forEach(p => {
    if (p.name !== state.guestName) {
      // Host: show real name with 🎧 badge (not "DJ")
      const displayName = p.isHost ? `${p.name} 🎧` : p.name;
      users.push({ name: displayName, emoji: p.emoji || '🎉', photo: p.photo || null, phone: p.phone || '', email: p.email || '', instagram: p.instagram || '', isHost: p.isHost || false, userId: p.userId || null });
    }
  });
  renderTrombi(grid, users);
  renderCockpitTrombi(users);
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

function renderCockpitTrombi(users) {
  const container = $('cockpit-trombi');
  if (!container) return;
  container.innerHTML = '';
  
  users.forEach((u, idx) => {
    const d = document.createElement('div');
    d.style.cssText = "width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255,255,255,0.2); overflow: hidden; flex-shrink: 0; cursor: pointer; position: relative;";
    
    if (u.photo) {
      const img = document.createElement('img');
      img.src = u.photo;
      img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
      d.appendChild(img);
    } else {
      const span = document.createElement('span');
      span.textContent = u.emoji || '😎';
      d.appendChild(span);
    }
    
    if (u.isHost) {
      d.style.border = "2px solid #00e0c4";
      const badge = document.createElement('div');
      badge.style.cssText = "position: absolute; bottom: -2px; background: #00e0c4; color: #000; font-size: 7px; font-weight: 900; padding: 1px 3px; border-radius: 4px; letter-spacing: 0.5px;";
      badge.textContent = "HÔTE";
      d.appendChild(badge);
    }
    
    d.addEventListener('click', () => showTrombiContact(idx));
    container.appendChild(d);
  });
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
  
  // Friend request button (only for other users, not self)
  let friendBtn = lb.querySelector('.trombi-friend-btn');
  if (!friendBtn) {
    friendBtn = document.createElement('button');
    friendBtn.className = 'trombi-friend-btn';
    friendBtn.style.cssText = 'padding:8px 20px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:10px;font-size:11px;font-weight:800;color:white;cursor:pointer;margin-top:6px;';
    vcardBtn.parentNode.insertBefore(friendBtn, vcardBtn.nextSibling);
  }
  
  if (u.isSelf || !u.userId) {
    friendBtn.style.display = 'none';
  } else {
    friendBtn.style.display = 'inline-block';
    // Check existing friend status
    const existingStatus = state._friendStatuses?.[u.userId];
    if (existingStatus === 'pending') {
      friendBtn.textContent = '⏳ DEMANDE ENVOYÉE';
      friendBtn.style.background = 'rgba(102,126,234,0.2)';
      friendBtn.style.color = '#667eea';
      friendBtn.onclick = null;
    } else if (existingStatus === 'accepted') {
      friendBtn.textContent = '✅ AMIS';
      friendBtn.style.background = 'rgba(0,224,196,0.15)';
      friendBtn.style.color = '#00e0c4';
      friendBtn.onclick = null;
    } else {
      friendBtn.textContent = '👥 AJOUTER EN AMI';
      friendBtn.style.background = 'linear-gradient(135deg,#667eea,#764ba2)';
      friendBtn.style.color = 'white';
      friendBtn.onclick = (e) => {
        e.stopPropagation();
        sendFriendRequest(u.userId, u.name);
        friendBtn.textContent = '⏳ DEMANDE ENVOYÉE';
        friendBtn.style.background = 'rgba(102,126,234,0.2)';
        friendBtn.style.color = '#667eea';
        friendBtn.onclick = null;
      };
    }
  }
  
  lb.style.display = 'flex';
}

// Send friend request via REST API
function sendFriendRequest(targetUserId, targetName) {
  if (!state.sessionToken || !targetUserId) return;
  if (!state._friendStatuses) state._friendStatuses = {};
  state._friendStatuses[targetUserId] = 'pending';
  
  fetch('/api/friends/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': state.sessionToken
    },
    body: JSON.stringify({ targetUserId, partyCode: state.partyCode })
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      console.log(`[Friends] ✅ Request sent to ${targetName}`);
    } else {
      console.warn(`[Friends] ⚠️ ${data.error}`);
      if (data.status === 'accepted') state._friendStatuses[targetUserId] = 'accepted';
    }
  })
  .catch(err => console.error('[Friends] Request failed:', err));
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
    .map(([name, votes]) => ({ name, value: votes + ' votes', emoji: '🕺' }));
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
  if (container) {
    container.innerHTML = '<div class="ranked-item" style="opacity: 0.5; justify-content: center;">Aucune chanson en attente</div>';
  }
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
  
  readFileAsDataURL(file, async (dataURL) => {
    if (!dataURL) { alert('❌ Erreur photo'); return; }
    
    // Upload to Cloudinary instead of broadcasting Base64
    const cloudUrl = await uploadToCloudinary(dataURL);
    if (!cloudUrl) return;
    
    // Update local entry
    const myEntry = (state.costumeEntries || []).find(en => en.guestId === state.guestId);
    if (myEntry) myEntry.photo = cloudUrl;
    renderCostumeEntries();
    
    // Also add to MES PHOTOS
    state.myPhotos = state.myPhotos || [];
    state.myPhotos.push(cloudUrl);
    updateMyPhotosGrid();
    populateMissions(); // refresh Paparazzi mission
    
    // Send costume photo to server (server addPhotoToParty adds to gallery + broadcasts)
    if (socket && socket.connected) {
      socket.emit('costume:photo', {
        guestId: state.guestId,
        photo: cloudUrl
      });
      console.log('[CostumePhoto] Emitted costume:photo');
    }
    saveSession();
  });
}

// Gallery photo handler — clone of handleCostumePhoto WITHOUT costume entry update
const GUEST_PHOTO_CAP = 6;

// handleGalleryPhoto has been merged into handleDiapoPhoto and is no longer used

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
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:20px;overflow-y:auto;-webkit-overflow-scrolling:touch;';
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;width:100%;max-width:400px;margin-bottom:12px;">
      <div style="color:white;font-size:13px;font-weight:800;">📷 ${name || 'Photo'}</div>
      <button class="lb-close-btn" style="width:36px;height:36px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:50%;color:white;font-size:18px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;-webkit-appearance:none;touch-action:manipulation;">✕</button>
    </div>
    <img src="${src}" style="max-width:100%;max-height:70vh;border-radius:12px;object-fit:contain;">
    ${voteHTML ? `<div style="margin-top:16px;">${voteHTML}</div>` : ''}
    <div style="margin-top:16px;padding-bottom:20px;">
      <button class="lb-close-btn" style="padding:12px 36px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);border-radius:14px;color:white;font-size:13px;font-weight:800;cursor:pointer;-webkit-appearance:none;touch-action:manipulation;">✕ FERMER</button>
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
  const isClosed = state.costumeOpen === false;
  const closedBadge = isClosed ? '<span style="font-size:8px;font-weight:900;color:#0d1117;background:#ffd700;padding:2px 8px;border-radius:12px;margin-left:6px;">TERMINÉ</span>' : '';
  const pointsBadge = isClosed ? '<div style="font-size:9px;font-weight:900;color:#0d1117;background:#ffd700;padding:2px 8px;border-radius:12px;display:inline-block;margin-top:4px;">+150 PTS 🏆</div>' : '';
  const photoHTML = winner.photo
    ? `<img src="${winner.photo}" style="width:80px;height:80px;border-radius:14px;object-fit:cover;border:2px solid rgba(255,215,0,0.5);cursor:pointer;" onclick="showPhotoLightbox('${winner.photo.replace(/'/g, "\\'")}','${winner.guestName}')">`
    : `<div style="width:80px;height:80px;border-radius:14px;background:rgba(255,215,0,0.1);display:flex;align-items:center;justify-content:center;font-size:36px;border:2px solid rgba(255,215,0,0.3);">${winner.emoji || '🎭'}</div>`;
  podium.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;padding:12px;background:linear-gradient(135deg,rgba(255,215,0,0.08),rgba(255,215,0,0.02));border:1px solid rgba(255,215,0,0.2);border-radius:14px;">
      ${photoHTML}
      <div style="flex:1;">
        <div style="font-size:9px;font-weight:800;color:rgba(255,215,0,0.7);letter-spacing:1px;margin-bottom:4px;">👑 MEILLEUR DÉGUISEMENT${closedBadge}</div>
        <div style="font-size:16px;font-weight:900;color:white;margin-bottom:2px;">${winner.guestName}</div>
        <div style="font-size:13px;font-weight:800;color:#bb86fc;">${winner.votes} ❤️</div>
        ${pointsBadge}
      </div>
    </div>
  `;
}

function showCostumeWinnerModal(data) {
  // Remove existing modal if any
  const existing = document.querySelector('.costume-winner-modal');
  if (existing) existing.remove();

  const winner = data.winner;
  const winnerHTML = winner
    ? `
      <div style="font-size:64px;margin-bottom:8px;">${winner.emoji || '🎭'}</div>
      <div style="font-size:12px;font-weight:900;color:rgba(255,215,0,0.7);letter-spacing:2px;margin-bottom:8px;">🏆 LE GAGNANT EST...</div>
      <div style="font-size:28px;font-weight:900;color:white;margin-bottom:12px;">${winner.guestName}</div>
      <div style="display:flex;gap:20px;justify-content:center;margin-bottom:16px;">
        <div style="text-align:center;">
          <div style="font-size:24px;font-weight:900;color:#bb86fc;">${winner.votes || 0}</div>
          <div style="font-size:8px;font-weight:900;color:var(--text-dim);">VOTES</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:24px;font-weight:900;color:#ffd700;">+150</div>
          <div style="font-size:8px;font-weight:900;color:var(--text-dim);">POINTS</div>
        </div>
      </div>
    `
    : '<div style="font-size:16px;font-weight:700;color:var(--text-dim);">Pas de gagnant cette fois !</div>';

  const overlay = document.createElement('div');
  overlay.className = 'costume-winner-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;background:rgba(13,17,23,0.96);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.3s ease;';
  overlay.innerHTML = `
    <div style="font-size:40px;margin-bottom:16px;">🎭</div>
    <div style="font-size:22px;font-weight:900;color:white;text-align:center;margin-bottom:4px;">CONCOURS DE<br>DÉGUISEMENTS</div>
    <div style="font-size:16px;font-weight:900;color:#ffd700;letter-spacing:3px;margin-bottom:24px;">TERMINÉ !</div>
    <div style="padding:20px;background:rgba(255,215,0,0.05);border:1px solid rgba(255,215,0,0.2);border-radius:20px;text-align:center;width:80%;max-width:300px;">
      ${winnerHTML}
    </div>
    <button class="cw-close-btn" style="margin-top:24px;padding:12px 40px;background:#ffd700;border:none;border-radius:24px;color:#0d1117;font-size:13px;font-weight:900;cursor:pointer;">FERMER</button>
  `;

  overlay.querySelector('.cw-close-btn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function populateMissions() {
  const voteCount = (state.allVotes || []).length;
  const photoCount = (state.myPhotos || []).length;
  const genreVoted = state.selectedGenre ? 1 : 0;
  const costumeJoined = state.costumeRegistered ? 1 : 0;
  
  const messageCount = state.messagesSent || 0;
  const suggestCount = (state.suggestions || []).length;
  const hasProfile = state.guestName && state.guestName !== 'Guest';
  const costumeWon = state.costumeWon || false;
  
  // Missions aligned with host — same names, same pts, same logic
  const missions = [
    {
      icon: '🗳️', title: 'VOTER POUR UN TITRE',
      desc: 'Chaque vote = +10 pts. Vote BOF, TOP ou LE FEU sur les titres du DJ !',
      target: null, current: voteCount, unit: 'votes',
      reward: '+10 pts/vote', cumulative: true,
      done: voteCount > 0
    },
    {
      icon: '📸', title: 'PRENDRE UNE PHOTO',
      desc: 'Chaque photo = +20 pts. Capture les meilleurs moments via le Social Hub !',
      target: null, current: photoCount, unit: 'photos',
      reward: '+20 pts/photo', cumulative: true,
      done: photoCount > 0
    },
    {
      icon: '📊', title: 'VOTER UNE TENDANCE',
      desc: 'Vote ton genre musical dans VOTE TENDANCE. +15 pts !',
      target: 1, current: genreVoted, unit: 'tendance',
      reward: '15 pts', cumulative: false,
      done: genreVoted >= 1
    },
    {
      icon: '✨', title: 'SUGGÉRER UN TITRE',
      desc: 'Chaque suggestion = +5 pts. Propose un titre au DJ !',
      target: null, current: suggestCount, unit: 'suggestions',
      reward: '+5 pts/sugg.', cumulative: true,
      done: suggestCount > 0
    },
    {
      icon: '🎭', title: 'PARTICIPER AU CONCOURS',
      desc: "Inscris-toi au Concours Déguisement ! +30 pts.",
      target: 1, current: costumeJoined, unit: 'inscription',
      reward: '30 pts', cumulative: false,
      done: costumeJoined >= 1
    },
    {
      icon: '🏆', title: 'GAGNER LE CONCOURS',
      desc: 'Décroche la victoire du concours de déguisements ! +150 pts.',
      target: 1, current: costumeWon ? 1 : 0, unit: 'victoire',
      reward: '150 pts', cumulative: false,
      done: costumeWon
    },
    {
      icon: '👤', title: 'COMPLÉTER MON PROFIL',
      desc: 'Ajoute ta photo et tes coordonnées. +25 pts.',
      target: 1, current: hasProfile ? 1 : 0, unit: 'profil',
      reward: '25 pts', cumulative: false,
      done: hasProfile
    },
    {
      icon: '💬', title: 'ENVOYER UNE RÉACTION',
      desc: 'Chaque message = +10 pts. Réagis et envoie des post-its !',
      target: null, current: messageCount, unit: 'messages',
      reward: '+10 pts/msg', cumulative: true,
      done: messageCount > 0
    }
  ];
  const list = $('missions-list');
  list.innerHTML = '';
  missions.forEach(m => {
    const done = m.done;
    const item = document.createElement('div');
    item.className = 'mission-item';
    item.style.cssText = `display:flex; gap:12px; align-items:flex-start; padding:12px; background:rgba(255,255,255,0.03); border-radius:12px; margin-bottom:8px; ${done && !m.cumulative ? 'opacity:0.6;' : ''}`;
    
    // For cumulative: show count. For one-shot: show ✅/⬜
    let statusHTML;
    if (m.cumulative) {
      statusHTML = `<span style="font-size:11px;font-weight:800;color:${m.current > 0 ? '#00e0c4' : 'var(--text-dim)'}">${m.current} ×</span>`;
    } else {
      const progress = m.target ? Math.min(100, Math.round((m.current / m.target) * 100)) : 0;
      statusHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
            <div style="width:${progress}%;height:100%;background:${done ? '#00e0c4' : 'linear-gradient(90deg,#00d2ff,#8a2be2)'};border-radius:2px;transition:width 0.5s ease;"></div>
          </div>
          <span style="font-size:14px">${done ? '✅' : '⬜'}</span>
        </div>`;
    }
    
    item.innerHTML = `
      <div style="font-size:24px; flex-shrink:0; width:36px; text-align:center;">${done && !m.cumulative ? '✅' : m.icon}</div>
      <div style="flex:1; min-width:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-size:11px; font-weight:800; color:${done ? '#00e0c4' : 'white'}; letter-spacing:0.5px; ${done && !m.cumulative ? 'text-decoration:line-through;' : ''}">${m.title}</span>
          <span style="font-size:9px; font-weight:700; color:#ffc107; background:rgba(255,193,7,0.1); padding:2px 8px; border-radius:8px;">${m.reward}</span>
        </div>
        <div style="font-size:10px; color:rgba(255,255,255,0.5); line-height:1.4; margin-bottom:6px;">${m.desc}</div>
        ${statusHTML}
      </div>
    `;
    list.appendChild(item);
  });
  
  // Display points from SERVER leaderboard (single source of truth)
  // The local calculation was broken — server tracks all point additions
  const pointsEl = $('points-total');
  const headerPointsEl = $('header-points-total');
  if (pointsEl || headerPointsEl) {
    const serverEntry = (state.leaderboard || []).find(p => p.id === state.guestId || p.name === state.guestName);
    const pts = serverEntry ? serverEntry.points : (state.missionPoints || 0);
    if (pointsEl) pointsEl.textContent = pts;
    if (headerPointsEl) headerPointsEl.textContent = pts;
  }
}

function handleDiapoPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  console.log('[Photo] File selected:', file.name, file.size, 'bytes');
  
  e.target.value = '';
  state.myPhotos = state.myPhotos || [];
  if (!(state.diapoPhotos instanceof Set)) state.diapoPhotos = new Set();
  
  // Check per-guest photo cap (costume photos excluded)
  if (state.myPhotos.length >= GUEST_PHOTO_CAP) {
    alert('📷 Limite atteinte ! Tu as déjà pris ' + GUEST_PHOTO_CAP + ' photos.');
    return;
  }
  
  // Use FileReader (more reliable on mobile than createObjectURL)
  readFileAsDataURL(file, async (dataURL) => {
    if (!dataURL) {
      console.error('[Photo] Failed to read file');
      alert('❌ Erreur lors de la lecture de la photo');
      return;
    }
    
    // Upload to Cloudinary instead of broadcasting Base64
    const cloudUrl = await uploadToCloudinary(dataURL);
    if (!cloudUrl) return;
    
    console.log('[Photo] Cloudinary URL OK:', cloudUrl);
    
    state.myPhotos.push(cloudUrl);
    try { addDiapoPhoto(cloudUrl, state.guestName); } catch(e) { console.warn('[Photo] addDiapoPhoto error:', e); }
    updateMyPhotosGrid();
    saveSession();
    
    if (socket && socket.connected) {
      socket.emit('guest:photo', {
        dataURL: cloudUrl,
        guestName: state.guestName
      });
      console.log('[Photo] Emitted to server');
    } else {
      console.warn('[Photo] Socket not connected!');
    }
  });
}

// ═══════════════════════════════════════════
// CLOUDINARY UPLOAD
// ═══════════════════════════════════════════
async function uploadToCloudinary(dataURL) {
  const CLOUD_NAME = 'dtj9ds4xi';
  const UPLOAD_PRESET = 'socialmix_preset';
  
  let indicator = document.createElement('div');
  indicator.id = 'upload-indicator';
  indicator.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:white;padding:16px 28px;border-radius:14px;font-size:13px;font-weight:800;z-index:99999;backdrop-filter:blur(10px);';
  indicator.textContent = '☁️ Envoi dans le cloud...';
  document.body.appendChild(indicator);
  
  try {
    const formData = new FormData();
    formData.append('file', dataURL);
    formData.append('upload_preset', UPLOAD_PRESET);
    
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: formData
    });
    
    if (!res.ok) throw new Error('Cloudinary error');
    
    const data = await res.json();
    indicator.remove();
    return data.secure_url;
  } catch (err) {
    console.error('[Cloudinary] Upload failed:', err);
    indicator.remove();
    alert("❌ Erreur lors de l'envoi de la photo. Réessaie !");
    return null;
  }
}

// Reliable file reading + resize for mobile
// Params: 1200px max long side, JPEG quality 0.70 (validated for party photos)
function readFileAsDataURL(file, callback) {
  const MAX_PHOTO_SIZE = 1200;
  const JPEG_QUALITY = 0.85;
  
  // Show compression indicator if it takes > 500ms
  let compressionTimer = null;
  let indicator = null;
  compressionTimer = setTimeout(() => {
    indicator = document.createElement('div');
    indicator.id = 'compression-indicator';
    indicator.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:white;padding:16px 28px;border-radius:14px;font-size:13px;font-weight:800;z-index:99999;backdrop-filter:blur(10px);';
    indicator.textContent = '\u{1F4F8} Compression de la photo...';
    document.body.appendChild(indicator);
  }, 500);
  
  const cleanup = () => {
    clearTimeout(compressionTimer);
    if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
  };
  
  resizeImage(file, MAX_PHOTO_SIZE, JPEG_QUALITY, (resized) => {
    cleanup();
    if (resized) {
      console.log('[Photo] Compressed OK, length:', resized.length, '(~' + Math.round(resized.length / 1024) + ' KB)');
      callback(resized);
    } else {
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
    let w = img.width, h = img.height;
    const longestSide = Math.max(w, h);
    
    // Even small images must go through canvas for PNG→JPEG conversion
    // (iPhone screenshots can be small but still PNG = huge base64)
    if (longestSide <= maxSize) {
      console.log('[Photo] Small image (' + w + 'x' + h + '), converting to JPEG without resize');
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const dataURL = canvas.toDataURL('image/jpeg', quality);
      URL.revokeObjectURL(img.src);
      callback(dataURL);
      return;
    }
    
    // Resize proportionally
    if (w > h) {
      h = Math.round(h * maxSize / w); w = maxSize;
    } else {
      w = Math.round(w * maxSize / h); h = maxSize;
    }
    const canvas = document.createElement('canvas');
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
  const mid = Math.floor((dataURL || '').length / 2);
  const key = (dataURL || '').length + ':' + (dataURL || '').substring(mid, mid + 80);
  if (state.diapoPhotos.has(key)) {
    console.log('[Photo] Duplicate skipped');
    return;
  }
  state.diapoPhotos.add(key);
  
  const img = document.createElement('img');
  img.src = dataURL;
  img.alt = `photo de ${guestName || 'guest'}`;
  img.style.cssText = 'width:100%; border-radius:8px; aspect-ratio:1; object-fit:cover; cursor:pointer;';
  // Ouvre la lightbox avec bouton FERMER (plus de téléchargement automatique)
  img.addEventListener('click', () => showPhotoLightbox(dataURL, guestName || 'Guest'));
  grid.appendChild(img);
  console.log('[Photo] Added to diapo-grid, total:', grid.children.length);
}

// Refresh all photos from server state (catches missed photo:shared events)
function refreshAllPhotos() {
  if (!socket || !socket.connected) return;
  // Request full state — the party:state handler will rebuild diapo-grid
  socket.emit('guest:requestState');
}

window.deleteGalleryPhoto = function(dataURL, guestName) {
  if (!confirm("Es-tu sûr(e) de vouloir supprimer cette photo ?")) return;
  socket.emit('guest:deletePhoto', { dataURL, guestName });
  if (state.myPhotos) {
    state.myPhotos = state.myPhotos.filter(p => p !== dataURL);
  }
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
  // Show the end-of-party screen instead of just going to landing
  // Build a minimal end screen with social hub access
  const trackHistory = state.trackHistory || [];
  const participants = state.participants || [];
  const photos = state.photos || [];
  
  // Disconnect socket
  if (socket) { socket.disconnect(); socket = null; }
  clearResumeSession();
  
  // Build the end screen (reuse the party:ended screen structure)
  const cockpit = $('cockpit-screen');
  showScreen('cockpit'); // Ensure we are on the cockpit screen
  
  // Build participant grid
  window._endPartyParticipants = participants;
  window._endPartyPhotos = photos;
  
  let trombiHTML = '';
  if (participants.length) {
    trombiHTML = participants.map((p, pidx) => {
      const shortName = (p.name || 'Guest').length > 7 ? (p.name || 'Guest').substring(0, 7) + '…' : (p.name || 'Guest');
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
  
  // Build photo gallery
  let galleryHTML = '';
  if (photos.length) {
    galleryHTML = photos.map((p, i) => {
      const isMine = p.guestName === state.guestName;
      const deleteBtn = isMine ? `<div style="position:absolute;top:4px;right:4px;width:24px;height:24px;background:rgba(0,0,0,0.6);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;cursor:pointer;z-index:2;" onclick="event.stopPropagation(); deleteGalleryPhoto('${p.dataURL}', '${p.guestName.replace(/'/g, "\\'")}')">❌</div>` : '';
      return `
      <div style="position:relative;" data-photo-idx="${i}">
        ${deleteBtn}
        <img src="${p.dataURL}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;border:2px solid rgba(255,255,255,0.1);cursor:pointer" onclick="showEndPhotoLightbox('${i}')">
        <div style="font-size:8px;font-weight:700;color:rgba(255,255,255,0.5);text-align:center;margin-top:2px;">${(p.guestName || 'Guest').substring(0, 7)}</div>
      </div>`;
    }).join('');
  }
  
  // Build favorite tracks
  const myFires = (state.allVotes || []).filter(v => v.type === 'fire' && v.guestName === state.guestName);
  const fireTrackTitles = [...new Set(myFires.map(v => v.trackTitle))];
  const favTracks = trackHistory.filter(t => fireTrackTitles.includes(t.title));
  let favTracksHTML = '';
  if (favTracks.length) {
    favTracksHTML = favTracks.map(t => {
      const q = encodeURIComponent(`${t.artist} ${t.title}`);
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.03);border-radius:10px;margin-bottom:4px;">
          <span style="font-size:18px;">🔥</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:800;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.title)}</div>
            <div style="font-size:10px;color:var(--text-dim);">${escapeHtml(t.artist)}</div>
            <div style="display:flex;gap:6px;margin-top:3px;">
              <a href="https://open.spotify.com/search/${q}" target="_blank" style="font-size:8px;font-weight:700;color:#1DB954;background:rgba(29,185,84,0.1);padding:2px 6px;border-radius:4px;text-decoration:none;">Spotify</a>
              <a href="https://music.apple.com/search?term=${q}" target="_blank" style="font-size:8px;font-weight:700;color:#fc3c44;background:rgba(252,60,68,0.1);padding:2px 6px;border-radius:4px;text-decoration:none;">Apple</a>
              <a href="https://www.deezer.com/search/${q}" target="_blank" style="font-size:8px;font-weight:700;color:#a855f7;background:rgba(168,85,247,0.1);padding:2px 6px;border-radius:4px;text-decoration:none;">Deezer</a>
            </div>
          </div>
        </div>`;
    }).join('');
  }
  
  cockpit.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;padding:20px;text-align:center;overflow-y:auto;max-height:100vh;-webkit-overflow-scrolling:touch">
      <div style="font-size:50px;margin-bottom:8px">👋</div>
      <h2 style="color:white;font-size:22px;font-weight:900;margin-bottom:2px">MERCI D'ÊTRE VENU(E) !</h2>
      <p style="color:var(--text-dim);font-size:12px;margin-bottom:16px">À bientôt pour une prochaine soirée AhOuai 🎧</p>
      
      ${favTracksHTML ? `
        <div class="card" style="width:100%;max-width:340px;margin-bottom:12px">
          <div style="font-size:10px;font-weight:800;color:var(--turquoise);letter-spacing:1px;margin-bottom:10px">🎵 TES TITRES PRÉFÉRÉS</div>
          ${favTracksHTML}
        </div>` : ''}
      
      ${trombiHTML ? `
        <div class="card" style="width:100%;max-width:340px;margin-bottom:12px">
          <div style="font-size:10px;font-weight:800;color:var(--turquoise);letter-spacing:1px;margin-bottom:10px">👥 LE CREW</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">${trombiHTML}</div>
          <div style="font-size:9px;color:var(--text-dim);margin-top:8px">Tape un nom pour ajouter à tes contacts</div>
        </div>` : ''}
      
      ${galleryHTML ? `
        <div class="card" style="width:100%;max-width:340px;margin-bottom:12px">
          <div style="font-size:10px;font-weight:800;color:var(--turquoise);letter-spacing:1px;margin-bottom:10px">📸 PHOTOS (${photos.length})</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px" id="end-photo-grid">${galleryHTML}</div>
        </div>` : ''}
      
      <button onclick="window.location.reload()" class="cta-btn" style="width:100%;max-width:300px;margin-top:12px;-webkit-appearance:none;touch-action:manipulation;">🔄 REJOINDRE UNE AUTRE SOIRÉE</button>
      
      <div style="margin-top:16px;padding:14px 20px;background:linear-gradient(135deg,rgba(0,210,255,0.08),rgba(138,43,226,0.06));border:1px solid rgba(0,210,255,0.15);border-radius:12px;width:100%;max-width:300px;text-align:center;">
        <div style="font-size:20px;margin-bottom:4px;">📱</div>
        <div style="font-size:11px;font-weight:800;color:white;margin-bottom:2px;">TÉLÉCHARGE L'APP</div>
        <div style="font-size:9px;color:var(--text-dim);margin-bottom:8px;">Garde un accès à tes soirées AhOuai</div>
        <button onclick="alert('Bientôt disponible sur l\\'App Store ! 🎧')" style="padding:8px 20px;background:linear-gradient(135deg,#00d2ff,#8a2be2);border:none;border-radius:10px;font-size:11px;font-weight:800;color:white;cursor:pointer;-webkit-appearance:none;touch-action:manipulation;">🍎 DISPONIBLE BIENTÔT</button>
      </div>
      
      <div style="height:40px"></div>
    </div>
    
    <!-- Contact card overlay -->
    <div id="end-contact-card" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:20px" onclick="this.style.display='none'">
      <div id="end-contact-emoji" style="font-size:60px"></div>
      <div id="end-contact-name" style="font-size:22px;font-weight:900;color:white"></div>
      <button id="end-contact-btn" style="padding:10px 24px;background:linear-gradient(135deg,#00e0c4,#00b8a9);border:none;border-radius:10px;font-size:12px;font-weight:800;color:#0a0e1a;cursor:pointer;-webkit-appearance:none;touch-action:manipulation;" onclick="event.stopPropagation()">📇 AJOUTER AUX CONTACTS</button>
      <div onclick="event.stopPropagation();this.parentElement.style.display='none'" style="margin-top:8px;font-size:11px;font-weight:800;color:rgba(255,255,255,0.4);cursor:pointer;-webkit-appearance:none;touch-action:manipulation;">✕ FERMER</div>
    </div>
    
    <!-- Photo lightbox overlay -->
    <div id="end-photo-lightbox" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.92);z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:14px;padding:20px" onclick="this.style.display='none'">
      <img id="end-photo-img" style="max-width:90%;max-height:60vh;border-radius:14px;border:2px solid rgba(0,224,196,0.3)">
      <div id="end-photo-author" style="font-size:12px;font-weight:700;color:var(--text-dim)"></div>
      <button id="end-photo-save" style="padding:10px 24px;background:linear-gradient(135deg,#00c853,#00bfa5);border:none;border-radius:10px;font-size:12px;font-weight:800;color:#0a0e1a;cursor:pointer;-webkit-appearance:none;touch-action:manipulation;" onclick="event.stopPropagation()">💾 ENREGISTRER</button>
      <div onclick="event.stopPropagation();this.parentElement.style.display='none'" style="margin-top:4px;font-size:11px;font-weight:800;color:rgba(255,255,255,0.4);cursor:pointer">✕ FERMER</div>
    </div>`;
  showScreen('cockpit');
}

// ═══════════════════════════════════════════
// QR CODE SHARING
// ═══════════════════════════════════════════
function showPartyQR() {
  if (!state.partyCode) return;
  const qrModal = $('qr-modal');
  const qrImg = $('qr-code-img');
  const qrText = $('qr-code-text');
  
  if (qrModal && qrImg && qrText) {
    const partyUrl = `${window.location.origin}/?code=${state.partyCode}`;
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(partyUrl)}`;
    qrText.textContent = state.partyCode;
    qrModal.classList.remove('hidden');
  }
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
async function init() {
  const hasProfile = loadProfile();
  const hasSession = loadSession();
  const params = getURLParams();
  
  // Apply URL params
  if (params.name) state.guestName = params.name;
  if (params.emoji) state.guestEmoji = params.emoji;
  if (params.code) state.partyCode = params.code.toUpperCase();
  
  // Setup all screens (must run before pre-party early return so listeners are attached)
  setupConsent();
  setupProfile();
  setupCodeScreen();
  setupSocialHub();
  setupExitModal();

  // Auto-rejoin if session + profile exist
  const resumeSession = loadResumeSession();
  const activeCode = state.partyCode || (resumeSession ? resumeSession.partyCode : null);

  const isPreParty = await setupLanding(activeCode);
  if (isPreParty) return; // Halt normal sequence, pre-party screen handles it
  
  // If scanning a different QR code, clear the old session
  if (params.code && resumeSession && resumeSession.partyCode !== params.code.toUpperCase()) {
    clearResumeSession();
  }
  
  if (hasSession && hasProfile && state.partyCode && state.guestName) {
    enterCockpit();
  } else if (resumeSession && hasProfile) {
    // Resume from session token (page reload, tab closed/reopened)
    state.partyCode = resumeSession.partyCode;
    state.guestName = resumeSession.guestName || state.guestName;
    enterCockpit();
  } else if (params.code && hasProfile && state.guestName) {
    // QR scan with existing profile → skip to cockpit directly
    enterCockpit();
  } else if (params.code) {
    // QR scan, no profile yet → consent first (if not already given)
    showScreen(hasConsent() ? 'profile' : 'consent');
  } else {
    showScreen('landing');
  }
}

document.addEventListener('DOMContentLoaded', init);

function startCountdown(dateString) {
  const target = new Date(dateString).getTime();
  const el = document.getElementById('pre-party-countdown');
  
  if (!el || isNaN(target)) return;
  
  function update() {
    const now = Date.now();
    const diff = target - now;
    
    if (diff <= 0) {
      el.textContent = "00:00:00";
      return;
    }
    
    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);
    
    el.textContent = 
      String(h).padStart(2, '0') + ':' + 
      String(m).padStart(2, '0') + ':' + 
      String(s).padStart(2, '0');
  }
  
  update();
  setInterval(update, 1000);
}


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
  lines.push(`NOTE:Rencontré(e) à la soirée AhOuai 🎧`);
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

// ═══════════════════════════════════════════════════════════════════
// MISSIONS & LEADERBOARD
// ═══════════════════════════════════════════════════════════════════

const MISSIONS = [
  { id: 'vote',    icon: '🗳️', title: 'Voter pour un titre',           pts: 10, cumulative: true,  desc: 'Chaque vote = +10 pts' },
  { id: 'photo',   icon: '📸', title: 'Prendre une photo',             pts: 20, cumulative: true,  desc: 'Chaque photo = +20 pts' },
  { id: 'genre',   icon: '📊', title: 'Voter une tendance',            pts: 15, cumulative: false, desc: 'Vote ton genre musical' },
  { id: 'costume', icon: '🎭', title: 'Participer au concours',        pts: 30, cumulative: false, desc: 'Inscris-toi au concours' },
  { id: 'winner',  icon: '🏆', title: 'Gagner le concours',            pts: 150, cumulative: false, desc: 'Décroche la victoire !' },
  { id: 'profile', icon: '👤', title: 'Compléter mon profil',          pts: 25, cumulative: false, desc: 'Photo + contact' },
  { id: 'message', icon: '💬', title: 'Envoyer une réaction',          pts: 10, cumulative: true,  desc: 'Chaque message = +10 pts' }
];

function renderMissions() {
  const list = $('missions-list');
  if (!list) return;

  // Check which missions are done based on actual activity
  const done = {};
  if (state.guestPhoto) done.profile = true;
  if (state.currentVote) done.vote = true;
  if (state.selectedGenre) done.genre = true;
  if (state.costumeEntries && state.costumeEntries.some(e => e.guestId === state.guestId)) done.costume = true;
  // Merge with persisted
  Object.assign(done, state.missionsCompleted);

  // My total points from server
  const myPoints = state.missionPoints || 0;

  list.innerHTML = MISSIONS.map(m => {
    const isDone = done[m.id];
    const check = isDone ? '✅' : '⬜';
    const opacity = isDone ? '0.6' : '1';
    const strike = isDone && !m.cumulative ? 'text-decoration:line-through;' : '';
    const ptsLabel = m.cumulative ? `+${m.pts}/×` : `${m.pts} pts`;
    return `
      <div style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:rgba(255,255,255,0.03); border-radius:10px; opacity:${opacity}">
        <span style="font-size:18px">${m.icon}</span>
        <div style="flex:1">
          <div style="font-size:12px; font-weight:800; color:white; ${strike}">${m.title}</div>
          <div style="font-size:10px; color:rgba(255,255,255,0.4); margin-top:2px">${m.desc}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px; font-weight:900; color:#ffc107">${ptsLabel}</div>
          <div style="font-size:14px">${check}</div>
        </div>
      </div>
    `;
  }).join('');

  // Update total
  const el = $('points-total');
  if (el) el.textContent = myPoints;
  const headerEl = $('header-points-total');
  if (headerEl) headerEl.textContent = myPoints;
}

function renderLeaderboard() {
  const containers = [$('participant-leaderboard'), $('cockpit-leaderboard')].filter(Boolean);
  if (containers.length === 0) return;
  const lb = state.leaderboard || [];
  if (lb.length === 0) {
    const empty = '<div style="text-align:center; color:rgba(255,255,255,0.3); font-size:11px; padding:12px;">⏳ En attente d\'activité...</div>';
    containers.forEach(c => c.innerHTML = empty);
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const html = lb.slice(0, 10).map((p, i) => {
    const medal = medals[i] || `${i + 1}.`;
    const isMe = p.id === state.guestId;
    const highlight = isMe ? 'background:rgba(255,193,7,0.1); border:1px solid rgba(255,193,7,0.3);' : 'background:rgba(255,255,255,0.03);';
    return `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:10px; ${highlight}; margin-bottom:4px">
        <span style="font-size:16px; min-width:24px; text-align:center">${medal}</span>
        <span style="flex:1; font-size:12px; font-weight:700; color:${isMe ? '#ffc107' : 'white'}">${p.name}${isMe ? ' (toi)' : ''}</span>
        <span style="font-size:12px; font-weight:900; color:#ffc107">${p.points} pts</span>
      </div>
    `;
  }).join('');
  containers.forEach(c => c.innerHTML = html);
}
