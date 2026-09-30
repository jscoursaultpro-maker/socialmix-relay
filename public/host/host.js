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

// ─── RÈGLE TDZ (Module ES) ────────────────────────────────────────────────────
// Toute variable let/const utilisée au boot (ligne ~66) doit être déclarée ICI,
// AVANT la ligne du boot. node --check ne détecte pas la TDZ ; seul un run le fait.
// Variables à déclarer en tête : celles référencées par _log, _logLoadFromSession,
// et toute fonction appelée directement dans le IIFE async de boot.

// ─── A4 : Variables log (déplacées ici depuis ~L1073 pour éviter la TDZ) ──────
// _log est appelée à L70 (boot). Ces const/let doivent précéder le boot.
const LOG_RING_MAX  = 400;
const LOG_RING_KEY  = 'host_log';
let   _logBuf       = [];  // ring buffer en mémoire (400 lignes max)
let   _logPanelOpen = false;

// ─── 2.2 : _IS_MOBILE (déclaré ici par précaution — showScreen peut être ──────
// appelé depuis le boot dans certains chemins de retour PKCE)
const _IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

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
  queuedForTrackId: null,   // A1 guard — URI du prochain mis en file (UN seul par morceau en cours)
  visibility:    'private',
  coverPhotoUrl: null,
  guestCount:    0,
  isPlaying:     false,
  queueTimer:    null,
  transTimer:    null,
  debugMode:     new URLSearchParams(window.location.search).has('debug') || sessionStorage.getItem('host_debug') === '1',
  sessionHandled: false  // guard double-appel onAuthStateChange/poll
};

// ─── Expose HOST globalement (appelé par onclick dans HTML) ───────────────────

window.HOST = {
  signIn, signOut, setVisibility, onCoverChange, onSpotifyCardClick,
  launchParty, justPlay, next, prev, togglePlay, share, retryDevices,
  onFirstNameInput, initWebPlayer, showScreen
};

// ─── Boot ─────────────────────────────────────────────────────────────────────

(async () => {
  // 1.2: Charger le ring buffer sessionStorage AVANT tout _log
  // (sinon 'Boot host.js' écrase l'historique précédent)
  _logLoadFromSession();
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

  // A4: Mode debug — pastille LOG + rendu du buffer dans le panel
  if (STATE.debugMode) {
    _logInitPanel(); // crée la pastille + bouton Copier
    _logRenderBuffer(); // affiche les lignes déjà dans _logBuf
  }

  // Pré-remplir date avec aujourd'hui
  const dateInput = document.getElementById('party-date');
  dateInput.value = new Date().toISOString().slice(0, 10);

  // ★ A.1 — Diagnostic cookies (debug uniquement — NOMS seuls, JAMAIS les valeurs)
  if (STATE.debugMode) {
    try {
      const allNames = document.cookie
        ? document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean)
        : [];
      const sbNames = allNames.filter(n => n.startsWith('sb-'));
      _log(
        `Cookies visibles (${allNames.length} total) : ` +
        (sbNames.length
          ? sbNames.join(', ')
          : '(aucun cookie sb-*) — domain=.ahouai.com non partagé ou ITP Safari')
      );
    } catch (e) {
      _log(`Diagnostic cookies err : ${e.message}`, 'warn');
    }
  }

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
    if (!res.ok) { _log('Supabase config 503 — SSO désactivé', 'warn'); return; }
    const cfg  = await res.json();
    if (!cfg.enabled || !cfg.url || !cfg.anonKey) { _log('Supabase config incomplète', 'warn'); return; }

    // ★ Cross-subdomain SSO (pattern app.js L671-712) :
    // Sur .ahouai.com : cookie domain=.ahouai.com partagé avec ahouai-web.
    // En local (127.0.0.1) : cookieDomain=null → localStorage standard.
    const isAhouaiDomain = /\.ahouai\.com$/.test(location.hostname);
    const cookieDomain   = isAhouaiDomain ? '.ahouai.com' : null;
    const secureFlag     = location.protocol === 'https:' ? '; Secure' : '';
    const storageKey     = `sb-${new URL(cfg.url).hostname.split('.')[0]}-auth-token`;

    // ★ fix(host-web) v2 : lecture chunked correcte via shared/supabase-cookie.js
    // Algorithme @supabase/ssr (cookies.js + chunker.js) :
    //   1. Joindre les valeurs BRUTES des cookies .0, .1, … (PAS de décodage dans la boucle)
    //   2. Si l’assemblé commence par 'base64-' → base64url decode → JSON string
    //   3. Valider JSON.parse → retourner la string JSON au SDK
    // Bug précédent : décodage individuel chunk par chunk → .0 = base64 tronqué → null → break
    // ⚠️ debugFn ONCE : le poll fait 30 appels getSession en 6s ;
    //   sans garde, 30 lignes identiques spamment le log.
    let _cookieDebugLogged = false;
    const _onceDebugFn = STATE.debugMode ? (msg) => {
      if (!_cookieDebugLogged) { _cookieDebugLogged = true; _log(msg); }
    } : null;
    const crossDomainStorage = window.SupabaseCookie.makeStorage({
      cookieDomain: cookieDomain,
      secureFlag:   secureFlag,
      debugFn:      _onceDebugFn
    });

    _supabase = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: {
        storageKey,
        detectSessionInUrl: true,
        persistSession:     true,
        autoRefreshToken:   true,
        storage:            crossDomainStorage
      }
    });
    _log(`Supabase init OK (cookie domain=${cookieDomain || 'localhost'} | storageKey=${storageKey})`);

    // ★ Poll actif 200ms (pattern app.js L719-736) :
    // Le SDK Supabase peut mettre 500-2000ms à parser le hash #access_token
    // après le retour OAuth. Sans poll, getSession() retourne null au 1er check.
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (session && !STATE.sessionHandled) {
          clearInterval(poll);
          STATE.sessionHandled = true;
          _log(`Session Supabase détectée (poll tentative ${attempts})`, 'ok');
          await _onSupabaseSession(session);
        } else if (attempts >= 30) {
          clearInterval(poll); // arrêt après 6s
          _log('Pas de session après 6s — non connecté', 'info');
          // ★ Redirect prod vers ahouai.com/login si pas de session et domaine prod
          _redirectToLoginIfNeeded();
        }
      } catch (e) { _log('getSession poll fail: ' + e, 'warn'); }
    }, 200);

    // onAuthStateChange : couverture des événements post-redirect
    _supabase.auth.onAuthStateChange(async (event, session) => {
      _log(`Auth event: ${event}`);
      if (event === 'SIGNED_IN' && session && !STATE.sessionHandled) {
        clearInterval(poll);
        STATE.sessionHandled = true;
        await _onSupabaseSession(session);
      }
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
    // firstName : priorité profil BDD > given_name OAuth > null (= compte email sans prénom)
    const rawFirst = user.profile?.firstName || user.firstName
      || session.user?.user_metadata?.given_name || null;
    STATE.user = {
      id:            user._id || user.userId,
      email:         user.email || session.user?.email,
      firstName:     rawFirst,          // null si compte email sans prénom renseigné
      photoURL:      user.profile?.photoURL || null,
      emoji:         user.profile?.emoji || '🎧',
      supabaseToken: jwt
    };
    _log(`SSO OK : ${STATE.user.firstName || '(prénom manquant)'} (${STATE.user.email})`, 'ok');
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
  nameEl.textContent = STATE.user.firstName || STATE.user.email?.split('@')[0] || 'Hôte';
  if (STATE.user.photoURL) {
    avatar.innerHTML = `<img src="${STATE.user.photoURL}" alt="">`;
  } else {
    avatar.textContent = (STATE.user.firstName || STATE.user.email || 'H')[0].toUpperCase();
  }
  // Pré-remplir nom soirée si prénom connu
  const nameInput = document.getElementById('party-name');
  if (!nameInput.value && STATE.user.firstName) {
    nameInput.value = `Chez ${STATE.user.firstName}, ce soir`;
  }
}

function _enableCreateForm() {
  document.getElementById('auth-gate').style.display   = 'none';
  document.getElementById('create-form').style.display = 'block';
  // Si l'utilisateur n'a pas de prénom (compte email sans profil complet),
  // afficher un champ prénom obligatoire au-dessus du nom de soirée.
  const firstNameGroup = document.getElementById('firstname-group');
  if (firstNameGroup) {
    firstNameGroup.style.display = STATE.user?.firstName ? 'none' : 'block';
  }
}

// ★ Guard anti-boucle login : si la page arrive après un retour de ahouai.com/login
// (sessionStorage.host_login_attempted=1) et qu'aucune session n'est là après 6s,
// afficher un écran d'erreur avec bouton de secours au lieu de rediriger à nouveau.
//
// Flux normal :  /host/ (pas de session) → pose flag → redirect login
//                login → retour /host/ (flag présent) → session trouvée → OK
// Flux échec  :  retour /host/ (flag présent) → session absente → écran d'erreur
function _redirectToLoginIfNeeded() {
  if (STATE.sessionHandled || STATE.user) return;
  const isLocal = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  if (isLocal) { _log('Mode dev — bouton Google local disponible', 'info'); return; }

  const alreadyTried = sessionStorage.getItem('host_login_attempted') === '1';
  if (alreadyTried) {
    // Écran d'erreur : évite la boucle infinie de redirections
    sessionStorage.removeItem('host_login_attempted');
    _log('⚠️ Session non récupérée après login — affichage écran d\'erreur', 'warn');
    _showLoginFallback();
    return;
  }

  sessionStorage.setItem('host_login_attempted', '1');
  const next     = encodeURIComponent(window.location.origin + '/host/');
  const loginUrl = `https://ahouai.com/login?redirect=${next}`;
  _log(`Pas de session → redirect login : ${loginUrl}`);
  window.location.replace(loginUrl);
}

// Affiche un écran de fallback quand la session n'a pas pu être récupérée post-login.
// Bouton Google de secours + lien ahouai.com.
function _showLoginFallback() {
  const gate = document.getElementById('auth-gate');
  if (!gate) return;
  gate.style.display = 'block';
  gate.innerHTML = `
    <p style="color:var(--muted);font-size:14px;margin-bottom:16px;line-height:1.6;">
      On n'a pas pu récupérer ta session après connexion.
      Essaie de te connecter directement depuis cette page.
    </p>
    <button class="btn-google" id="btn-google-fallback"
      onclick="HOST.signIn()" aria-label="Se connecter avec Google">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      Continuer avec Google
    </button>
    <p style="margin-top:16px;font-size:12px;color:var(--muted);">
      Ou connecte-toi sur
      <a href="https://ahouai.com/login" style="color:var(--cyan);text-decoration:none;">ahouai.com</a>
      puis reviens ici.
    </p>
  `;
  // En prod, le bouton Google du fallback fait un OAuth direct (pas de loop ahouai.com)
  // signIn() détecte isLocal=false mais dans ce cas, on veut l'OAuth direct.
  // On surcharge HOST.signIn temporairement pour ce fallback :
  HOST.signIn = async function() {
    if (!_supabase) return;
    const redirectTo = `${window.location.origin}/host/`;
    _log(`signIn Google (fallback prod) → redirectTo: ${redirectTo}`);
    const { error } = await _supabase.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo }
    });
    if (error) { _log(`SignIn erreur : ${error.message}`, 'error'); }
  };
}


// Bouton Google natif (mode dev uniquement)
async function signIn() {
  const isLocal = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  if (!isLocal) { _redirectToLoginIfNeeded(); return; }
  if (!_supabase) { _log('Supabase non initialisé', 'warn'); return; }
  try {
    const redirectTo = `${window.location.origin}/host/`;
    _log(`signIn Google (dev) → redirectTo: ${redirectTo}`);
    const { error } = await _supabase.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo }
    });
    if (error) { _log(`SignIn erreur : ${error.message}`, 'error'); }
  } catch (e) {
    _log(`SignIn exception : ${e.message}`, 'error');
    _showToast('Erreur de connexion, réessaie', 'error');
  }
}

async function signOut() {
  if (_supabase) await _supabase.auth.signOut();
  STATE.user = null;
  const isLocal = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  if (!isLocal) {
    // En prod : retour sur ahouai.com/login (cookie sera renvoyé)
    window.location.href = 'https://ahouai.com/login';
    return;
  }
  document.getElementById('auth-gate').style.display   = 'block';
  document.getElementById('create-form').style.display = 'none';
  document.getElementById('user-chip').style.display   = 'none';
}


// Champ prénom (comptes email sans profil) — debounce 1s + save /api/me
let _firstNameSaveTimer = null;
function onFirstNameInput(event) {
  const value = event.target.value.trim();
  if (!value) return;
  // Pré-remplir nom soirée
  const nameInput = document.getElementById('party-name');
  if (nameInput && !nameInput.dataset.userEdited) {
    nameInput.value = `Chez ${value}, ce soir`;
  }
  // Debounce save
  clearTimeout(_firstNameSaveTimer);
  _firstNameSaveTimer = setTimeout(async () => {
    if (!STATE.user?.supabaseToken) return;
    try {
      await fetch('/api/user/me/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${STATE.user.supabaseToken}`
        },
        body: JSON.stringify({ firstName: value })
      });
      STATE.user.firstName = value;
      _log(`Prénom sauvegardé : ${value}`, 'ok');
      // Cacher le champ prénom
      const grp = document.getElementById('firstname-group');
      if (grp) grp.style.display = 'none';
    } catch (e) {
      _log(`Sauvegarde prénom erreur : ${e.message}`, 'error');
    }
  }, 1000);
}

// ─── Socket.IO (pattern socketAuth.js L22) ────────────────────────────────────


function _connectSocket() {
  if (_socket?.connected) return;
  _socket = io({
    auth: { token: STATE.user?.supabaseToken || null }
    // ★ Réutilise socketAuth.js : token → socket.user = User Mongoose
    // V0 clients sans token → socket.user = null (backward compat)
  });
  _socket.on('connect', () => {
    _log(`Socket connecté : ${_socket.id}`, 'ok');
    _updateLaunchBtn(); // A2: recalculer après connexion socket
  });
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
  if (!me) {
    // fetchMe() a échoué (réseau ou 401) — spotify.isPremium reste false — bouton disabled
    _log('fetchMe() null — Spotify inaccessible', 'warn');
    _updateLaunchBtn(); // A2: logguer la raison 'Spotify inaccessible'
    return;
  }
  const card    = document.getElementById('spotify-card');
  const label   = document.getElementById('sp-label');
  const value   = document.getElementById('sp-value');
  const arrow   = document.getElementById('sp-arrow');

  if (me.isPremium) {
    card.classList.add('connected');
    label.textContent = `Connecté : ${me.firstName}`;
    value.textContent = 'Premium ✓';
    value.className   = 'sp-value premium';
    arrow.textContent = '✓';
    _log(`Spotify Premium OK : ${me.firstName}`, 'ok');
  } else {
    card.classList.add('blocked');
    label.textContent = 'Compte Spotify Free';
    value.textContent = 'Le pilotage nécessite Premium';
    value.className   = 'sp-value free';
    arrow.textContent = '⚠';
    _showToast('⚠ Spotify Free — Premium requis pour piloter la lecture', 'warn');
  }
  _updateLaunchBtn(); // A2: recalculer après PKCE ou init
}

// ─── A2: Recalcul du bouton Lancer (centralisé) ──────────────────────────────
// Appelé après : PKCE callback, socket.connect, _checkSpotifyPremium.
// 3 raisons possibles de grisage :
//   1. 'Spotify non Premium'       — _spotify.isPremium = false après fetchMe()
//   2. 'Spotify inaccessible'      — fetchMe() null (réseau / 401)
//   3. 'non connecté SSO'          — STATE.user = null (session Supabase absente)
// Raison(s) loguée(s) en debug pour diagnostic.
function _updateLaunchBtn() {
  const btn = document.getElementById('btn-launch');
  if (!btn) return;
  const reasons = [];
  if (!_spotify)                 reasons.push('Spotify inaccessible');
  else if (!_spotify.isPremium)  reasons.push('Spotify non Premium');
  if (!STATE.user)               reasons.push('non connecté SSO');
  const disabled = reasons.length > 0;
  btn.disabled = disabled;
  if (STATE.debugMode) {
    _log(disabled
      ? `Lancer désactivé : ${reasons.join(', ')}`
      : 'Lancer activé ✓');
  }
}

async function onSpotifyCardClick() {
  const token = sessionStorage.getItem('sp_access_token');
  if (token) return; // déjà connecté
  // Persister le mode debug à travers le redirect PKCE (Spotify supprime ?debug=1)
  if (STATE.debugMode) sessionStorage.setItem('host_debug', '1');
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
  if (!STATE.user) { _showToast("Connecte-toi d'abord", 'error'); return; }
  const name = document.getElementById('party-name').value.trim() ||
               `Chez ${STATE.user.firstName}, ce soir`;
  await _createAndStartParty(name, false);
}

async function justPlay() {
  if (!STATE.user) { _showToast("Connecte-toi d'abord", 'error'); return; }
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
    // Persister le mode debug à travers le redirect PKCE
    if (STATE.debugMode) sessionStorage.setItem('host_debug', '1');
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
    STATE.tracks         = data.tracks || [];
    STATE.currentIdx      = 0;
    STATE.nextQueued      = false;  // A1: reset au rechargement
    STATE.queuedForTrackId = null;  // A1: reset au rechargement

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

  // ★ A1 guard : ne mettre en file QUE si ce morceau n'est pas déjà queué
  const currentTrackId = STATE.tracks[STATE.currentIdx]?.trackId || null;
  if (STATE.queuedForTrackId === currentTrackId && currentTrackId !== null) {
    _log(`Queue T-45s : déjà queué pour ce morceau (${nextTrack.title}) — skip`, 'info');
    STATE.nextQueued = true; // état cohérent (queué lors d'un cycle précédent)
    return;
  }

  _log(`Queue T-45s : ${nextTrack.title}`);
  const ok = await _spotify.queue(nextTrack.spotifyUri);
  if (ok) {
    STATE.nextQueued = true;
    STATE.queuedForTrackId = currentTrackId; // mémoriser pour guard
    if (STATE.debugMode) _log(`📋 Queued : ${nextTrack.title} (trackId: ...${currentTrackId?.slice(-8)})`, 'ok');
    else _log(`📋 Queued : ${nextTrack.title}`, 'ok');
  }
}

function _handleQueuedTransition() {
  if (!STATE.nextQueued) return;
  const next = STATE.tracks[STATE.currentIdx + 1];
  if (!next) return;

  STATE.currentIdx++;
  STATE.nextQueued      = false;
  STATE.queuedForTrackId = null; // A1: reset après transition → prêt pour le prochain queue

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

  // A3: Poll automatique — 5 appels max sur 25s (rate limit prudent)
  // Arrêt dès qu'un appareil apparaît. Relance possible avec le bouton.
  let devices = [];
  const MAX_POLLS = 5;
  const POLL_MS   = 5000; // 5s entre chaque
  for (let i = 0; i < MAX_POLLS; i++) {
    await _spotify?.fetchDevices();
    devices = _spotify?.devices || [];
    if (devices.length > 0) break;
    if (i < MAX_POLLS - 1) {
      list.innerHTML = `<div style="color:var(--muted);text-align:center"><span class="spinner"></span> Recherche… (${i + 1}/${MAX_POLLS})</div>`;
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }

  if (!devices.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:14px;text-align:center;padding:12px">Aucun appareil trouvé. Ouvre Spotify et lance un titre.</div>';
    return;
  }
  // Sélection automatique si un seul appareil
  if (devices.length === 1 && !devices[0].is_active) {
    await _spotify.transferToDevice(devices[0].id);
    _showToast(`Appareil auto-sélectionné : ${devices[0].name}`, 'success');
    if (STATE.tracks.length === 0 || !STATE.party) {
      await _loadAndPlayFirst(STATE.party?.code);
    } else {
      showScreen('screen-playing');
    }
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
      // A1 guard : ne relancer _loadAndPlayFirst que si pas déjà en cours
      if (STATE.tracks.length === 0 || !STATE.party) {
        await _loadAndPlayFirst(STATE.party?.code);
      } else {
        // Soirée déjà en cours : continuer avec les titres en STATE (pas de re-queue)
        showScreen('screen-playing');
      }
    };
    list.appendChild(el);
  });
}

// ─── 2.2: Web Playback SDK (desktop uniquement) ──────────────────────────────
// Repris de spike/spotify-web:public/spike/spotify.html (fonction initWebPlayer).
// Affiché uniquement si !isMobile. Chargement SDK au clic (lazy).
// Sur initialization_error ou authentication_error → masquer carte, log, retour liste.
// Throttling arrière-plan : le SDK utilise WebAudio — non throttlé. playback_error → log seul.
// Note : _IS_MOBILE déclaré en tête de fichier.

function _showWebPlayerCard() {
  const card = document.getElementById('web-player-card');
  if (card && !_IS_MOBILE) card.style.display = 'block';
}

function _hideWebPlayerCard() {
  const card = document.getElementById('web-player-card');
  if (card) card.style.display = 'none';
}

async function initWebPlayer() {
  if (_IS_MOBILE) {
    _log('Web SDK: mobile non supporté', 'warn');
    return;
  }

  const token = sessionStorage.getItem('sp_access_token');
  if (!token) {
    _showToast('Connecte Spotify d\'abord (Spotify Premium requis)', 'warn');
    return;
  }

  const statusEl = document.getElementById('web-player-status');
  const btn      = document.getElementById('btn-web-player');
  if (statusEl) statusEl.textContent = 'Chargement du SDK…';
  if (btn) btn.disabled = true;
  _log('Web SDK → chargement SDK Spotify…', 'info');

  // Charger le SDK au clic uniquement (lazy)
  if (!window.Spotify) {
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    document.body.appendChild(script);
  }

  window.onSpotifyWebPlaybackSDKReady = () => {
    _log('Web SDK chargé ✅', 'ok');
    const player = new Spotify.Player({
      name: 'AhOuai Web',
      getOAuthToken: cb => {
        // Utiliser le token PKCE existant (déjà rafraîchi par SpotifyService)
        cb(sessionStorage.getItem('sp_access_token') || '');
      },
      volume: 0.8,
    });

    // ✅ Ready
    player.addListener('ready', ({ device_id }) => {
      _log(`Web SDK prêt — device_id=${device_id} ("AhOuai Web")`, 'ok');
      if (statusEl) statusEl.textContent = '✅ Prêt — sélectionne "AhOuai Web" dans la liste.';
      if (btn) btn.disabled = false;
      // Rafraîchir la liste d'appareils pour afficher "AhOuai Web"
      retryDevices();
    });

    // ⚠ Not ready
    player.addListener('not_ready', ({ device_id }) => {
      _log(`Web SDK not ready: ${device_id}`, 'warn');
      if (statusEl) statusEl.textContent = '⚠️ Player non prêt';
    });

    // ❌ Init error — EME non supporté (Firefox, Safari < 12.3)
    player.addListener('initialization_error', ({ message }) => {
      _log(`Web SDK initialization_error: ${message} — carte masquée`, 'warn');
      _hideWebPlayerCard();
      if (statusEl) statusEl.textContent = '';
      if (btn) btn.disabled = false;
      _showToast('Ce navigateur ne supporte pas le SDK Spotify (EME requis)', 'warn');
    });

    // ❌ Auth error — token expiré ou non Premium
    player.addListener('authentication_error', ({ message }) => {
      _log(`Web SDK authentication_error: ${message} — carte masquée`, 'warn');
      _hideWebPlayerCard();
      _showToast('⚠ Spotify : erreur d\'authentification (Premium requis)', 'warn');
    });

    // ⚠ Playback error — onglet arrière-plan ou réseau (ne pas masquer la carte)
    player.addListener('playback_error', ({ message }) => {
      _log(`Web SDK playback_error: ${message}`, 'warn');
    });

    player.addListener('player_state_changed', (state) => {
      if (state && STATE.debugMode) {
        const track = state.track_window?.current_track?.name || '?';
        _log(`Web SDK state: ${state.paused ? '⏸' : '▶'} ${track}`, 'info');
      }
    });

    player.connect().then(ok => {
      if (ok) _log('Web SDK connecté ✅', 'ok');
      else { _log('Web SDK connect failed', 'error'); if (btn) btn.disabled = false; }
    });
  };
}

// ─── Screen navigation ────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  // 2.2: afficher la carte Web Player si desktop et screen-device
  if (id === 'screen-device') _showWebPlayerCard();
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

// ─── A4: Log panel — pastille + ring buffer (400 lignes, sessionStorage) ────────
// Note : LOG_RING_MAX, LOG_RING_KEY, _logBuf, _logPanelOpen déclarés en tête
// de fichier (éviter TDZ Module ES — boot appelle _log avant ce point).

function _logInitPanel() {
  // Créer la pastille LOG si absente
  if (document.getElementById('log-badge')) return;
  const badge = document.createElement('button');
  badge.id        = 'log-badge';
  badge.textContent = 'LOG';
  badge.title     = 'Ouvrir/fermer le log debug';
  badge.onclick   = _logTogglePanel;
  badge.style.cssText = [
    'position:fixed', 'bottom:12px', 'right:12px', 'z-index:600',
    'background:rgba(0,0,0,0.75)', 'color:#1ed760', 'border:1px solid #1ed760',
    'border-radius:8px', 'padding:4px 10px', 'font:700 11px/1 monospace',
    'cursor:pointer', 'backdrop-filter:blur(4px)'
  ].join(';');
  document.body.appendChild(badge);

  // Bouton Copier dans le panel
  const panel = document.getElementById('log-panel');
  const copyBtn = document.createElement('button');
  copyBtn.id = 'log-copy-btn';
  copyBtn.textContent = '📋 Copier';
  copyBtn.style.cssText = 'position:sticky;top:0;float:right;font:700 10px monospace;background:rgba(0,0,0,0.6);color:#aaa;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 6px;cursor:pointer;z-index:1;';
  copyBtn.onclick = _logCopy;
  panel.prepend(copyBtn);
}

function _logTogglePanel() {
  const panel = document.getElementById('log-panel');
  if (!panel) return;
  _logPanelOpen = !_logPanelOpen;
  panel.style.display = _logPanelOpen ? 'block' : 'none';
  if (_logPanelOpen) panel.scrollTop = panel.scrollHeight;
}

function _logCopy() {
  const text = _logBuf.join('\n');
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => _showToast('Log copié ✓', 'success')).catch(() => _logCopyFallback(text));
  } else {
    _logCopyFallback(text);
  }
}
function _logCopyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  _showToast('Log copié ✓', 'success');
}

// 1.2: Chargement sessionStorage → _logBuf uniquement (pas de DOM, safe avant _log)
function _logLoadFromSession() {
  try {
    const stored = sessionStorage.getItem(LOG_RING_KEY);
    if (!stored) return;
    const lines = JSON.parse(stored);
    if (Array.isArray(lines)) _logBuf = lines;
  } catch {}
}

// 1.2: Rendu du buffer dans le panel (appelé après _logInitPanel)
function _logRenderBuffer() {
  const panel = document.getElementById('log-panel');
  if (!panel || !_logBuf.length) return;
  _logBuf.forEach(line => {
    const entry = document.createElement('div');
    entry.className = 'log-entry info';
    entry.textContent = line;
    panel.appendChild(entry);
  });
  panel.scrollTop = panel.scrollHeight;
}

function _logPersistToSession() {
  try {
    sessionStorage.setItem(LOG_RING_KEY, JSON.stringify(_logBuf));
  } catch {}
}

function _log(msg, level = 'info') {
  const time = new Date().toISOString().slice(11, 23);
  const full = `[${time}] ${msg}`;
  if (level === 'error') console.error('[HOST]', msg);
  else console.log('[HOST]', msg);

  // Ring buffer : max LOG_RING_MAX lignes
  _logBuf.push(full);
  if (_logBuf.length > LOG_RING_MAX) _logBuf.shift();
  _logPersistToSession();

  if (STATE.debugMode) {
    const panel = document.getElementById('log-panel');
    if (panel) {
      const entry = document.createElement('div');
      entry.className = `log-entry ${level}`;
      entry.textContent = full;
      panel.appendChild(entry);
      if (_logPanelOpen) panel.scrollTop = panel.scrollHeight;
    }
  }
}
