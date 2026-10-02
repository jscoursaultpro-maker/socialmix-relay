/**
 * public/shared/ui/host-engine.js
 * ★ AhOuai — « Mode host » brique 2 : moteur musique dans le guest (chemin YouTube).
 *
 * Décision 02/10 (decision-guest-mode-host) : le guest EST le host. Cette brique porte le
 * cœur de lecture de public/host/host.js DANS la SPA guest, derrière le mode host, en
 * réutilisant le socket existant (window.socket) — PAS un second socket.
 *
 * Portée : YouTube (aucun OAuth → testable de bout en bout). Spotify/Apple = brique suivante.
 * Non destructif : rien ne tourne tant que l'utilisateur n'a pas lancé une soirée en host.
 *
 * Flux : launchHost() → host:startParty (rejoint la room host:CODE) → createEngine('youtube')
 *        → DJ Brain (/api/djbrain/next, repli djbrain-lite) → engine.play(T1) → host:trackUpdate
 *        → queueNext(T2) → à la fin du titre, le moteur enchaîne et on ré-émet trackUpdate.
 *
 * Exposé : window.AhOuaiHostEngine { launchHost, play, pause, togglePlay, next, repeat,
 *          isActive, getNowPlaying }.
 */
(function () {
  "use strict";

  var engine = null;
  var party = null;              // { code, hostSecret, provider }
  var tracks = [];
  var idx = 0;
  var queuedPid = null;
  var booted = false;
  var autoAdvance = true;        // ENCHAÎNEMENT AUTO (toggle host)
  var stallTries = 0;            // tentatives de récupération pour le titre courant
  var skipping = false;          // garde anti-réentrance pendant un saut de titre injouable
  var pendingStart = null;       // Apple : {code} en attente du geste ▶ pour authorize()+1er titre

  var _dbg = null;      // corps scrollable des logs (là où log() ajoute les lignes)
  var _dbgWrap = null;  // conteneur (barre + corps)
  var _dbgOn = (function () {
    try {
      if (/[?&]hostdebug=1\b/.test(location.search)) { sessionStorage.setItem('ahouai_hostdebug', '1'); return true; }
      return sessionStorage.getItem('ahouai_hostdebug') === '1';
    } catch (e) { return /[?&]hostdebug=1\b/.test(location.search); }
  })();
  function _dbgCollapsed() { try { return sessionStorage.getItem('ahouai_hostdebug_collapsed') === '1'; } catch (e) { return false; } }
  function _dbgApplyState(collapsed) {
    if (!_dbgWrap || !_dbg) return;
    try { sessionStorage.setItem('ahouai_hostdebug_collapsed', collapsed ? '1' : '0'); } catch (e) {}
    _dbg.style.display = collapsed ? 'none' : 'block';
    // Replié : petite pastille en bas à gauche, ne couvre pas la nav centrée. Déplié : panneau pleine largeur.
    _dbgWrap.style.right = collapsed ? 'auto' : '6px';
    _dbgWrap.style.maxWidth = collapsed ? 'none' : '';
    var t = _dbgWrap.querySelector('[data-dbg-toggle]'); if (t) t.textContent = collapsed ? '▸ logs' : '▾ logs';
  }
  function _dbgPanel() {
    if (_dbg || !_dbgOn || !document.body) return _dbg;
    var w = document.createElement('div');
    w.id = 'host-debug';
    w.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99999;background:rgba(0,0,0,.92);border:1px solid #22e3c9;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.5)';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:5px 10px;cursor:pointer;color:#8fffd8;font:600 11px/1.2 ui-monospace,Menlo,monospace;user-select:none';
    var tog = document.createElement('span'); tog.setAttribute('data-dbg-toggle', '1'); tog.textContent = '▾ logs';
    var ttl = document.createElement('span'); ttl.textContent = 'debug host'; ttl.style.opacity = '.6'; ttl.style.marginRight = 'auto';
    bar.appendChild(tog); bar.appendChild(ttl);
    var d = document.createElement('div');
    d.style.cssText = 'max-height:40vh;overflow:auto;color:#8fffd8;font:11px/1.4 ui-monospace,Menlo,monospace;padding:0 10px 8px;white-space:pre-wrap';
    w.appendChild(bar); w.appendChild(d);
    bar.addEventListener('click', function () { _dbgApplyState(_dbg.style.display !== 'none' ? true : false); });
    document.body.appendChild(w);
    _dbgWrap = w; _dbg = d;
    _dbgApplyState(_dbgCollapsed());
    return d;
  }
  function log(m, lvl) {
    try { console.log('[host-engine]' + (lvl ? ' ' + lvl : ''), m); } catch (e) {}
    try {
      var p = _dbgPanel();
      if (p) { var line = document.createElement('div'); line.textContent = (lvl ? '[' + lvl + '] ' : '') + m; if (lvl === 'warn' || lvl === 'error') line.style.color = '#ff9ec4'; p.appendChild(line); p.scrollTop = p.scrollHeight; }
    } catch (e) {}
  }
  function sock() { try { return (typeof socket !== 'undefined' && socket) ? socket : (window.socket || null); } catch (e) { return window.socket || null; } }
  function appState() { try { return (typeof state !== 'undefined' && state) ? state : (window.state || null); } catch (e) { return window.state || null; } }

  // ── Token Supabase — réutilise getProfileJwt() de la SPA (vrai access_token SSO). ──
  // Repli djbrain-lite si indisponible (ex. session sbauth de test = pas de token).
  var _token = null;  // cache synchrone pour engine.resolve() (qui lit le token en sync)
  async function getToken() {
    try { if (typeof getProfileJwt === 'function') { var t = await getProfileJwt(); if (t) return t; } } catch (e) {}
    try { if (window.getProfileJwt) { var t2 = await window.getProfileJwt(); if (t2) return t2; } } catch (e) {}
    return null;
  }
  async function refreshToken() { _token = await getToken(); return _token; }

  // ── Génération code/secret (mêmes règles que host.js) ──────────────────────
  function randomString(n) { var a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', s = ''; for (var i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function genCode() { var a = 'ABCDEFGHIJKLMNPQRSTUVWXYZ0123456789', s = ''; for (var i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }

  // ── Point de montage du lecteur YouTube DANS la zone pochette (remplace le vinyle) ──
  function ensureYtMount() {
    if (document.getElementById('yt-player-mount')) return;
    var zone = document.querySelector('.soiree-artwork-zone');
    var m = document.createElement('div');
    m.id = 'yt-player-mount';
    if (zone) {
      zone.appendChild(m);
      zone.classList.add('hm-host-video'); // CSS host-mode : masque vinyle/pochette, affiche la vidéo
    } else {
      var onair = document.getElementById('tab-soiree'); if (!onair) return;
      m.style.cssText = 'margin:0 0 14px;border-radius:16px;overflow:hidden;min-height:200px;background:#000';
      onair.insertBefore(m, onair.firstChild);
    }
  }

  // ── Moteur ─────────────────────────────────────────────────────────────────
  async function ensureEngine(provider) {
    if (engine) return engine;
    provider = provider || 'youtube';
    if (provider === 'youtube') ensureYtMount();   // zone vidéo seulement pour YouTube
    await refreshToken();                          // charge le token AVANT la création (resolve l'utilise)
    var opts = { getToken: function () { return _token; }, onLog: function (m, l) { log(m, l); } };
    if (provider === 'spotify') {
      // clientId public (PKCE) pour le moteur Spotify
      try { var cfg = await fetch('/api/config/spotify').then(function (r) { return r.ok ? r.json() : {}; }); opts.clientId = cfg.clientId || null; } catch (e) {}
    }
    var mod = await import('/shared/player-engine.js?v=pe-03');
    engine = await mod.createEngine(provider, opts);
    // Auto-advance : à chaque changement de titre réel, avancer l'index + ré-émettre.
    engine.on('trackChanged', function () { /* état visuel géré par la SPA via party:state */ });
    engine.on('trackEnded', function () { onEngineAdvanced(); });
    engine.on('needsUserGesture', function () { isPlaying = false; toast('Touche ▶ pour lancer la lecture'); });
    engine.on('needsVisibleScreen', function () { toast('Garde l\'écran allumé pour YouTube'); });
    engine.on('error', function (e) { var m = (typeof e === 'string') ? e : (e && e.message) || 'Erreur de lecture'; log('engine error: ' + m, 'warn'); toast(m); });
    // Titre injouable (retiré / embed interdit / erreur) → sauter, que l'auto soit on ou off.
    engine.on('trackUnavailable', function () { advanceToPlayable(idx + 1, 'indisponible'); });
    // Lecture figée (watchdog) → relancer le titre une fois, puis sauter s'il reste bloqué.
    engine.on('stalled', function () {
      if (stallTries < 1) {
        stallTries++;
        log('stall → relance du titre courant', 'warn');
        var cur = tracks[idx];
        if (cur) engine.resolve(cur).then(function (pid) { if (pid) engine.play(pid); });
      } else {
        log('stall persistant → saut au titre suivant', 'warn');
        advanceToPlayable(idx + 1, 'stall');
      }
    });
    // Retour OAuth Spotify (?code&state=host_auth) → connect NON interactif pour consommer le
    // callback ; sinon interactif (peut rediriger vers Spotify). Apple/YouTube : toujours interactif.
    var spotifyCb = provider === 'spotify'
      && /[?&]code=/.test(location.search) && /[?&]state=host_auth\b/.test(location.search);
    // Apple : authorize() EXIGE un geste utilisateur. Un lancement auto (retour SSO ?hostlaunch=1)
    // n'en a pas → connect interactif ici bloquerait indéfiniment. On sonde en non-interactif
    // (configure + état d'auth) ; l'autorisation se fera au premier ▶ (startPending).
    var interactive = (provider === 'apple') ? false : !spotifyCb;
    var cr = await engine.connect({ interactive: interactive });
    log('moteur ' + provider + ' connect → ' + JSON.stringify({ ok: cr && cr.ok, ready: engine.isReady && engine.isReady(), needsAuth: cr && cr.needsAuth, reason: cr && cr.reason }));
    if (spotifyCb) { try { history.replaceState({}, '', location.pathname); } catch (e) {} }
    return engine;
  }

  function toast(m) { try { if (typeof showToast === 'function') return showToast(m, 2200); } catch (e) {} log(m); }

  // ── DJ Brain ────────────────────────────────────────────────────────────────
  async function fetchNext(code, count) {
    count = count || 5;
    var token = await getToken();
    try {
      var res = await fetch('/api/djbrain/next?partyCode=' + encodeURIComponent(code) + '&count=' + count + '&provider=youtube',
        { headers: token ? { Authorization: 'Bearer ' + token } : {} });
      if (res.ok) { var d = await res.json(); if (d && d.tracks && d.tracks.length) { log('djbrain-cloud: ' + d.tracks.length + ' titres (phase ' + d.phase + ')'); return d; } }
    } catch (e) { log('djbrain-cloud erreur: ' + e.message, 'warn'); }
    try { var r2 = await fetch('/api/djbrain-lite/next?partyCode=' + encodeURIComponent(code) + '&count=' + count + '&phase=arrival'); return await r2.json(); }
    catch (e2) { return { tracks: [] }; }
  }

  // ── Émission host:trackUpdate (acceptée car socket dans la room host:CODE) ──
  function emitTrackUpdate(t) {
    var s = sock();
    if (!s || !party || !t) return;
    var cover = t.coverArtURL || t.artworkURL || t.cover || null;
    s.emit('host:trackUpdate', {
      hostSecret: party.hostSecret,   // ★ requis par validateHostSecret (wrapper host:*)
      title: t.title, artist: t.artist,
      spotifyId: (t.spotifyUri ? String(t.spotifyUri).split(':').pop() : null),
      durationMs: t.durationMs || 0,
      // ★ pochette : le guest lit artworkURL (U majuscule) — on envoie tous les variants pour éviter le décalage
      artworkURL: cover, artworkUrl: cover, cover: cover, coverArtURL: cover,
      bpm: t.bpm || null, isrc: t.isrc || null,
      source: 'djbrain-cloud', provider: party.provider || 'youtube',
      sentAt: new Date().toISOString()
    });
    log('host:trackUpdate → ' + t.title);
    // Host web : la SPA hôte joue en local → on met à jour SA carte ON AIR tout de suite,
    // sans dépendre d'un retour serveur (latence / room). Même forme que updateNowPlaying().
    try {
      var np = { title: t.title, artist: t.artist, bpm: t.bpm || null,
                 genre: t.genre || null, artworkURL: cover, source: 'djbrain-cloud' };
      if (typeof window.updateNowPlaying === 'function') window.updateNowPlaying(np);
      var ap = appState(); if (ap) ap.currentTrack = { title: t.title, artist: t.artist };
    } catch (e) {}
  }

  async function prequeueNext() {
    if (!autoAdvance) return;    // enchaînement auto coupé → pas de préqueue
    if (!engine || !engine.capabilities || !engine.capabilities.selfAdvancing) return;
    var nx = tracks[idx + 1];
    if (!nx) {
      var d = await fetchNext(party.code, 5);
      var fresh = (d.tracks || []).filter(function (t) { return !tracks.some(function (e) { return e.trackId === t.trackId; }); });
      tracks = tracks.concat(fresh);
      nx = tracks[idx + 1];
    }
    if (!nx) return;
    var pid = await engine.resolve(nx);
    if (pid) { queuedPid = pid; await engine.queueNext(pid); log('préqueue → ' + nx.title); }
  }

  async function onEngineAdvanced() {
    if (!autoAdvance) return;    // auto coupé → on ne saute pas tout seul
    var selfAdv = engine && engine.capabilities && engine.capabilities.selfAdvancing;
    if (selfAdv) {
      // YouTube : le moteur a déjà chargé le titre mémorisé → avancer l'index + ré-émettre.
      if (idx + 1 < tracks.length) { idx++; stallTries = 0; var now = tracks[idx]; if (now) emitTrackUpdate(now); }
      await prequeueNext();
    } else {
      // Spotify / Apple : rien n'est pré-chargé → jouer explicitement le prochain titre jouable.
      await advanceToPlayable(idx + 1, 'auto');
    }
    await ensureBuffer(3);   // garde la file alimentée par le DJ Brain (continuité)
  }

  // ── Avance jusqu'au premier titre réellement jouable (robustesse soirée live) ──
  // Saute les titres injouables (resolve null, retirés, embed interdit), recharge la file
  // via le DJ Brain si épuisée, et se protège des boucles (max 8 essais).
  async function advanceToPlayable(startIdx, reason) {
    if (skipping) return;        // un saut est déjà en cours
    skipping = true;
    try {
      var i = startIdx, attempts = 0;
      while (attempts < 8) {
        if (i >= tracks.length) {
          var d = await fetchNext(party.code, 5);
          var fresh = (d.tracks || []).filter(function (t) { return !tracks.some(function (e) { return e.trackId === t.trackId; }); });
          if (!fresh.length) { toast('Plus de titres jouables'); return; }
          tracks = tracks.concat(fresh);
        }
        var cand = tracks[i];
        if (cand) {
          var pid = await engine.resolve(cand);
          if (pid) {
            var ok = await engine.play(pid);
            log('essai "' + (cand.title || '?') + '" resolve=' + pid + ' play=' + (ok ? 'OK' : 'ÉCHEC'), ok ? 'info' : 'warn');
            if (ok) { idx = i; queuedPid = null; stallTries = 0; emitTrackUpdate(cand); await prequeueNext(); log('saut (' + (reason || '') + ') → ' + cand.title); return; }
          } else {
            log('essai "' + (cand.title || '?') + '" resolve=NULL (non résolu)', 'warn');
          }
        }
        attempts++; i++;
      }
      toast('Impossible de trouver un titre jouable');
    } catch (e) { log('advanceToPlayable: ' + e.message, 'warn'); }
    finally { skipping = false; }
  }

  // Oriente la SPA vers la soirée de l'host (code + écran On Air) pour que la barre host apparaisse.
  function focusSpaOnParty(code) {
    try {
      var st = appState();
      if (st) { st.partyCode = code; if ('code' in st) st.code = code; }
      // Réutilise le setup complet du cockpit invité (câble la nav du bas AGIR/ON AIR/MOI/
      // AFTERGLOW + votes + suggest + historique). enterCockpit ne connecte PAS de socket et
      // n'émet PAS de guest:join → sûr en host. Sinon seul l'onglet ON AIR était actif.
      var ec = (typeof enterCockpit === 'function') ? enterCockpit : (window.enterCockpit || null);
      if (ec) { try { ec(); } catch (e) { if (typeof showScreen === 'function') showScreen('cockpit'); } }
      else if (typeof showScreen === 'function') { showScreen('cockpit'); }
      if (typeof showTab === 'function') { try { showTab('on-air'); } catch (e) {} }
      if (window.AhOuaiHostMode && typeof window.AhOuaiHostMode.sync === 'function') window.AhOuaiHostMode.sync();
    } catch (e) { log('focusSpaOnParty: ' + e.message, 'warn'); }
  }

  // ── Lancement d'une soirée en host depuis la SPA ───────────────────────────
  async function launchHost(opts) {
    opts = opts || {};
    // Garde idempotente : évite une double soirée si launchHost est appelé 2x
    // (ex. startHostWeb + l'IIFE autoLaunchHost sur le même chargement ?hostlaunch=1).
    if (party && party.code) { log('launchHost ignoré (déjà actif ' + party.code + ')'); focusSpaOnParty(party.code); return { ok: true, code: party.code }; }
    var s = sock();
    var st = appState();
    if (!s) { toast('Socket non connecté'); return { ok: false }; }
    var code = (opts.code || genCode()).toUpperCase();
    var hostSecret = randomString(32);
    party = { code: code, hostSecret: hostSecret, provider: opts.provider || 'youtube', name: opts.name || null };

    var profile = {
      name: (st && (st.guestName || st.guestFirstName)) || 'DJ',
      email: (st && st.guestEmail) || '',
      emoji: (st && st.guestEmoji) || '🎧',
      photo: (st && st.guestPhoto) || null, phone: '', instagram: ''
    };
    s.emit('host:startParty', { code: code, hostSecret: hostSecret, profile: profile, streamingProvider: party.provider, deviceId: null });
    log('host:startParty émis (' + code + ', ' + party.provider + ')');

    // Bascule la vue de la SPA sur la soirée de l'host → la barre host s'affiche sur On Air.
    focusSpaOnParty(code);

    await ensureEngine(party.provider);
    if (engine.isReady()) {
      await loadAndPlayFirst(code);
    } else if (engine.id === 'apple') {
      // Apple non encore autorisé (retour SSO sans geste) → armer le ▶ : le tap fera authorize()+1er titre.
      pendingStart = { code: code };
      isPlaying = false;
      try { var ic = document.getElementById('hm-pp-ic'); if (ic) ic.textContent = '▶'; } catch (e) {}
      log('Apple prêt — touche ▶ pour lancer la soirée', 'info');
      toast('Touche ▶ pour lancer la musique');
    } else {
      var r = await engine.connect({ interactive: true });
      if (r && r.redirecting) return { ok: false, redirecting: true };
      await loadAndPlayFirst(code);
    }
    return { ok: true, code: code };
  }

  // ── Rebind après (re)connexion socket ──────────────────────────────────────
  // Socket.IO reconnect = NOUVEAU socket serveur (socket.partyCode perdu). Sans ça, le host
  // pilote encore la musique en local mais le serveur ne le rattache plus à sa soirée →
  // guest:suggest renvoie [no_party]. On ré-émet host:startParty (chemin RESUME, hostSecret
  // identique) pour re-poser socket.partyCode + rejoindre la room host:CODE.
  function rebind() {
    var s = sock();
    if (!s || !party || !party.code) return false;
    var st = appState();
    var profile = {
      name: (st && (st.guestName || st.guestFirstName)) || 'DJ',
      email: (st && st.guestEmail) || '',
      emoji: (st && st.guestEmoji) || '🎧',
      photo: (st && st.guestPhoto) || null, phone: '', instagram: ''
    };
    s.emit('host:startParty', { code: party.code, hostSecret: party.hostSecret, profile: profile, streamingProvider: party.provider, deviceId: null });
    log('rebind soirée hôte (' + party.code + ') après (re)connexion', 'info');
    return true;
  }

  // Apple : authorize() + lecture du 1er titre, déclenchés PAR le geste ▶ (sinon Safari bloque).
  async function startPending() {
    var ps = pendingStart;
    if (!engine || !ps) return false;
    if (!engine.isReady()) {
      var r = await engine.connect({ interactive: true });   // authorize() DANS le geste utilisateur
      log('moteur ' + engine.id + ' connect(geste) → ' + JSON.stringify({ ok: r && r.ok, ready: engine.isReady && engine.isReady() }), (engine.isReady && engine.isReady()) ? 'info' : 'warn');
      if (!engine.isReady()) { toast('Autorisation ' + engine.id + ' refusée'); return false; }
    }
    pendingStart = null; isPlaying = true;
    await loadAndPlayFirst(ps.code);
    return true;
  }

  async function loadAndPlayFirst(code) {
    var d = await fetchNext(code, 5);
    tracks = d.tracks || []; idx = 0; queuedPid = null; stallTries = 0;
    if (!tracks.length) { toast('Aucun titre trouvé'); return; }
    log('file ' + tracks.length + ' titres · 1er = ' + (tracks[0] && tracks[0].title));
    var first = tracks[0];
    var pid = await engine.resolve(first);
    log('resolve(1er) → ' + (pid || 'NULL') + (pid ? '' : ' (titre non résolu sur ce provider)'), pid ? 'info' : 'warn');
    if (pid) {
      var ok = await engine.play(pid);
      log('play(1er) → ' + (ok ? 'OK' : 'ÉCHEC'), ok ? 'info' : 'warn');
      if (ok) { emitTrackUpdate(first); await prequeueNext(); return; }
    }
    // Premier titre injouable → chercher le premier titre jouable de la file.
    log('premier titre injouable → recherche du prochain jouable', 'warn');
    await advanceToPlayable(1, 'first');
  }

  // ── Transport (câblé sur la barre host-mode.js) ─────────────────────────────
  var isPlaying = true;
  async function togglePlay() {
    if (!engine) return;
    if (pendingStart) { await startPending(); return isPlaying; }   // 1er ▶ = autorise + lance
    if (isPlaying) { await engine.pause(); isPlaying = false; } else { await engine.resume(); isPlaying = true; }
    return isPlaying;
  }
  async function play() {
    if (pendingStart) { await startPending(); return; }
    if (engine) { await engine.resume(); isPlaying = true; }
  }
  async function pause() { if (engine) { await engine.pause(); isPlaying = false; } }
  async function next() {
    if (!engine) return;
    stallTries = 0;
    if (queuedPid) { await engine.next(); }      // charge le prochain mémorisé + onEngineAdvanced via trackEnded
    else { await advanceToPlayable(idx + 1, 'next'); }  // saute les injouables jusqu'au prochain titre lisible
  }
  async function repeat() {
    if (!engine) return; var cur = tracks[idx]; if (!cur) return;
    var pid = await engine.resolve(cur); if (pid) await engine.play(pid);
  }

  function isActive() { return !!party; }
  function getNowPlaying() { return tracks[idx] || null; }
  function getCode() { return party ? party.code : null; }

  // ── ENCHAÎNEMENT AUTO ───────────────────────────────────────────────────────
  function setAutoAdvance(on) { autoAdvance = !!on; if (autoAdvance) prequeueNext(); return autoAdvance; }
  function getAutoAdvance() { return autoAdvance; }

  // ── À SUIVRE (file des prochains titres, ajustable) ─────────────────────────
  function getUpcoming() {
    return tracks.slice(idx + 1).map(function (t) {
      return { trackId: String(t.trackId), title: t.title, artist: t.artist, coverArtURL: t.coverArtURL || null, _score: t._score, phase: t.phase };
    });
  }
  // Joue tout de suite un titre de la file (le place juste après le courant puis avance).
  async function playNow(trackId) {
    var j = tracks.findIndex(function (t) { return String(t.trackId) === String(trackId); });
    if (j <= idx) return;
    var t = tracks.splice(j, 1)[0];
    tracks.splice(idx + 1, 0, t);
    queuedPid = null;
    await next();
  }
  // Réordonne un titre de la file (dir: 'up' | 'down').
  function move(trackId, dir) {
    var j = tracks.findIndex(function (t) { return String(t.trackId) === String(trackId); });
    if (j <= idx) return;
    var k = dir === 'up' ? j - 1 : j + 1;
    if (k <= idx || k >= tracks.length) return;
    var tmp = tracks[j]; tracks[j] = tracks[k]; tracks[k] = tmp;
    if (j === idx + 1 || k === idx + 1) { queuedPid = null; prequeueNext(); }
  }

  // ── Gestion des suggestions / file (contrôles host) ────────────────────────
  function emitHost(ev, payload) { var s = sock(); if (s && party) s.emit(ev, Object.assign({ hostSecret: party.hostSecret }, payload || {})); }
  // Retire un titre de la file locale (brain ou suggestion).
  function removeFromQueue(trackId) {
    var j = tracks.findIndex(function (t) { return String(t.trackId) === String(trackId); });
    if (j > idx) { tracks.splice(j, 1); if (j === idx + 1) { queuedPid = null; prequeueNext(); } return true; }
    return false;
  }
  // Supprime une suggestion (serveur : host:rejectSuggestion) + la retire de la file.
  function dismissSuggestion(opts) {
    opts = opts || {};
    emitHost('host:rejectSuggestion', { trackTitle: opts.title, guestName: opts.guestName });
    if (opts.trackId) removeFromQueue(opts.trackId);
  }
  // Marque une suggestion comme jouée (serveur : host:suggestionPlayed → points au suggéreur).
  function noteSuggestionPlayed(opts) {
    opts = opts || {};
    emitHost('host:suggestionPlayed', { trackTitle: opts.title, guestName: opts.guestName, guestId: opts.guestId || opts.guestName });
  }

  function normKey(s) { return String(s == null ? '' : s).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]/g, '').trim(); }

  // ★ Host valide une suggestion → elle ENTRE dans la file « À suivre » (par défaut en prochain).
  //   Doctrine produit : guest propose → host valide → play. Emet host:acceptSuggestion (statut 'queued').
  function addSuggestionToQueue(sugg, position) {
    sugg = sugg || {};
    if (!sugg.title) return null;
    var key = normKey(sugg.title);
    var exists = tracks.findIndex(function (t) { return (sugg.trackId && String(t.trackId) === String(sugg.trackId)) || normKey(t.title) === key; });
    if (exists > idx) return tracks[exists]; // déjà en file → pas de doublon, pas de ré-émission
    var t = { trackId: sugg.trackId || ('sugg_' + key), title: sugg.title, artist: sugg.artist || '', isrc: sugg.isrc || null, _suggested: true, _guestName: sugg.guestName || null };
    var at = (position === 'end') ? tracks.length : (idx + 1);
    tracks.splice(at, 0, t);
    if (at === idx + 1) { queuedPid = null; prequeueNext(); }
    emitHost('host:acceptSuggestion', { trackTitle: sugg.title, guestName: sugg.guestName, trackId: sugg.trackId });
    log('suggestion ajoutée à la file : ' + sugg.title);
    return t;
  }

  // ★ Continuité : garde toujours au moins `min` titres d'avance (recharge via le DJ Brain).
  async function ensureBuffer(min) {
    min = min || 3;
    if (!party || !engine) return;
    if (tracks.length - idx - 1 >= min) return;
    try {
      var d = await fetchNext(party.code, 5);
      var fresh = (d.tracks || []).filter(function (t) { return !tracks.some(function (e) { return String(e.trackId) === String(t.trackId) || normKey(e.title) === normKey(t.title); }); });
      if (fresh.length) { tracks = tracks.concat(fresh); log('buffer complété (+' + fresh.length + ' via DJ Brain)'); }
    } catch (e) { log('ensureBuffer: ' + e.message, 'warn'); }
  }

  window.AhOuaiHostEngine = {
    launchHost: launchHost, play: play, pause: pause, togglePlay: togglePlay,
    next: next, repeat: repeat, isActive: isActive, getNowPlaying: getNowPlaying, getCode: getCode, rebind: rebind,
    setAutoAdvance: setAutoAdvance, getAutoAdvance: getAutoAdvance,
    getUpcoming: getUpcoming, playNow: playNow, move: move,
    removeFromQueue: removeFromQueue, dismissSuggestion: dismissSuggestion, noteSuggestionPlayed: noteSuggestionPlayed,
    addSuggestionToQueue: addSuggestionToQueue, ensureBuffer: ensureBuffer,
    _debug: function () { return { party: party, idx: idx, tracks: tracks.length, isPlaying: isPlaying, auto: autoAdvance, engine: engine ? engine.id : null }; }
  };
  if (!booted) { booted = true; log('prêt (brique 2 — chemin YouTube)'); }

  // ── Déclencheur de test « On Air host » : ?hostlaunch=1 → lance une soirée host au chargement.
  //    Actif UNIQUEMENT avec le paramètre → invité normal jamais impacté. Permet de valider
  //    l'écran On Air host + la lecture réelle (token via session Supabase même-origine) avant
  //    de rebrancher la vraie création de soirée dessus.
  (function autoLaunchHost() {
    if (!/[?&]hostlaunch=1\b/.test(location.search)) return;
    var params = new URLSearchParams(location.search);
    var provider = params.get('provider') || 'youtube';
    var name = params.get('name') || null;
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      var s = sock();
      if (s && s.connected) {
        clearInterval(iv);
        setTimeout(function () { try { launchHost({ provider: provider, name: name }); } catch (e) { log('autoLaunch: ' + e.message, 'warn'); } }, 700);
      } else if (tries > 50) { clearInterval(iv); }
    }, 300);
  })();
})();
