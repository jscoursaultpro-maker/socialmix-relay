/**
 * public/host/host.js
 * ★ feat(host-web) — Cockpit hôte web Phase 1
 *
 * Flux : SSO Supabase → créer soirée (host:startParty) → Spotify PKCE →
 *        device → djbrain-lite → play T1 → queue T2 à T-45s → sonde →
 *        host:trackUpdate → guests voient le titre → Suivant → Just Play
 *
 * Authentification socket : socket.handshake.auth.token = JWT Supabase
 * (socketAuth.js L22 — pattern guest web réutilisé).
 *
 * Événements socket émis vers le serveur (comme iOS) :
 *   - host:startParty  { code, hostSecret, profile }
 *   - host:trackUpdate { title, artist, spotifyId, durationMs, source, artworkUrl }
 *
 * PROVISOIRE :
 *   - sélection titres via djbrain-lite (contrat stable [{trackId,title,artist,spotifyUri,durationMs}])
 *   - sera remplacé par DJ Brain serveur
 */

import SpotifyService from '/shared/spotify-service.js';

// ─── Config ───────────────────────────────────────────────────────────────────

// Client ID Spotify : chargé depuis /api/config/spotify (exposé par le serveur, comme Supabase)
// Public par nature (PKCE — pas de secret côté client), mais jamais hardcodé ici.
let SPOTIFY_CLIENT_ID = null;

// iOS timing (SpotifyService.swift L71, L76)
const QUEUE_BINDING_WINDOW_S  = 45; // T-45s avant fin → queue le prochain
const EARLY_TRANSITION_S      = 5;  // T-5s → handleTransition si nextQueued

// ─── State ────────────────────────────────────────────────────────────────────

let _supabase  = null;
let _socket    = null;
let _spotify   = null;

const STATE = {
  user:          null,   // {id, email, firstName, photoURL, supabaseToken}
  party:         null,   // {code, hostSecret}
  tracks:        [],     // [{trackId, title, artist, spotifyUri, durationMs, coverArtURL}]
  currentIdx:    0,
  nextQueued:    false,
  visibility:    'private',
  coverPhotoUrl: null,
  guestCount:    0,
  isPlaying:     false,
  queueTimer:    null,
  transTimer:    null,
  debugMode:     new URLSearchParams(window.location.search).has('debug')
};

// ─── Expose HOST globalement (appelé par onclick dans HTML) ───────────────────

window.HOST = {
  signIn, signOut, setVisibility, onCoverChange, onSpotifyCardClick,
  launchParty, justPlay, next, prev, togglePlay, share, retryDevices
};

// ─── Boot ─────────────────────────────────────────────────────────────────────

(async () => {
  _log('Boot host.js');

  // Charger config Spotify depuis le serveur (Client ID public PKCE)
  try {
    const cfgRes = await fetch('/api/config/spotify');
    const cfg    = cfgRes.ok ? await cfgRes.json() : {};
    SPOTIFY_CLIENT_ID = cfg.clientId || null;
    if (!SPOTIFY_CLIENT_ID) _log('⚠ /api/config/spotify : clientId manquant', 'warn');
  } catch (e) {
    _log(`Config Spotify erreur : ${e.message}`, 'error');
  }

  // Afficher Apple Music UNIQUEMENT sur Safari iOS
  if (_isSafariIOS()) {
    document.getElementById('apple-music-card').style.display = 'flex';
  }

  // Mode debug
  if (STATE.debugMode) {
    document.getElementById('log-panel').style.display = 'block';
  }

  // Pré-remplir date avec aujourd'hui
  const dateInput = document.getElementById('party-date');
  dateInput.value = new Date().toISOString().slice(0, 10);

  // Init Supabase
  await _initSupabase();

  // Vérifier session Supabase existante
  const session = await _getSupabaseSession();
  if (session) {
    await _onSupabaseSession(session);
  } else {
    // Pas de session → vérifier si callback PKCE Spotify (code + state=host_auth)
    const params = new URLSearchParams(window.location.search);
    if (params.get('code') && params.get('state') === 'host_auth') {
      // Callback Spotify → traité après la session Supabase est chargée
      _log('Détection callback Spotify PKCE');
      showScreen('screen-create');
      return;
    }
    // Aucune session — afficher auth gate
    showScreen('screen-create');
  }

  // Initialiser SpotifyService (charge tokens depuis sessionStorage)
  _initSpotify();

  // Callback PKCE Spotify (après boot) ?
  const spParams = new URLSearchParams(window.location.search);
  if (spParams.get('code') && spParams.get('state') === 'host_auth') {
    try {
      await _spotify.handleCallback();
      _log('PKCE Spotify OK');
      await _checkSpotifyPremium();
    } catch (e) {
      _log(`PKCE erreur : ${e.message}`, 'error');
      _showToast('Connexion Spotify échouée', 'error');
    }
  } else {
    // Peut-être déjà connecté Spotify (tokens en sessionStorage)
    const alreadyAuth = await _spotify.init();
    if (alreadyAuth) {
      await _checkSpotifyPremium();
    }
  }
})();

// ─── Supabase SSO ─────────────────────────────────────────────────────────────

async function _initSupabase() {
  try {
    const res  = await fetch('/api/config/supabase');
    const cfg  = await res.json();
    if (!cfg.enabled) return;
    _supabase = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: {
        storageKey: `sb-${new URL(cfg.url).hostname.split('.')[0]}-auth-token`,
        detectSessionInUrl: true
      }
    });
    _supabase.auth.onAuthStateChange((event, session) => {
      if (session) _onSupabaseSession(session);
    });
  } catch (e) {
    _log(`Supabase init erreur : ${e.message}`, 'error');
  }
}

async function _getSupabaseSession() {
  if (!_supabase) return null;
  try {
    const { data: { session } } = await _supabase.auth.getSession();
    return session;
  } catch (_) { return null; }
}

async function _onSupabaseSession(session) {
  const jwt = session?.access_token;
  if (!jwt) return;
  try {
    const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${jwt}` } });
    if (!res.ok) { _log('/api/me refus', 'warn'); return; }
    const user = await res.json();
    STATE.user = {
      id:           user._id || user.userId,
      email:        user.email || session.user?.email,
      firstName:    user.profile?.firstName || user.firstName || session.user?.user_metadata?.given_name || 'Hôte',
      photoURL:     user.profile?.photoURL || null,
      emoji:        user.profile?.emoji || '🎧',
      supabaseToken: jwt
    };
    _log(`SSO OK : ${STATE.user.firstName} (${STATE.user.email})`);
    _renderUser();
    _enableCreateForm();
    _connectSocket();
  } catch (e) {
    _log(`SSO erreur : ${e.message}`, 'error');
  }
}

function _renderUser() {
  const chip    = document.getElementById('user-chip');
  const avatar  = document.getElementById('user-avatar');
  const nameEl  = document.getElementById('user-name');
  if (!STATE.user) { chip.style.display = 'none'; return; }
  chip.style.display = 'flex';
  nameEl.textContent = STATE.user.firstName;
  if (STATE.user.photoURL) {
    avatar.innerHTML = `<img src="${STATE.user.photoURL}" alt="">`;
  } else {
    avatar.textContent = (STATE.user.firstName || 'H')[0].toUpperCase();
  }
  // Pré-remplir nom soirée
  const nameInput = document.getElementById('party-name');
  if (!nameInput.value) {
    nameInput.value = `Chez ${STATE.user.firstName}, ce soir`;
  }
}

function _enableCreateForm() {
  document.getElementById('auth-gate').style.display   = 'none';
  document.getElementById('create-form').style.display = 'block';
}

async function signIn() {
  if (!_supabase) { window.location.href = 'https://ahouai.com'; return; }
  try {
    await _supabase.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo: window.location.href }
    });
  } catch (e) { _log(`SignIn erreur : ${e.message}`, 'error'); }
}

async function signOut() {
  if (_supabase) await _supabase.auth.signOut();
  STATE.user = null;
  document.getElementById('auth-gate').style.display   = 'block';
  document.getElementById('create-form').style.display = 'none';
  document.getElementById('user-chip').style.display   = 'none';
}

// ─── Socket.IO (pattern socketAuth.js L22) ────────────────────────────────────

function _connectSocket() {
  if (_socket?.connected) return;
  _socket = io({
    auth: { token: STATE.user?.supabaseToken || null }
    // ★ Réutilise socketAuth.js : token → socket.user = User Mongoose
    // V0 clients sans token → socket.user = null (backward compat)
  });
  _socket.on('connect', () => _log(`Socket connecté : ${_socket.id}`, 'ok'));
  _socket.on('disconnect', () => _log('Socket déconnecté', 'warn'));
  _socket.on('party:state', _onPartyState);
  _socket.on('participants:update', _onParticipants);
  _socket.on('party:error', d => _showToast(d.message || 'Erreur soirée', 'error'));
}

function _onPartyState(state) {
  _log(`party:state reçu code=${state.code} phase=${state.currentPhase}`);
  if (!STATE.party) return;
  // Sync guest count
  const guests = (state.participants || []).filter(p => !p.isHost).length;
  STATE.guestCount = guests;
  document.getElementById('guest-count').textContent = guests;
}

function _onParticipants(participants) {
  const guests = (participants || []).filter(p => !p.isHost).length;
  STATE.guestCount = guests;
  document.getElementById('guest-count').textContent = guests;
}

// ─── Spotify ─────────────────────────────────────────────────────────────────

function _initSpotify() {
  _spotify = new SpotifyService({
    clientId: SPOTIFY_CLIENT_ID,
    onStateChange: _onSpotifyState,
    onNoDevice:    () => showScreen('screen-device'),
    onAutoPlay:    (d) => _log(`⚡ AUTOPLAY : ${d.name}`, 'warn'),
    onRelink:      (d) => _log(`🔗 RELINK : ${d.requested} → ${d.played}`, 'info'),
    onLog:         (msg, lvl) => _log(msg, lvl)
  });
}

async function _checkSpotifyPremium() {
  const me = await _spotify.fetchMe();
  if (!me) return;
  const card    = document.getElementById('spotify-card');
  const label   = document.getElementById('sp-label');
  const value   = document.getElementById('sp-value');
  const arrow   = document.getElementById('sp-arrow');
  const btnLaunch = document.getElementById('btn-launch');

  if (me.isPremium) {
    card.classList.add('connected');
    label.textContent = `Connecté : ${me.firstName}`;
    value.textContent = 'Premium ✓';
    value.className   = 'sp-value premium';
    arrow.textContent = '✓';
    btnLaunch.disabled = !STATE.party; // activé une fois la soirée créée
    _log(`Spotify Premium OK : ${me.firstName}`, 'ok');
  } else {
    card.classList.add('blocked');
    label.textContent = 'Compte Spotify Free';
    value.textContent = 'Le pilotage nécessite Premium';
    value.className   = 'sp-value free';
    arrow.textContent = '⚠';
    btnLaunch.disabled = true;
    _showToast('⚠ Spotify Free — Premium requis pour piloter la lecture', 'warn');
  }
}

async function onSpotifyCardClick() {
  const token = sessionStorage.getItem('sp_access_token');
  if (token) return; // déjà connecté
  await _spotify.startPKCE();
}

function _onSpotifyState(state) {
  if (!state) return;
  const { isPlaying, item, progress, duration } = state;

  STATE.isPlaying = isPlaying;

  if (!item) return;

  // UI Now Playing
  document.getElementById('np-title').textContent  = item.name || '—';
  document.getElementById('np-artist').textContent = (item.artists || []).map(a => a.name).join(', ') || '—';
  document.getElementById('np-status').textContent = isPlaying ? '▶' : '⏸';
  document.getElementById('btn-play-pause').textContent = isPlaying ? '⏸' : '▶';

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;
  document.getElementById('np-progress').style.width = `${pct}%`;
  document.getElementById('np-elapsed').textContent  = _ms2time(progress);
  document.getElementById('np-duration').textContent = _ms2time(duration);

  const artUrl = item.album?.images?.[1]?.url || item.album?.images?.[0]?.url || '';
  const artEl  = document.getElementById('np-art');
  if (artEl.src !== artUrl) {
    artEl.src = artUrl;
    document.getElementById('np-cover').classList.add('pulse');
    setTimeout(() => document.getElementById('np-cover').classList.remove('pulse'), 1000);
  }

  // ── iOS queue logic (pattern SpotifyService.swift L1171) ──
  // À T-45s : queue le prochain si pas encore fait
  const remaining = (duration - progress) / 1000;
  if (isPlaying && remaining <= QUEUE_BINDING_WINDOW_S && !STATE.nextQueued) {
    _queueNextTrack();
  }
  // À T-5s : transition précoce (comme iOS earlyTransitionThreshold L76)
  if (isPlaying && remaining <= EARLY_TRANSITION_S && STATE.nextQueued) {
    _log('⏱ Transition précoce T-5s (nextQueued) — Spotify gère le crossfade', 'info');
    _handleQueuedTransition();
  }
}

// ─── Party creation ───────────────────────────────────────────────────────────

async function launchParty() {
  if (!STATE.user) { _showToast('Connecte-toi d'abord', 'error'); return; }
  const name = document.getElementById('party-name').value.trim() ||
               `Chez ${STATE.user.firstName}, ce soir`;
  await _createAndStartParty(name, false);
}

async function justPlay() {
  if (!STATE.user) { _showToast('Connecte-toi d'abord', 'error'); return; }
  const name = `Chez ${STATE.user.firstName}, ce soir`;
  await _createAndStartParty(name, true);
}

async function _createAndStartParty(partyName, fast) {
  document.getElementById('btn-launch').disabled    = true;
  document.getElementById('btn-just-play').disabled = true;

  // 1. Générer code + secret
  const code       = _generateCode();
  const hostSecret = _randomString(32);
  STATE.party      = { code, hostSecret };

  _log(`Création soirée ${code}…`);

  // 2. Connecter socket si pas encore fait
  if (!_socket?.connected) _connectSocket();
  await new Promise(r => {
    if (_socket.connected) { r(); return; }
    _socket.once('connect', r);
    setTimeout(r, 3000); // fallback 3s
  });

  // 3. Émettre host:startParty (comme iOS — payload exact L4858 server.js)
  _socket.emit('host:startParty', {
    code,
    hostSecret,
    profile: {
      name:      STATE.user.firstName,
      email:     STATE.user.email,
      emoji:     STATE.user.emoji || '🎧',
      photo:     STATE.user.photoURL || null,
      phone:     '',
      instagram: ''
    },
    streamingProvider: 'spotify',
    deviceId: null
  });

  _log(`host:startParty émis (${code})`, 'ok');

  // 4. Vérifier Spotify
  if (!_spotify?.accessToken) {
    _showToast('Connexion Spotify…', 'info');
    await _spotify.startPKCE();
    return; // redirect → callback va reprendre
  }
  if (!_spotify.isPremium) {
    _showToast('⚠ Premium Spotify requis', 'warn');
    return;
  }

  // 5. Device
  const deviceId = await _spotify.ensureActiveDevice();
  if (!deviceId) {
    showScreen('screen-device');
    return;
  }

  // 6. Charger titres djbrain-lite
  await _loadAndPlayFirst(code);
}

async function _loadAndPlayFirst(code) {
  _log('Appel djbrain-lite…');
  try {
    const res = await fetch(`/api/djbrain-lite/next?partyCode=${code}&count=5&phase=arrival`);
    const data = await res.json();
    STATE.tracks    = data.tracks || [];
    STATE.currentIdx = 0;

    if (!STATE.tracks.length) {
      _showToast('Aucun titre trouvé — vérifie la BDD', 'error');
      return;
    }

    _log(`djbrain-lite: ${STATE.tracks.length} titres (${STATE.tracks[0]?.title})`);

    // 7. Play premier titre
    const first = STATE.tracks[0];
    const ok = await _spotify.play([first.spotifyUri]);
    if (!ok) return;

    // 8. Émettre host:trackUpdate (comme iOS L5167 server.js)
    _emitTrackUpdate(first);

    // 9. Afficher NowPlaying
    document.getElementById('np-party-code').textContent = code;
    _renderQR(code);
    showScreen('screen-playing');

  } catch (e) {
    _showToast(`Erreur chargement titres : ${e.message}`, 'error');
  }
}

// ─── Queue à T-45s (iOS pattern) ─────────────────────────────────────────────

async function _queueNextTrack() {
  const next = STATE.tracks[STATE.currentIdx + 1];
  if (!next) {
    // Plus de titres en réserve → recharger
    _log('Queue vide — rechargement djbrain-lite…', 'warn');
    try {
      const code = STATE.party?.code;
      const res  = await fetch(`/api/djbrain-lite/next?partyCode=${code}&count=5&phase=arrival`);
      const data = await res.json();
      const fresh = (data.tracks || []).filter(t =>
        !STATE.tracks.some(e => e.trackId === t.trackId)
      );
      STATE.tracks = [...STATE.tracks, ...fresh];
    } catch (_) { /* non-fatal */ }
  }

  const nextTrack = STATE.tracks[STATE.currentIdx + 1];
  if (!nextTrack) {
    _log('Pas de prochain titre — Spotify autoplay', 'warn');
    return;
  }

  _log(`Queue T-45s : ${nextTrack.title}`);
  const ok = await _spotify.queue(nextTrack.spotifyUri);
  if (ok) {
    STATE.nextQueued = true;
    _log(`📋 Queued : ${nextTrack.title}`, 'ok');
  }
}

function _handleQueuedTransition() {
  if (!STATE.nextQueued) return;
  const next = STATE.tracks[STATE.currentIdx + 1];
  if (!next) return;

  STATE.currentIdx++;
  STATE.nextQueued  = false;

  _log(`✅ Transition → ${next.title}`, 'ok');
  _emitTrackUpdate(next);

  // Charger plus si réserve < 2
  const remaining = STATE.tracks.length - STATE.currentIdx;
  if (remaining < 2) {
    _log('Réserve < 2 — rechargement djbrain-lite');
    fetch(`/api/djbrain-lite/next?partyCode=${STATE.party?.code}&count=5&phase=arrival`)
      .then(r => r.json())
      .then(d => {
        const fresh = (d.tracks || []).filter(t => !STATE.tracks.some(e => e.trackId === t.trackId));
        STATE.tracks = [...STATE.tracks, ...fresh];
        _log(`djbrain-lite: +${fresh.length} titres chargés`);
      })
      .catch(() => {});
  }
}

// ─── host:trackUpdate (comme iOS L5167 server.js) ────────────────────────────

function _emitTrackUpdate(track) {
  if (!_socket?.connected || !STATE.party) return;
  const payload = {
    title:      track.title,
    artist:     track.artist,
    spotifyId:  track.spotifyUri?.split(':').pop() || null,
    durationMs: track.durationMs || 0,
    artworkUrl: track.coverArtURL || null,
    source:     'djbrain-lite',  // PROVISOIRE
    sentAt:     new Date().toISOString()
  };
  // ★ Sécurité : l'émission host:trackUpdate est authentifiée par socket.user (JWT)
  // Si socket.user = null (V0 sans token), server.js accepte avec hostSecret uniquement.
  // ★ SIGNALEMENT : iOS n'envoie pas hostSecret dans host:trackUpdate — le serveur
  // fait confiance au socket s'il est dans la room host:{code}. On reproduit ce comportement.
  _socket.emit('host:trackUpdate', payload);
  _log(`host:trackUpdate émis : ${track.title}`, 'ok');
}

// ─── Playback controls ────────────────────────────────────────────────────────

async function next() {
  await _spotify?.next();
  // La sonde détectera la transition (nextExpectedUri)
}

async function prev() {
  // Spotify n'a pas de "previous" dans la Web API sans contexte — on re-joue le courant
  const curr = STATE.tracks[STATE.currentIdx];
  if (curr) await _spotify?.play([curr.spotifyUri]);
}

async function togglePlay() {
  if (!_spotify) return;
  if (STATE.isPlaying) { await _spotify.pause(); }
  else                 { await _spotify.resume(); }
}

// ─── Party info ───────────────────────────────────────────────────────────────

function _renderQR(code) {
  const container = document.getElementById('qr-container');
  container.innerHTML = '';
  const url = `${window.location.origin}/join?code=${code}`;
  try {
    new QRCode(container, {
      text: url, width: 140, height: 140,
      colorDark: '#00d4c8', colorLight: '#0a0a0f'
    });
  } catch (_) {
    container.innerHTML = `<a href="${url}" style="color:var(--cyan);word-break:break-all">${url}</a>`;
  }
}

async function share() {
  const code = STATE.party?.code;
  if (!code) return;
  const url = `${window.location.origin}/join?code=${code}`;
  if (navigator.share) {
    await navigator.share({ title: 'Rejoins la soirée !', url }).catch(() => {});
  } else {
    await navigator.clipboard.writeText(url).catch(() => {});
    _showToast('Lien copié !', 'success');
  }
}

// ─── Form controls ────────────────────────────────────────────────────────────

function setVisibility(v) {
  STATE.visibility = v;
  document.getElementById('vis-private').classList.toggle('active', v === 'private');
  document.getElementById('vis-friends').classList.toggle('active', v === 'friends');
}

function onCoverChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('cover-preview');
    preview.src = e.target.result;
    preview.style.display = 'block';
    STATE.coverPhotoUrl = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── Device picker ────────────────────────────────────────────────────────────

async function retryDevices() {
  const list = document.getElementById('device-list');
  list.innerHTML = '<div style="color:var(--muted);text-align:center"><span class="spinner"></span> Recherche…</div>';
  await _spotify?.fetchDevices();
  const devices = _spotify?.devices || [];
  if (!devices.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:14px;text-align:center;padding:12px">Aucun appareil trouvé. Ouvre Spotify et lance un titre.</div>';
    return;
  }
  list.innerHTML = '';
  devices.forEach(d => {
    const el = document.createElement('div');
    el.className = `device-item${d.is_active ? ' active' : ''}`;
    const icon = d.type === 'Computer' ? '💻' : d.type === 'Smartphone' ? '📱' : '🔊';
    el.innerHTML = `
      <span class="device-icon">${icon}</span>
      <div>
        <div class="device-name">${d.name}</div>
        <div class="device-type">${d.type}${d.is_active ? ' • Actif' : ''}</div>
      </div>
    `;
    el.onclick = async () => {
      await _spotify.transferToDevice(d.id);
      _showToast(`Device sélectionné : ${d.name}`, 'success');
      await _loadAndPlayFirst(STATE.party?.code);
    };
    list.appendChild(el);
  });
}

// ─── Screen navigation ────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function _generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function _randomString(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/[^a-zA-Z0-9]/g, '').slice(0, len);
}

function _ms2time(ms) {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function _isSafariIOS() {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) && /Safari/.test(ua) && !/Chrome/.test(ua);
}

function _showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent  = msg;
  el.className    = `toast show ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3000);
}

function _log(msg, level = 'info') {
  const time = new Date().toISOString().slice(11, 23);
  const full = `[${time}] ${msg}`;
  if (level === 'error') console.error('[HOST]', msg);
  else console.log('[HOST]', msg);

  if (STATE.debugMode) {
    const panel = document.getElementById('log-panel');
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    entry.textContent = full;
    panel.appendChild(entry);
    panel.scrollTop = panel.scrollHeight;
  }
}
