/**
 * public/shared/apple-engine.js
 * ★ Lot 2 host web — Moteur Apple Music (MusicKit JS v3).
 *
 * Contrat commun PlayerEngine (voir player-engine.js). Lecture de titres COMPLETS dans
 * le navigateur via MusicKit ; nécessite un abonnement Apple Music actif côté hôte.
 *
 * Auth : dev-token signé côté serveur (GET /api/apple/dev-token), puis authorize() (geste
 * utilisateur, ouvre le flux Apple). Identifiant provider = Apple Music catalog song id
 * (providers.appleMusic.trackId, résolu par /api/resolve?provider=apple).
 *
 * NON self-advancing : on joue un titre à la fois ; à la fin (completed/ended) on émet
 * 'trackEnded' et le cockpit (host-engine) enchaîne le suivant. Jamais la clé dans les logs.
 */
import { BasePlayerEngine } from '/shared/player-engine.js?v=pe-05';

const MK_SRC = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
let _loading = null;
function _loadMusicKit() {
  if (window.MusicKit) return Promise.resolve();
  if (_loading) return _loading;
  _loading = new Promise((resolve, reject) => {
    const done = () => (window.MusicKit ? resolve() : reject(new Error('MusicKit indisponible')));
    document.addEventListener('musickitloaded', done, { once: true });
    if (!document.querySelector(`script[src="${MK_SRC}"]`)) {
      const s = document.createElement('script');
      s.src = MK_SRC; s.async = true; s.setAttribute('data-web-components', '');
      s.onerror = () => reject(new Error('Chargement MusicKit JS échoué'));
      document.head.appendChild(s);
    } else if (window.MusicKit) { resolve(); }
  });
  return _loading;
}

export default class AppleEngine extends BasePlayerEngine {
  constructor(opts = {}) {
    super('apple', opts);
    this._music = null;
    this._ready = false;
    this._curId = null;
    this._meta = {};   // songId → { title, artist, artworkUrl }
    this._state = { providerId: null, positionMs: 0, durationMs: 0, isPlaying: false, title: null, artist: null, artworkUrl: null };
  }

  async connect(opts = {}) {
    if (this.isReady()) return { ok: true, user: { isApple: true } };
    try {
      await _loadMusicKit();
    } catch (e) { this._emit('error', e); return { ok: false, reason: e.message }; }

    // Jeton développeur signé côté serveur (jamais de clé privée côté client).
    let devToken = null;
    try { const r = await fetch('/api/apple/dev-token'); if (r.ok) devToken = (await r.json()).token; } catch (e) {}
    if (!devToken) { this._emit('error', 'Apple Music non configuré'); return { ok: false, reason: 'Apple Music non configuré' }; }

    try {
      await window.MusicKit.configure({ developerToken: devToken, app: { name: 'AhOuai', build: '1.0' } });
    } catch (e) { this._emit('error', e); return { ok: false, reason: 'Configuration MusicKit échouée' }; }

    this._music = window.MusicKit.getInstance();
    this._bindEvents();

    if (!this._music.isAuthorized) {
      if (!opts.interactive) return { ok: false, needsAuth: true };
      try { await this._music.authorize(); }   // geste utilisateur → flux Apple Music
      catch (e) { return { ok: false, reason: 'Autorisation Apple Music refusée' }; }
    }
    this._ready = !!this._music.isAuthorized;
    return { ok: this._ready, user: { isApple: true }, reachable: this._ready };
  }

  _bindEvents() {
    if (this._bound || !this._music) return; this._bound = true;
    const MK = window.MusicKit;
    this._music.addEventListener('playbackStateDidChange', () => {
      const st = this._music.playbackState;
      const S = MK.PlaybackStates || {};
      if (st === S.completed || st === S.ended) this._emit('trackEnded', { providerId: this._curId });
      this._emit('stateChanged', { ...this._readState() });
    });
    this._music.addEventListener('mediaItemDidChange', () => this._emit('trackChanged', { ...this._readState() }));
    this._music.addEventListener('playbackTimeDidChange', () => this._emit('stateChanged', { ...this._readState() }));
  }

  isReady() { return !!(this._music && this._music.isAuthorized); }
  notReadyReason() {
    if (!this._music) return 'Apple Music non initialisé';
    if (!this._music.isAuthorized) return 'Apple Music non connecté';
    return null;
  }

  // ── Résolution : id catalogue Apple Music (mémorise les métadonnées pour l'affichage) ──
  async resolve(track) {
    const id = track?.providers?.appleMusic?.trackId || track?.appleMusicID || await super.resolve(track);
    if (id) this._meta[String(id)] = { title: track.title, artist: track.artist, artworkUrl: track.coverArtURL || null };
    return id ? String(id) : null;
  }

  _readState() {
    const m = this._music, MK = window.MusicKit;
    let pos = 0, dur = 0, playing = false;
    try {
      pos = (m?.currentPlaybackTime || 0) * 1000;
      dur = (m?.currentPlaybackDuration || 0) * 1000;
      playing = m?.playbackState === (MK?.PlaybackStates?.playing);
    } catch {}
    const meta = this._meta[this._curId] || {};
    this._state = { providerId: this._curId, positionMs: pos, durationMs: dur, isPlaying: playing,
      title: meta.title || null, artist: meta.artist || null, artworkUrl: meta.artworkUrl || null };
    return this._state;
  }

  // ── Lecture ────────────────────────────────────────────────────────────────
  async play(songId) {
    if (!this.isReady()) { const r = await this.connect({ interactive: true }); if (!r.ok) return false; }
    this._curId = String(songId);
    // File posée séparément : même si play() est bloqué (geste), un ▶ ultérieur jouera ce titre.
    try { await this._music.setQueue({ song: String(songId) }); }
    catch (e) { this.onLog(`Apple setQueue erreur : ${e.message}`, 'warn'); this._emit('error', 'Titre Apple indisponible'); return false; }
    try {
      await this._music.play();
      this._emit('trackChanged', { ...this._readState() });
      return true;
    } catch (e) {
      var msg = (e && (e.name + ' ' + (e.message || ''))) || '';
      this.onLog(`Apple play erreur : ${msg}`, 'warn');
      if (/NotAllowed|gesture|user interaction|interact/i.test(msg)) { this._emit('needsUserGesture'); }
      else if (/subscription|Unauthorized|403|capability/i.test(msg)) { this._emit('error', 'Abonnement Apple Music requis (ou non actif)'); }
      else { this._emit('error', 'Lecture Apple impossible : ' + (e && e.message || 'inconnue')); }
      return false;
    }
  }
  async queueNext(songId) {
    // Non self-advancing : le cockpit rejoue le suivant à la fin. On pré-charge quand même
    // la file Apple pour fluidifier (best-effort, ignoré si échec).
    try { await this._music.playLater({ song: String(songId) }); return true; } catch { return false; }
  }
  async pause()  { try { await this._music?.pause(); } catch {} }
  async resume() { try { await this._music?.play(); } catch {} }
  async next()   { try { await this._music?.skipToNextItem(); } catch {} this._emit('trackEnded', { providerId: this._curId }); }
  getState() { return { ...this._state }; }

  dispose() {
    try { this._music?.stop?.(); } catch {}
    this._music = null; this._ready = false; this._bound = false; this._handlers = {};
  }
}
