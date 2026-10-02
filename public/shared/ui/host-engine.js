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

  function log(m, lvl) { try { console.log('[host-engine]' + (lvl ? ' ' + lvl : ''), m); } catch (e) {} }
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

  // ── Point de montage du lecteur YouTube sur l'écran On Air ─────────────────
  function ensureYtMount() {
    if (document.getElementById('yt-player-mount')) return;
    var onair = document.getElementById('tab-soiree');
    if (!onair) return;
    var m = document.createElement('div');
    m.id = 'yt-player-mount';
    m.style.cssText = 'margin:0 0 16px;border-radius:16px;overflow:hidden;min-height:200px;background:#000;box-shadow:0 10px 30px rgba(0,0,0,.4)';
    // Juste après la barre de contrôles host si présente, sinon en tête.
    var bar = document.getElementById('host-cockpit-bar');
    if (bar && bar.parentNode === onair) onair.insertBefore(m, bar.nextSibling);
    else onair.insertBefore(m, onair.firstChild);
  }

  // ── Moteur ─────────────────────────────────────────────────────────────────
  async function ensureEngine(provider) {
    if (engine) return engine;
    ensureYtMount();
    await refreshToken();                          // charge le token AVANT la création (resolve l'utilise)
    var mod = await import('/shared/player-engine.js');
    engine = await mod.createEngine(provider || 'youtube', {
      getToken: function () { return _token; },    // token synchrone pour /api/resolve (requis, 401 sinon)
      onLog: function (m, l) { log(m, l); }
    });
    // Auto-advance : à chaque changement de titre réel, avancer l'index + ré-émettre.
    engine.on('trackChanged', function () { /* état visuel géré par la SPA via party:state */ });
    engine.on('trackEnded', function () { onEngineAdvanced(); });
    engine.on('needsUserGesture', function () { toast('Touche « Play » pour démarrer'); });
    engine.on('needsVisibleScreen', function () { toast('Garde l\'écran allumé pour YouTube'); });
    await engine.connect({ interactive: true });
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
    s.emit('host:trackUpdate', {
      hostSecret: party.hostSecret,   // ★ requis par validateHostSecret (wrapper host:*)
      title: t.title, artist: t.artist,
      spotifyId: (t.spotifyUri ? String(t.spotifyUri).split(':').pop() : null),
      durationMs: t.durationMs || 0,
      artworkUrl: t.coverArtURL || null,
      source: 'djbrain-cloud', provider: party.provider || 'youtube',
      sentAt: new Date().toISOString()
    });
    log('host:trackUpdate → ' + t.title);
  }

  async function prequeueNext() {
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
    // Le moteur a enchaîné sur le titre mémorisé → avancer l'index + ré-émettre.
    if (idx + 1 < tracks.length) { idx++; var now = tracks[idx]; if (now) emitTrackUpdate(now); }
    await prequeueNext();
  }

  // Oriente la SPA vers la soirée de l'host (code + écran On Air) pour que la barre host apparaisse.
  function focusSpaOnParty(code) {
    try {
      var st = appState();
      if (st) { st.partyCode = code; if ('code' in st) st.code = code; }
      if (typeof showScreen === 'function') { try { showScreen('cockpit'); } catch (e) {} }
      if (typeof showTab === 'function') { try { showTab('on-air'); } catch (e) {} }
      if (window.AhOuaiHostMode && typeof window.AhOuaiHostMode.sync === 'function') window.AhOuaiHostMode.sync();
    } catch (e) { log('focusSpaOnParty: ' + e.message, 'warn'); }
  }

  // ── Lancement d'une soirée en host depuis la SPA ───────────────────────────
  async function launchHost(opts) {
    opts = opts || {};
    var s = sock();
    var st = appState();
    if (!s) { toast('Socket non connecté'); return { ok: false }; }
    var code = (opts.code || genCode()).toUpperCase();
    var hostSecret = randomString(32);
    party = { code: code, hostSecret: hostSecret, provider: opts.provider || 'youtube' };

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
    if (!engine.isReady()) { var r = await engine.connect({ interactive: true }); if (r && r.redirecting) return { ok: false, redirecting: true }; }

    await loadAndPlayFirst(code);
    return { ok: true, code: code };
  }

  async function loadAndPlayFirst(code) {
    var d = await fetchNext(code, 5);
    tracks = d.tracks || []; idx = 0; queuedPid = null;
    if (!tracks.length) { toast('Aucun titre trouvé'); return; }
    var first = tracks[0];
    var pid = await engine.resolve(first);
    if (!pid) { toast('Titre introuvable sur YouTube'); return; }
    var ok = await engine.play(pid);
    if (!ok) return;
    emitTrackUpdate(first);
    await prequeueNext();
  }

  // ── Transport (câblé sur la barre host-mode.js) ─────────────────────────────
  var isPlaying = true;
  async function togglePlay() {
    if (!engine) return;
    if (isPlaying) { await engine.pause(); isPlaying = false; } else { await engine.resume(); isPlaying = true; }
    return isPlaying;
  }
  async function play() { if (engine) { await engine.resume(); isPlaying = true; } }
  async function pause() { if (engine) { await engine.pause(); isPlaying = false; } }
  async function next() {
    if (!engine) return;
    if (queuedPid) { await engine.next(); }      // charge le prochain mémorisé + onEngineAdvanced via trackEnded
    else { idx++; var nx = tracks[idx]; if (nx) { var pid = await engine.resolve(nx); if (pid) { await engine.play(pid); emitTrackUpdate(nx); await prequeueNext(); } } }
  }
  async function repeat() {
    if (!engine) return; var cur = tracks[idx]; if (!cur) return;
    var pid = await engine.resolve(cur); if (pid) await engine.play(pid);
  }

  function isActive() { return !!party; }
  function getNowPlaying() { return tracks[idx] || null; }

  window.AhOuaiHostEngine = {
    launchHost: launchHost, play: play, pause: pause, togglePlay: togglePlay,
    next: next, repeat: repeat, isActive: isActive, getNowPlaying: getNowPlaying,
    _debug: function () { return { party: party, idx: idx, tracks: tracks.length, isPlaying: isPlaying, engine: engine ? engine.id : null }; }
  };
  if (!booted) { booted = true; log('prêt (brique 2 — chemin YouTube)'); }
})();
