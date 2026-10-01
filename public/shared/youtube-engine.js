/**
 * public/shared/youtube-engine.js
 * ★ Lot 3 host web (01/10/2026) — Moteur YouTube (IFrame Player API).
 *
 * Universel, gratuit, légal (YouTube porte les droits), ordinateur et mobile.
 * Contraintes assumées (CGU YouTube + navigateurs) :
 *   - le lecteur reste VISIBLE (≥ 200×200), jamais display:none, pas de blocage de pub ;
 *   - sur mobile, la lecture s'arrête si l'écran se verrouille ou si l'onglet passe en
 *     arrière-plan → Wake Lock pour garder l'écran allumé + bandeau si indisponible ;
 *   - autoplay : le 1er play exige un geste utilisateur (onAutoplayBlocked → needsUserGesture).
 *
 * Transition : pas de file native. queueNext(videoId) mémorise le prochain ; à la fin
 * du titre (onStateChange ENDED), le prochain est chargé automatiquement (enchaînement
 * sans geste, le player garde le "contexte" du geste initial). Le cockpit, lui, avance
 * son index à T-5s pour la synchro guests (host:trackUpdate) ; l'audio bascule à la fin
 * réelle. Les deux s'appuient sur le même prochain titre → cohérent.
 *
 * Identifiant provider = videoId YouTube (11 car.). resolve(track) passe par /api/resolve.
 */
import { BasePlayerEngine } from '/shared/player-engine.js';

const IFRAME_API = 'https://www.youtube.com/iframe_api';
const CONTAINER_ID = 'yt-player';   // div visible dans screen-playing (créée si absente)

let _apiLoading = null;
function _loadIframeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (_apiLoading) return _apiLoading;
  _apiLoading = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    if (!document.querySelector(`script[src="${IFRAME_API}"]`)) {
      const s = document.createElement('script');
      s.src = IFRAME_API;
      document.head.appendChild(s);
    }
  });
  return _apiLoading;
}

export default class YouTubeEngine extends BasePlayerEngine {
  constructor(opts = {}) {
    super('youtube', opts);
    this._player     = null;
    this._ready      = false;
    this._pendingNext = null;        // videoId du prochain titre (posé par queueNext)
    this._curVideoId = null;
    this._wakeLock   = null;
    this._poll       = null;
    this._state      = { providerId: null, positionMs: 0, durationMs: 0, isPlaying: false, title: null, artist: null, artworkUrl: null };
    this._meta       = {};           // videoId → {title, artist, artworkUrl} (fourni par play/queueNext)
  }

  // ── Auth : aucune (pas de compte requis). "connect" = charger l'API + créer le player. ──
  async connect() {
    try {
      await _loadIframeApi();
      await this._ensurePlayer();
      if (!this._visBound) { this._visBound = () => this._onVisible(); document.addEventListener('visibilitychange', this._visBound); }
      return { ok: true };
    } catch (e) {
      this._emit('error', e);
      return { ok: false, reason: e.message };
    }
  }
  isReady()        { return this._ready; }
  notReadyReason() { return this._ready ? null : 'Lecteur YouTube non initialisé'; }

  _ensurePlayer() {
    if (this._player) return Promise.resolve();
    // Conteneur visible dans screen-playing (créé si le HTML ne l'a pas)
    let host = document.getElementById(CONTAINER_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = CONTAINER_ID;
      const mount = document.getElementById('yt-player-mount') || document.getElementById('screen-playing') || document.body;
      mount.appendChild(host);
    }
    return new Promise((resolve) => {
      this._player = new window.YT.Player(CONTAINER_ID, {
        width: '100%', height: '220',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
        events: {
          onReady: () => { this._ready = true; resolve(); },
          onStateChange: (e) => this._onStateChange(e),
          onError: (e) => this.onLog(`YouTube player error ${e.data}`, 'warn'),
          onAutoplayBlocked: () => this._emit('needsUserGesture'),
        }
      });
    });
  }

  _onStateChange(e) {
    const YT = window.YT;
    if (e.data === YT.PlayerState.ENDED) {
      // Fin naturelle → charger le prochain mémorisé (enchaînement sans geste)
      if (this._pendingNext) {
        const next = this._pendingNext;
        this._pendingNext = null;
        this.onLog(`YouTube ENDED → chargement du prochain (${next})`, 'info');
        this._loadAndEmit(next);
      } else {
        this._emit('trackEnded', { providerId: this._curVideoId });
      }
    } else if (e.data === YT.PlayerState.PLAYING) {
      this._startPoll();
    } else if (e.data === YT.PlayerState.PAUSED) {
      this._stopPoll();
      this._emit('stateChanged', { ...this._readState() });
    }
  }

  _loadAndEmit(videoId) {
    const prev = this._curVideoId;
    this._curVideoId = videoId;
    this._player.loadVideoById(videoId);
    if (prev) this._emit('trackEnded', { providerId: prev });
    this._emit('trackChanged', { ...this._readState() });
    this._requestWakeLock();
  }

  _startPoll() {
    if (this._poll) return;
    this._poll = setInterval(() => {
      if (!this._player?.getCurrentTime) return;
      this._emit('stateChanged', { ...this._readState() });
    }, 1000);
  }
  _stopPoll() { if (this._poll) { clearInterval(this._poll); this._poll = null; } }

  _readState() {
    const p = this._player;
    const YT = window.YT;
    let pos = 0, dur = 0, playing = false;
    try {
      pos = (p?.getCurrentTime?.() || 0) * 1000;
      dur = (p?.getDuration?.() || 0) * 1000;
      playing = p?.getPlayerState?.() === YT?.PlayerState?.PLAYING;
    } catch {}
    const meta = this._meta[this._curVideoId] || {};
    this._state = {
      providerId: this._curVideoId, positionMs: pos, durationMs: dur, isPlaying: playing,
      title: meta.title || null, artist: meta.artist || null, artworkUrl: meta.artworkUrl || null,
    };
    return this._state;
  }

  // ── Résolution ────────────────────────────────────────────────────────────
  async resolve(track) {
    // Mémoriser les métadonnées pour l'affichage (YouTube ne les redonne pas proprement)
    const id = track?.providers?.youtube?.videoId || await super.resolve(track);
    if (id) this._meta[id] = { title: track.title, artist: track.artist, artworkUrl: track.coverArtURL || null };
    return id;
  }

  // ── Lecture ───────────────────────────────────────────────────────────────
  async play(videoId) {
    if (!this._ready) { const r = await this.connect(); if (!r.ok) return false; }
    this._curVideoId = videoId;
    try {
      this._player.loadVideoById(videoId);   // charge + démarre (geste utilisateur du "Lancer")
      this._requestWakeLock();
      this._startPoll();
      this._emit('trackChanged', { ...this._readState() });
      return true;
    } catch (e) { this.onLog(`YouTube play erreur : ${e.message}`, 'error'); return false; }
  }

  async queueNext(videoId) { this._pendingNext = videoId; return true; }  // chargé à ENDED
  async pause()  { try { this._player?.pauseVideo?.(); } catch {} this._stopPoll(); }
  async resume() { try { this._player?.playVideo?.();  } catch {} this._requestWakeLock(); }
  async next()   {
    // Saut manuel : si un prochain est mémorisé on le charge, sinon on laisse finir
    if (this._pendingNext) { const n = this._pendingNext; this._pendingNext = null; this._loadAndEmit(n); }
    else this._emit('trackEnded', { providerId: this._curVideoId });
  }
  getState() { return { ...this._state }; }

  // ── Wake Lock (garder l'écran allumé) ───────────────────────────────────────
  async _requestWakeLock() {
    if (!('wakeLock' in navigator)) {
      if (!this._warnedWake) { this._warnedWake = true; this._emit('needsVisibleScreen'); this.onLog('Wake Lock indisponible — garde l\'écran allumé', 'warn'); }
      return;
    }
    try {
      this._wakeLock = await navigator.wakeLock.request('screen');
      this._wakeLock.addEventListener?.('release', () => { this._wakeLock = null; });
    } catch (e) { this.onLog(`Wake Lock refusé : ${e.message}`, 'warn'); }
  }
  // Ré-acquisition au retour au premier plan (le lock saute quand l'onglet est masqué)
  _onVisible() { if (document.visibilityState === 'visible' && this._state.isPlaying) this._requestWakeLock(); }

  dispose() {
    this._stopPoll();
    if (this._visBound) { document.removeEventListener('visibilitychange', this._visBound); this._visBound = null; }
    try { this._wakeLock?.release?.(); } catch {}
    this._wakeLock = null;
    try { this._player?.destroy?.(); } catch {}
    this._player = null; this._ready = false;
    this._handlers = {};
  }
}
