/**
 * public/host/host.js
 * ★ feat(host-web) — Cockpit hôte web Phase 1
 *
 * Flux : SSO Supabase → choix du lecteur (screen-provider, mémorisé) → créer soirée
 *        (host:startParty) → connexion lecteur (Spotify PKCE / …) → device (Spotify) →
 *        djbrain-lite → play T1 → queueNext T2 à T-45s → sonde → host:trackUpdate →
 *        guests voient le titre → Suivant → Just Play
 *
 * ★ Lot 1 (01/10/2026) : le cockpit ne parle qu'à STATE.engine (contrat PlayerEngine,
 *   shared/player-engine.js). Les écrans propres à Spotify (appareils, Web SDK, fantôme)
 *   passent par engine.raw, toujours gardés par engine.id === 'spotify'.
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

import { createEngine, PROVIDERS } from '/shared/player-engine.js';

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
let _sessionPoll = null;   // ★ Lot 1 : poll getSession (module-level pour pouvoir l'arrêter depuis le boot)
let _afterSSOPromise = null;   // ★ Lot 1 : _afterSSO exécuté une seule fois (double _onSupabaseSession boot+poll)
let _selectPromise   = null;   // ★ Lot 1 : _selectProvider verrouillé (double tap, double init)

// ★ Lot 1 : disponibilité des moteurs côté cockpit (Apple = Lot 2, YouTube = Lot 3)
const ENGINE_AVAILABLE = { spotify: true, apple: false, youtube: true }; // ★ Lot 3 : YouTube livré

const STATE = {
  user:          null,   // {id, email, firstName, photoURL, supabaseToken, preferredProvider, spotifyTester}
  provider:      null,   // ★ Lot 1 : 'spotify' | 'apple' | 'youtube' (lecteur de la soirée)
  engine:        null,   // ★ Lot 1 : PlayerEngine courant (shared/player-engine.js)
  party:         null,   // {code, hostSecret}
  tracks:        [],     // [{trackId, title, artist, spotifyUri, durationMs, coverArtURL}]
  currentIdx:    0,
  nextQueued:    false,
  queuedForTrackId: null,   // A1 guard — URI du prochain mis en file (UN seul par morceau en cours)
  queuedPid:     null,      // ★ Lot 3 : id lecteur du prochain (moteurs self-advancing = YouTube)
  visibility:    'private',
  coverPhotoUrl: null,
  guestCount:    0,
  isPlaying:     false,
  queueTimer:    null,
  transTimer:    null,
  debugMode:     new URLSearchParams(window.location.search).has('debug') || sessionStorage.getItem('host_debug') === '1',
  sessionHandled: false,  // guard double-appel onAuthStateChange/poll
  // ── Fluidité lot 30/09 ──────────────────────────────────────────
  initialized:   false,  // 1. init complète (profil + socket) exécutée une seule fois
  busy:          false,  // 1. verrou boutons 1,5s (next/prev/togglePlay)
  pendingCmd:    null,   // 3. dernière commande en attente pendant bascule d'app
  suspended:     false,  // 3. Safari a suspendu l'onglet (visibilitychange hidden)
  phantomChecks: 0,      // 2. compteur sondes post-play pour détection fantôme
};

// ─── Expose HOST globalement (appelé par onclick dans HTML) ───────────────────

window.HOST = {
  signIn, signInEmail, signOut, setVisibility, onCoverChange, onEngineCardClick,
  launchParty, justPlay, next, prev, togglePlay, share, retryDevices,
  onFirstNameInput, initWebPlayer, showScreen,
  chooseProvider, changeProvider   // ★ Lot 1 : écran choix du lecteur
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
    // ★ Lot 1 (revue P1.1) : marquer la session traitée AVANT l'appel, sinon le poll 200ms
    // rappelle _onSupabaseSession pendant que /api/me est en vol → double init / double PKCE.
    STATE.sessionHandled = true;
    if (_sessionPoll) clearInterval(_sessionPoll);
    await _onSupabaseSession(session);
  } else {
    // Pas de session (encore) : le callback PKCE Spotify éventuel (code + state=host_auth)
    // sera traité par _afterSSO() dès que la session Supabase arrive (poll / onAuthStateChange).
    if (_hasSpotifyCallbackInUrl()) _log('Détection callback Spotify PKCE — en attente de la session');
    showScreen('screen-create');
    // Portillon visible dès le boot : câbler "Créer un compte" avec le retour sur /host/
    // (le poll peut mettre jusqu'à 6s ; l'utilisateur peut cliquer avant son expiration).
    _showAuthGate();
  }
})();

// ★ Lot 1 : callback PKCE Spotify présent dans l'URL ?
function _hasSpotifyCallbackInUrl() {
  const p = new URLSearchParams(window.location.search);
  return !!(p.get('code') && p.get('state') === 'host_auth');
}

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
        if (STATE.sessionHandled) { clearInterval(poll); return; }
        if (session) {
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
    _sessionPoll = poll;

    // onAuthStateChange : couverture des événements post-redirect
    // SIGNED_IN est émis à chaque visibilitychange → visible (_recoverAndRefresh).
    // Guard : si même userId déjà initialisé → mise à jour JWT socket seulement.
    _supabase.auth.onAuthStateChange(async (event, session) => {
      _log(`Auth event: ${event}`);
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        const incomingId = session.user?.id;
        // Cas 1 : même utilisateur déjà init → mise à jour token uniquement
        if (STATE.initialized && STATE.user && STATE.user.id === incomingId) {
          STATE.user.supabaseToken = session.access_token;
          if (_socket?.connected) {
            // Mise à jour auth.token sans disconnect (socket.io ne supporte pas
            // le hot-swap, mais on le stocke pour la prochaine reconnexion auto)
            _socket.auth = { token: session.access_token };
          }
          _log(`Auth event: ${event} — même session (${incomingId?.slice(-8)}) → JWT mis à jour, init skipped`, 'info');
          return;
        }
        // Cas 2 : première init ou changement d'utilisateur
        if (!STATE.sessionHandled) {
          clearInterval(poll);
          STATE.sessionHandled = true;
          await _onSupabaseSession(session);
        }
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
      supabaseToken: jwt,
      // ★ Lot 1 : lecteur mémorisé + accès testeur Spotify (Development Mode, 5 comptes)
      preferredProvider: user.settings?.preferredProvider || null,
      spotifyTester:     user.settings?.spotifyTester === true
    };
    _log(`SSO OK : ${STATE.user.firstName || '(prénom manquant)'} (${STATE.user.email}) · lecteur=${STATE.user.preferredProvider || '(aucun)'}`, 'ok');
    _renderUser();
    _enableCreateForm();
    _connectSocket();
    STATE.initialized = true;  // 1. guard idempotence
    // 4. Reprise de soirée : si sessionStorage contient une soirée < 6h → proposer
    _tryResumeParty();
    // ★ Lot 1 : choisir / restaurer le lecteur (écran provider si rien de mémorisé)
    await _afterSSO();
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

// Pas de session après le poll : on NE redirige plus vers ahouai.com/login.
// Le portillon inline propose désormais toutes les options (Apple, Google,
// email/mot de passe, création de compte) — parité ahouai.com/login (photo 1).
// On s'assure juste qu'il est visible et que le lien "Créer un compte" revient ici.
function _redirectToLoginIfNeeded() {
  if (STATE.sessionHandled || STATE.user) return;
  _showAuthGate();
}

// Affiche le portillon d'authentification (toutes les options) et câble le lien
// "Créer un compte" pour revenir sur /host/ après inscription sur ahouai.com.
function _showAuthGate() {
  const gate = document.getElementById('auth-gate');
  if (gate) gate.style.display = 'block';
  const createForm = document.getElementById('create-form');
  if (createForm) createForm.style.display = 'none';
  const createLink = document.getElementById('auth-create');
  if (createLink) {
    const next = encodeURIComponent(window.location.origin + '/host/');
    createLink.href = `https://ahouai.com/login?redirect=${next}`;
  }
  _log('Pas de session — portillon toutes options affiché', 'info');
}

// ── Connexion OAuth (Google / Apple) — direct Supabase, dev ET prod ──────────
// Le même client Supabase (projet partagé, cookie domaine .ahouai.com) gère les
// deux providers. redirectTo = cette page /host/ : au retour, le poll de session
// récupère le JWT. NB : chaque provider doit avoir join.ahouai.com/host/ dans la
// liste des Redirect URLs autorisées du projet Supabase (Google : déjà OK).
async function signIn(provider = 'google') {
  const p = (provider === 'apple') ? 'apple' : 'google';
  if (!_supabase) { _log('Supabase non initialisé', 'warn'); return; }
  _authClearError();
  try {
    const redirectTo = `${window.location.origin}/host/`;
    _log(`signIn ${p} → redirectTo: ${redirectTo}`);
    const { error } = await _supabase.auth.signInWithOAuth({
      provider: p,
      options:  { redirectTo }
    });
    if (error) {
      _log(`SignIn ${p} erreur : ${error.message}`, 'error');
      _authShowError(`Connexion ${p === 'apple' ? 'Apple' : 'Google'} indisponible pour l'instant.`);
    }
  } catch (e) {
    _log(`SignIn ${p} exception : ${e.message}`, 'error');
    _showToast('Erreur de connexion, réessaie', 'error');
  }
}

// ── Connexion email + mot de passe — direct Supabase (aucun redirect requis) ──
async function signInEmail(event) {
  if (event) event.preventDefault();
  if (!_supabase) { _authShowError('Service de connexion indisponible, réessaie.'); return false; }
  const emailEl = document.getElementById('auth-email');
  const pwEl    = document.getElementById('auth-password');
  const btn     = document.getElementById('btn-email-signin');
  const email   = (emailEl?.value || '').trim();
  const password =  pwEl?.value || '';
  if (!email || !password) { _authShowError('Entre ton email et ton mot de passe.'); return false; }
  _authClearError();
  if (btn) { btn.disabled = true; btn.textContent = 'Connexion…'; }
  try {
    const { error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error) {
      _log(`signInEmail erreur : ${error.message}`, 'warn');
      _authShowError('Email ou mot de passe incorrect.');
      return false;
    }
    _log('signInEmail OK — session en cours de récupération', 'ok');
    // La session déclenche onAuthStateChange/poll → _onSupabaseSession (affiche le formulaire).
  } catch (e) {
    _log(`signInEmail exception : ${e.message}`, 'error');
    _authShowError('Erreur de connexion, réessaie.');
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
  }
  return false;   // empêche le submit natif
}

function _authShowError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}
function _authClearError() {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

async function signOut() {
  if (_supabase) await _supabase.auth.signOut();
  STATE.user = null;
  sessionStorage.removeItem('host_party_session'); // 4. effacer reprise à la déconnexion
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
  // 1. Log socket.id UNIQUEMENT dans le callback 'connect' (id défini ici)
  _socket.on('connect', () => {
    _log(`Socket connecté : ${_socket.id}`, 'ok');
    _updateLaunchBtn();
  });
  _socket.on('disconnect', () => _log('Socket déconnecté', 'warn'));
  _socket.on('party:state', _onPartyState);
  _socket.on('participants:update', _onParticipants);
  _socket.on('party:error', d => _showToast(d.message || 'Erreur soirée', 'error'));
}

// ─── Visibilité (bascule app, 3. Load failed, 2. retryDevices auto) ──────────
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    STATE.suspended = true;
    return;
  }
  // visible
  STATE.suspended = false;
  // 3. Rejouer la commande en attente (si une action a eu lieu pendant la bascule)
  if (STATE.pendingCmd) {
    const cmd = STATE.pendingCmd;
    STATE.pendingCmd = null;
    _log(`↩ Reprise commande en attente : ${cmd.name}`, 'info');
    // Attendre une sonde avant de rejouer
    setTimeout(() => { cmd.fn(); }, 1500);
  }
  // 2. Si screen-device visible → retryDevices automatique
  const screenDevice = document.getElementById('screen-device');
  if (screenDevice?.style.display !== 'none' && screenDevice?.classList.contains('active')) {
    _log('visibilitychange → visible : retryDevices auto', 'info');
    retryDevices();
  }
});

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

// ─── Lecteur (★ Lot 1 : contrat PlayerEngine) ───────────────────────────────

// Après le SSO : restaurer le lecteur mémorisé, ou le forcer si callback PKCE Spotify,
// ou ?provider= (debug), sinon afficher l'écran de choix.
async function _afterSSO() {
  if (_afterSSOPromise) return _afterSSOPromise;   // exécuté une seule fois (boot + poll + onAuthStateChange)
  _afterSSOPromise = (async () => {
    if (STATE.engine) return;
    const urlProvider = new URLSearchParams(window.location.search).get('provider');
    let provider = null;
    if (_hasSpotifyCallbackInUrl())                         provider = 'spotify';
    else if (urlProvider && PROVIDERS[urlProvider])         provider = urlProvider;
    else if (STATE.user?.preferredProvider)                 provider = STATE.user.preferredProvider;

    if (!provider) {
      _renderProviderScreen();
      showScreen('screen-provider');
      return;
    }
    await _selectProvider(provider);
    // Mémoriser le lecteur s'il vient du callback PKCE ou de ?provider= — uniquement s'il est livré
    if (ENGINE_AVAILABLE[provider] && STATE.user?.preferredProvider !== provider) {
      _persistProvider(provider);
    }
  })();
  return _afterSSOPromise;
}

// Clic sur une carte de l'écran choix du lecteur (onclick HTML)
async function chooseProvider(id) {
  if (!PROVIDERS[id]) return;
  if (!ENGINE_AVAILABLE[id]) { _showToast(`${PROVIDERS[id].label} arrive dans quelques jours`, 'info'); return; }
  await _persistProvider(id);
  await _selectProvider(id);
  showScreen('screen-create');
}

// Lien « changer de lecteur » (screen-create)
async function changeProvider() {
  if (STATE.party) { _showToast('Termine la soirée avant de changer de lecteur', 'warn'); return; }
  STATE.engine?.dispose();
  STATE.engine   = null;
  STATE.provider = null;
  await _persistProvider(null);
  _renderProviderScreen();
  showScreen('screen-provider');
}

async function _persistProvider(id) {
  if (STATE.user) STATE.user.preferredProvider = id;
  if (!STATE.user?.supabaseToken) return;
  try {
    const r = await fetch('/api/user/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${STATE.user.supabaseToken}` },
      body: JSON.stringify({ preferredProvider: id })
    });
    _log(r.ok ? `Lecteur mémorisé : ${id || '(aucun)'}` : `Lecteur non mémorisé (HTTP ${r.status})`, r.ok ? 'ok' : 'warn');
  } catch (e) { _log(`Lecteur non mémorisé : ${e.message}`, 'warn'); }
}

// Crée le moteur, branche les événements, tente une connexion silencieuse (sans redirection).
async function _selectProvider(id) {
  if (_selectPromise) return _selectPromise;        // verrou : un seul moteur créé à la fois
  _selectPromise = _selectProviderInner(id).finally(() => { _selectPromise = null; });
  return _selectPromise;
}
async function _selectProviderInner(id) {
  if (STATE.engine && STATE.provider === id) return;
  STATE.engine?.dispose();
  STATE.provider = id;
  STATE.engine   = await createEngine(id, {
    clientId: SPOTIFY_CLIENT_ID,
    getToken: () => STATE.user?.supabaseToken || null,
    onLog:    (msg, lvl) => _log(msg, lvl)
  });
  const engine = STATE.engine;
  engine.on('stateChanged', _onEngineState);
  engine.on('noDevice',     () => showScreen('screen-device'));
  engine.on('needsUserGesture', () => _showToast('Touche ▶ pour lancer la lecture', 'info'));
  engine.on('error',        (e) => _log(`engine ${id} : ${e?.message || e}`, 'error'));
  engine.on('needsVisibleScreen', () => { const b = document.getElementById('yt-wake-banner'); if (b) b.style.display = 'block'; });
  engine.on('trackChanged', _onEngineTrackChanged);
  _log(`Lecteur sélectionné : ${PROVIDERS[id].label} (${id})`, 'ok');

  if (!ENGINE_AVAILABLE[id]) { _renderEngineCard(); _updateLaunchBtn(); return; }

  // Connexion silencieuse : tokens déjà présents (Spotify) ou callback PKCE dans l'URL
  try {
    const r = await engine.connect({ interactive: false });
    if (r?.redirecting) return;
    if (r?.ok) _log(`${PROVIDERS[id].label} connecté : ${r.user?.firstName || ''}`, 'ok');
    else if (r?.reachable === false) _log(`${PROVIDERS[id].label} inaccessible (réseau / 401)`, 'warn');
  } catch (e) {
    _log(`Connexion ${id} erreur : ${e.message}`, 'error');
    _showToast(`Connexion ${PROVIDERS[id].label} échouée`, 'error');
  }
  _renderEngineCard();
  _updateLaunchBtn();
}

// Écran choix du lecteur : 3 cartes. Spotify visible seulement pour les testeurs
// (Development Mode = 5 comptes), ou si des tokens Spotify existent déjà, ou en debug.
function _renderProviderScreen() {
  const list = document.getElementById('provider-list');
  if (!list) return;
  const otherAvailable = ENGINE_AVAILABLE.apple || ENGINE_AVAILABLE.youtube;
  // Spotify (Development Mode, 5 comptes) : testeurs, tokens déjà présents, debug —
  // ou tant qu'aucun autre moteur n'est livré (sinon l'hôte n'aurait aucune option utilisable).
  const spotifyVisible = STATE.user?.spotifyTester || !!sessionStorage.getItem('sp_access_token') || STATE.debugMode || !otherAvailable;
  const order = ['apple', 'youtube', 'spotify'].filter(id => id !== 'spotify' || spotifyVisible);
  list.innerHTML = '';
  for (const id of order) {
    const p = PROVIDERS[id];
    const avail = ENGINE_AVAILABLE[id];
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `provider-card provider-${id}${avail ? '' : ' soon'}`;
    el.onclick = () => chooseProvider(id);
    const icon = id === 'spotify' ? '🟢' : id === 'apple' ? '🍎' : '▶️';
    el.innerHTML = `
      <span class="provider-icon">${icon}</span>
      <span class="provider-text">
        <span class="provider-label">${p.label}</span>
        <span class="provider-hint">${avail ? p.hint : 'Arrive dans quelques jours'}</span>
      </span>
      <span class="provider-arrow">${avail ? '→' : '⏳'}</span>`;
    list.appendChild(el);
  }
}

// Carte « Musique » de l'écran création : état du lecteur choisi
function _renderEngineCard() {
  const card  = document.getElementById('engine-card');
  const label = document.getElementById('sp-label');
  const value = document.getElementById('sp-value');
  const arrow = document.getElementById('sp-arrow');
  const logo  = document.getElementById('engine-logo');
  if (!card) return;
  const engine = STATE.engine, id = STATE.provider;
  card.classList.remove('connected', 'blocked');
  if (logo) logo.textContent = id === 'apple' ? '🍎' : id === 'youtube' ? '▶️' : '';
  if (!engine || !id) { label.textContent = 'Choisir un lecteur'; value.textContent = ''; arrow.textContent = '→'; return; }
  if (engine.isReady()) {
    card.classList.add('connected');
    const first = engine.raw?.userFirstName;
    label.textContent = `${PROVIDERS[id].label} connecté${first ? ' : ' + first : ''}`;
    value.textContent = id === 'spotify' ? 'Premium ✓' : 'Prêt ✓';
    value.className   = 'sp-value premium';
    arrow.textContent = '✓';
    return;
  }
  const reason = engine.notReadyReason();
  if (id === 'spotify' && engine.raw?.accessToken && !engine.raw.isPremium) {
    card.classList.add('blocked');
    label.textContent = 'Compte Spotify Free';
    value.textContent = 'Le pilotage nécessite Premium';
    value.className   = 'sp-value free';
    arrow.textContent = '⚠';
    _showToast('⚠ Spotify Free — Premium requis pour piloter la lecture', 'warn');
    return;
  }
  label.textContent = `Connecter ${PROVIDERS[id].label}`;
  value.textContent = ENGINE_AVAILABLE[id] ? PROVIDERS[id].hint : reason;
  value.className   = 'sp-value';
  arrow.textContent = ENGINE_AVAILABLE[id] ? '→' : '⏳';
}

// ─── A2: Recalcul du bouton Lancer (centralisé) ──────────────────────────────
// Appelé après : connexion lecteur, socket.connect, choix du provider.
// Raisons de grisage : lecteur absent / non prêt (engine.notReadyReason()), SSO absent.
function _updateLaunchBtn() {
  const btn = document.getElementById('btn-launch');
  if (!btn) return;
  const reasons = [];
  if (!STATE.engine)                 reasons.push('aucun lecteur choisi');
  else if (!STATE.engine.isReady())  reasons.push(STATE.engine.notReadyReason() || 'lecteur non prêt');
  if (!STATE.user)                   reasons.push('non connecté SSO');
  const disabled = reasons.length > 0;
  btn.disabled = disabled;
  if (STATE.debugMode) {
    _log(disabled
      ? `Lancer désactivé : ${reasons.join(', ')}`
      : 'Lancer activé ✓');
  }
}

// Clic sur la carte « Musique » : connexion interactive au lecteur (peut rediriger)
async function onEngineCardClick() {
  if (!STATE.engine) { _renderProviderScreen(); showScreen('screen-provider'); return; }
  if (STATE.engine.isReady()) return; // déjà connecté
  if (!ENGINE_AVAILABLE[STATE.provider]) { _showToast(`${PROVIDERS[STATE.provider].label} arrive dans quelques jours`, 'info'); return; }
  // Persister le mode debug à travers un éventuel redirect OAuth
  if (STATE.debugMode) sessionStorage.setItem('host_debug', '1');
  try {
    const r = await STATE.engine.connect({ interactive: true });
    if (r?.redirecting) return;
  } catch (e) {
    _log(`Connexion ${STATE.provider} erreur : ${e.message}`, 'error');
    _showToast(`Connexion ${PROVIDERS[STATE.provider].label} échouée — réessaie`, 'error');
  }
  _renderEngineCard();
  _updateLaunchBtn();
}

// State générique du lecteur (contrat PlayerEngine) → UI Now Playing + doctrine T-45s
function _onEngineState(state) {
  if (!state) return;
  const { isPlaying, positionMs, durationMs, title, artist, artworkUrl, providerId } = state;

  STATE.isPlaying = isPlaying;

  if (!providerId) return;

  // UI Now Playing
  document.getElementById('np-title').textContent  = title || '—';
  document.getElementById('np-artist').textContent = artist || '—';
  document.getElementById('np-status').textContent = isPlaying ? '▶' : '⏸';
  document.getElementById('btn-play-pause').textContent = isPlaying ? '⏸' : '▶';

  const pct = durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0;
  document.getElementById('np-progress').style.width = `${pct}%`;
  document.getElementById('np-elapsed').textContent  = _ms2time(positionMs);
  document.getElementById('np-duration').textContent = _ms2time(durationMs);

  const artUrl = artworkUrl || '';
  const artEl  = document.getElementById('np-art');
  if (artEl.src !== artUrl) {
    artEl.src = artUrl;
    document.getElementById('np-cover').classList.add('pulse');
    setTimeout(() => document.getElementById('np-cover').classList.remove('pulse'), 1000);
  }

  // ★ Lot 3 : moteurs self-advancing (YouTube) — l'audio bascule à la fin réelle, l'avance
  // de l'index se fait sur l'événement trackChanged du moteur, pas sur un timer T-5s (sinon
  // on écrase le prochain déjà mis en file et on saute un titre).
  if (STATE.engine?.capabilities?.selfAdvancing) return;

  // ── Doctrine (pattern SpotifyService.swift L1171) — moteurs à file native (Spotify) ──
  // À T-45s : queueNext le prochain si pas encore fait (UN seul titre en file)
  const remaining = (durationMs - positionMs) / 1000;
  if (isPlaying && remaining <= QUEUE_BINDING_WINDOW_S && !STATE.nextQueued) {
    _queueNextTrack();
  }
  // À T-5s : transition précoce (comme iOS earlyTransitionThreshold L76)
  if (isPlaying && remaining <= EARLY_TRANSITION_S && STATE.nextQueued) {
    _log('⏱ Transition précoce T-5s (nextQueued) — le lecteur gère l\'enchaînement', 'info');
    _handleQueuedTransition();
  }
}

// ─── Reprise de soirée (4.) ──────────────────────────────────────────────────
// Si sessionStorage contient {partyCode, hostSecret, startedAt} < 6h → ré-émettre.
// Stocké par _createAndStartParty, supprimé par signOut.

function _tryResumeParty() {
  try {
    const raw = sessionStorage.getItem('host_party_session');
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved.partyCode || !saved.hostSecret || !saved.startedAt) return;
    const ageH = (Date.now() - saved.startedAt) / 3600000;
    if (ageH >= 6) {
      sessionStorage.removeItem('host_party_session');
      _log('Reprise : soirée > 6h — ignorée', 'info');
      return;
    }
    // Proposer la reprise via un toast non-bloquant
    _log(`Reprise détectée : soirée ${saved.partyCode} (il y a ${Math.round(ageH * 60)} min)`, 'info');
    _showToast(`Soirée ${saved.partyCode} en cours — reprise…`, 'info');
    // Ré-émettre host:startParty avec le même code+secret → le serveur reprend
    if (!_socket?.connected) _connectSocket();
    _socket.once('connect', () => _resumePartySocket(saved));
    if (_socket?.connected) _resumePartySocket(saved);
  } catch (_) {}
}

function _resumePartySocket(saved) {
  STATE.party = { code: saved.partyCode, hostSecret: saved.hostSecret };
  _socket.emit('host:startParty', {
    code:       saved.partyCode,
    hostSecret: saved.hostSecret,
    profile: {
      name:  STATE.user?.firstName || 'Hôte',
      email: STATE.user?.email || '',
      emoji: STATE.user?.emoji || '🎧',
      photo: STATE.user?.photoURL || null, phone: '', instagram: ''
    },
    streamingProvider: STATE.provider || 'spotify',
    deviceId: null
  });
  _log(`host:startParty (reprise) émis pour ${saved.partyCode}`, 'ok');
  // Le serveur répond avec party:state → _onPartyState → on ré-affiche screen-playing si titres
  _socket.once('party:state', (state) => {
    if (state.currentTrack) {
      document.getElementById('np-party-code').textContent = saved.partyCode;
      _renderQR(saved.partyCode);
      showScreen('screen-playing');
      _log(`✅ Reprise soirée ${saved.partyCode} — titre en cours : ${state.currentTrack.title}`, 'ok');
    }
  });
}

// ─── Détection appareil fantôme (2.) ─────────────────────────────────────────
// 2 sondes à +1,5s et +3,5s. Si is_playing=true ET progress_ms identique (< 200ms de diff)
// → playhead figé → appareil fantôme → screen-device.
// Note : progress_ms avance même pendant le silence (Spotify playhead = temps, pas audio).

async function _checkPhantomDevice(track) {
  const raw = STATE.engine?.id === 'spotify' ? STATE.engine.raw : null;
  if (!raw) return;
  const probe = async () => {
    const data = await raw._api('GET', '/me/player');
    return data;
  };
  const p1 = await new Promise(r => setTimeout(async () => r(await probe()), 1500));
  const p2 = await new Promise(r => setTimeout(async () => r(await probe()), 2000)); // +3,5s total
  if (!p1 || !p2) return; // réseau indisponible — on laisse la sonde normale gérer
  const prog1 = p1.progress_ms || 0;
  const prog2 = p2.progress_ms || 0;
  if (p1.is_playing && p2.is_playing && Math.abs(prog2 - prog1) < 200) {
    _log(`⚠️ Appareil fantôme détecté : progress_ms figé (${prog1}ms / ${prog2}ms) — screen-device`, 'warn');
    _showToast('Ouvre Spotify et lance un titre', 'warn');
    showScreen('screen-device');
    return;
  }
  _log(`✅ Lecture confirmée : progress ${prog1}ms → ${prog2}ms`, 'ok');
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
  // ★ 02/10 — Le host atterrit désormais sur ON AIR HOST (le guest en mode host) au lieu de
  // l'ancien écran now-playing /host/. La SPA guest crée la soirée (hostlaunch) et pilote le moteur.
  // Revert = supprimer ces 3 lignes (le flux /host/ d'origine reprend juste en dessous).
  const _prov = STATE.provider || 'youtube';
  window.location.href = '/?sb=1&hostlaunch=1&provider=' + encodeURIComponent(_prov) + '&name=' + encodeURIComponent(partyName || '');
  return;

  // ── Ancien flux /host/ (non atteint) ─────────────────────────────────────────
  document.getElementById('btn-launch').disabled    = true;
  document.getElementById('btn-just-play').disabled = true;

  // 1. Générer code + secret
  const code       = _generateCode();
  const hostSecret = _randomString(32);
  STATE.party      = { code, hostSecret };

  // 4. Sauvegarder pour reprise après rechargement (< 6h)
  sessionStorage.setItem('host_party_session', JSON.stringify({
    partyCode: code, hostSecret, startedAt: Date.now()
  }));

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
    streamingProvider: STATE.provider || 'spotify',
    deviceId: null
  });

  _log(`host:startParty émis (${code})`, 'ok');

  // 4. Vérifier le lecteur (★ Lot 1 : générique)
  const engine = STATE.engine;
  if (!engine) { _showToast('Choisis un lecteur', 'warn'); _renderProviderScreen(); showScreen('screen-provider'); return; }
  if (!engine.isReady()) {
    _showToast(`Connexion ${PROVIDERS[STATE.provider].label}…`, 'info');
    // Persister le mode debug à travers un éventuel redirect OAuth
    if (STATE.debugMode) sessionStorage.setItem('host_debug', '1');
    try {
      const r = await engine.connect({ interactive: true });
      if (r?.redirecting) return; // redirect → callback va reprendre
    } catch (e) {
      _log(`Connexion ${STATE.provider} erreur : ${e.message}`, 'error');
      _showToast(`Connexion ${PROVIDERS[STATE.provider].label} échouée — réessaie`, 'error');
    }
    if (!engine.isReady()) {
      _showToast(`⚠ ${engine.notReadyReason() || 'Lecteur non prêt'}`, 'warn');
      _renderEngineCard(); _updateLaunchBtn();
      document.getElementById('btn-just-play').disabled = false;
      return;
    }
  }

  // 5. Device (Spotify Connect uniquement : l'app Spotify doit être ouverte quelque part)
  if (engine.id === 'spotify') {
    const deviceId = await engine.raw.ensureActiveDevice();
    if (!deviceId) {
      showScreen('screen-device');
      return;
    }
  }

  // 6. Charger titres djbrain-lite
  await _loadAndPlayFirst(code);
}

// ★ Lot A : DJ Brain Cloud — charge les prochains titres (phase + énergie dérivées côté serveur
// depuis l'état de soirée), provider-aware, avec repli automatique sur djbrain-lite si indisponible.
async function _fetchNext(code, count = 5) {
  const token = STATE.user?.supabaseToken;
  const prov  = STATE.provider ? `&provider=${STATE.provider}` : '';
  try {
    const res = await fetch(`/api/djbrain/next?partyCode=${code}&count=${count}${prov}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.tracks?.length) { _log(`djbrain-cloud: ${data.tracks.length} titres (phase ${data.phase})`, 'ok'); return data; }
      _log('djbrain-cloud: 0 titre — repli djbrain-lite', 'warn');
    } else {
      _log(`djbrain-cloud HTTP ${res.status} — repli djbrain-lite`, 'warn');
    }
  } catch (e) { _log(`djbrain-cloud erreur (${e.message}) — repli djbrain-lite`, 'warn'); }
  const res2 = await fetch(`/api/djbrain-lite/next?partyCode=${code}&count=${count}&phase=arrival`);
  return res2.json();
}

async function _loadAndPlayFirst(code) {
  _log('Appel DJ Brain…');
  try {
    const data = await _fetchNext(code, 5);
    STATE.tracks         = data.tracks || [];
    STATE.currentIdx      = 0;
    STATE.nextQueued      = false;  // A1: reset au rechargement
    STATE.queuedForTrackId = null;  // A1: reset au rechargement

    if (!STATE.tracks.length) {
      _showToast('Aucun titre trouvé — vérifie la BDD', 'error');
      return;
    }

    _log(`djbrain-lite: ${STATE.tracks.length} titres (${STATE.tracks[0]?.title})`);

    // 7. Play premier titre (★ Lot 1 : id provider via engine.resolve, lecture via engine.play)
    const first = STATE.tracks[0];
    const pid = await STATE.engine.resolve(first);
    if (!pid) { _showToast(`Titre introuvable sur ${PROVIDERS[STATE.provider].label}`, 'error'); return; }
    const ok = await STATE.engine.play(pid);
    if (!ok) return;

    // 8. Émettre host:trackUpdate (comme iOS L5167 server.js)
    _emitTrackUpdate(first);

    // 9. Afficher NowPlaying IMMÉDIATEMENT (screen-playing sans attente)
    document.getElementById('np-party-code').textContent = code;
    _renderQR(code);
    showScreen('screen-playing');

    // ★ Lot 3 : moteur self-advancing → pré-charger le prochain titre (file interne du moteur)
    if (STATE.engine.capabilities?.selfAdvancing) await _prequeueSelfAdvancing();

    // 2. Détection appareil fantôme en ARRIÈRE-PLAN (non bloquant, Spotify Connect uniquement)
    // Si fantôme confirmé → showScreen('screen-device') + toast depuis la callback
    if (STATE.engine.id === 'spotify') _checkPhantomDevice(first); // sans await

  } catch (e) {
    _showToast(`Erreur chargement titres : ${e.message}`, 'error');
  }
}

// ─── Queue à T-45s (iOS pattern) ─────────────────────────────────────────────

async function _queueNextTrack() {
  const next = STATE.tracks[STATE.currentIdx + 1];
  if (!next) {
    // Plus de titres en réserve → recharger
    _log('Queue vide — rechargement DJ Brain…', 'warn');
    try {
      const code = STATE.party?.code;
      const data = await _fetchNext(code, 5);
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
  const pid = await STATE.engine.resolve(nextTrack);
  if (!pid) { _log(`Queue T-45s : ${nextTrack.title} introuvable sur ${STATE.provider} — skip`, 'warn'); STATE.tracks.splice(STATE.currentIdx + 1, 1); return; }
  const ok = await STATE.engine.queueNext(pid);
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
    _log('Réserve < 2 — rechargement DJ Brain');
    _fetchNext(STATE.party?.code, 5)
      .then(d => {
        const fresh = (d.tracks || []).filter(t => !STATE.tracks.some(e => e.trackId === t.trackId));
        STATE.tracks = [...STATE.tracks, ...fresh];
        _log(`DJ Brain: +${fresh.length} titres chargés`);
      })
      .catch(() => {});
  }
}

// ─── Moteurs self-advancing (★ Lot 3 : YouTube) ─────────────────────────────
// Le moteur enchaîne l'audio à la fin réelle du titre et émet 'trackChanged' avec l'id
// du prochain (celui qu'on lui a pré-chargé via queueNext). On avance alors l'index + guests,
// puis on lui pré-charge le titre suivant.

async function _prequeueSelfAdvancing(skipsLeft = 5) {
  const next = STATE.tracks[STATE.currentIdx + 1];
  if (!next) {
    // Recharger la réserve
    try {
      const data = await _fetchNext(STATE.party?.code, 5);
      const fresh = (data.tracks || []).filter(t => !STATE.tracks.some(e => e.trackId === t.trackId));
      STATE.tracks = [...STATE.tracks, ...fresh];
    } catch (_) {}
  }
  const nextTrack = STATE.tracks[STATE.currentIdx + 1];
  if (!nextTrack) { STATE.queuedPid = null; _log('Pas de prochain titre (self-advancing)', 'warn'); return; }
  if (skipsLeft <= 0) { _log('Pré-chargement : trop de titres introuvables d\'affilée — arrêt (quota)', 'warn'); STATE.queuedPid = null; return; }
  const pid = await STATE.engine.resolve(nextTrack);
  if (!pid) { _log(`Prochain introuvable sur ${STATE.provider} — skip : ${nextTrack.title}`, 'warn'); STATE.tracks.splice(STATE.currentIdx + 1, 1); return _prequeueSelfAdvancing(skipsLeft - 1); }
  await STATE.engine.queueNext(pid);
  STATE.queuedPid = pid;
  _log(`▶ Pré-chargé (self-advancing) : ${nextTrack.title}`, 'ok');
}

async function _onEngineTrackChanged(state) {
  if (!STATE.engine?.capabilities?.selfAdvancing) return;      // Spotify : géré par timer
  const pid = state?.providerId;
  if (!pid || pid !== STATE.queuedPid) return;                  // play() initial → ignoré (≠ prochain)
  STATE.currentIdx++;
  STATE.queuedPid = null;
  const now = STATE.tracks[STATE.currentIdx];
  if (now) { _log(`✅ Transition (self-advancing) → ${now.title}`, 'ok'); _emitTrackUpdate(now); }
  await _prequeueSelfAdvancing();
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
    provider:   STATE.provider || 'spotify', // ★ Lot 1
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

// ── Verrou boutons 1,5s (guard ×2/×3 appuis rapides + bascule d'app) ────────
function _withBusy(name, fn) {
  return async function() {
    // 3. Si Safari a suspendu l'onglet : mettre en attente, pas d'appel réseau
    if (STATE.suspended) {
      STATE.pendingCmd = { name, fn };
      _log(`⏳ ${name} en attente (onglet suspendu)`, 'info');
      return;
    }
    if (STATE.busy) { _log(`⚡ ${name} ignoré (busy)`, 'info'); return; }
    STATE.busy = true;
    // 3. Reset du verrou UNIQUEMENT après 1,5s (pas de finally) :
    // un double appui humain < 1,5s est ignoré même si fn() a déjà fini.
    setTimeout(() => { STATE.busy = false; }, 1500);
    _log(`${name}`, 'ok');
    try {
      await fn();
      // 3. Après fn() : vérifier lastNetworkError (posé par _api sans rethrow)
      const raw = STATE.engine?.id === 'spotify' ? STATE.engine.raw : null;
      if (raw?.lastNetworkError?.suspended &&
          Date.now() - raw.lastNetworkError.at < 2000) {
        _log(`↩ ${name} — réseau suspendu (bascule app) — en attente visibilitychange`, 'info');
        STATE.pendingCmd = { name, fn };
        raw.lastNetworkError = null;
      }
    } catch (e) {
      // Erreur non-réseau (ne devrait pas arriver — _api return null sans throw)
      _log(`${name} erreur inattendue : ${e.message}`, 'error');
    }
    // Pas de finally busy = false : le seul reset est le setTimeout 1,5s ci-dessus
  };
}

async function next() {
  await _withBusy('⏭ NEXT', async () => {
    await STATE.engine?.next();
  })();
}

async function prev() {
  await _withBusy('⏮ PREV', async () => {
    const curr = STATE.tracks[STATE.currentIdx];
    if (!curr || !STATE.engine) return;
    const pid = await STATE.engine.resolve(curr);
    if (pid) await STATE.engine.play(pid);
  })();
}

async function togglePlay() {
  await _withBusy(STATE.isPlaying ? '⏸ PAUSE' : '▶ RESUME', async () => {
    if (!STATE.engine) return;
    if (STATE.isPlaying) { await STATE.engine.pause(); }
    else                 { await STATE.engine.resume(); }
  })();
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
  const raw  = STATE.engine?.id === 'spotify' ? STATE.engine.raw : null;   // écran Spotify Connect uniquement
  if (!raw) { list.innerHTML = '<div style="color:var(--muted);font-size:14px;text-align:center;padding:12px">Ce lecteur ne nécessite pas d\'appareil.</div>'; return; }
  list.innerHTML = '<div style="color:var(--muted);text-align:center"><span class="spinner"></span> Recherche…</div>';

  // A3: Poll automatique — 5 appels max sur 25s (rate limit prudent)
  // Arrêt dès qu'un appareil apparaît. Relance possible avec le bouton.
  let devices = [];
  const MAX_POLLS = 5;
  const POLL_MS   = 5000; // 5s entre chaque
  for (let i = 0; i < MAX_POLLS; i++) {
    await raw.fetchDevices();
    devices = raw.devices || [];
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
    await raw.transferToDevice(devices[0].id);
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
      await raw.transferToDevice(d.id);
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
  if (id === 'screen-playing') _applyProviderUI();
  // ★ Lot 3 (revue #3) : le lecteur YouTube ne doit jamais être caché PENDANT la lecture.
  // Si on quitte screen-playing alors que YouTube joue, on met en pause (donc plus d'audio caché).
  else if (STATE.provider === 'youtube' && STATE.isPlaying) { STATE.engine?.pause(); }
}

// ★ Lot 3 : sur screen-playing, le lecteur YouTube (visible) remplace la pochette
function _applyProviderUI() {
  const ytMount = document.getElementById('yt-player-mount');
  const cover   = document.getElementById('np-cover');
  const isYT = STATE.provider === 'youtube';
  if (ytMount) ytMount.style.display = isYT ? 'block' : 'none';
  if (cover)   cover.style.display   = isYT ? 'none'  : '';
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
