/**
 * public/shared/spotify-engine.js
 * ★ Lot 1 host web (01/10/2026) — Moteur Spotify = enveloppe du SpotifyService existant
 *   (pilotage de l'app Spotify via Connect API, sondes, PKCE). Aucune logique rejouée :
 *   on délègue, on traduit le state Spotify vers le contrat PlayerEngine.
 *
 * Identifiant provider = URI `spotify:track:<id>` (ce que djbrain-lite renvoie déjà
 * dans `spotifyUri`). resolve(track) renvoie track.spotifyUri si présent, sinon /api/resolve.
 *
 * Écrans propres à Spotify (appareils, Web Playback SDK, détection fantôme) : host.js
 * y accède via `engine.raw` (SpotifyService), toujours gardé par `engine.id === 'spotify'`.
 */
import SpotifyService from '/shared/spotify-service.js?v=spsvc-03';
import { BasePlayerEngine } from '/shared/player-engine.js?v=pe-06';

export default class SpotifyEngine extends BasePlayerEngine {
  constructor(opts = {}) {
    super('spotify', opts);
    this._state = { providerId: null, positionMs: 0, durationMs: 0, isPlaying: false, title: null, artist: null, artworkUrl: null };
    this._lastProviderId = null;
    this.raw = new SpotifyService({
      clientId:      opts.clientId,
      onStateChange: (s) => this._onSpotifyState(s),
      onNoDevice:    () => this._emit('noDevice'),
      onAutoPlay:    (d) => this.onLog(`⚡ AUTOPLAY : ${d.name}`, 'warn'),
      onRelink:      (d) => this.onLog(`🔗 RELINK : ${d.requested} → ${d.played}`, 'info'),
      // ★ Fin de titre détectée par le Web Playback SDK (device navigateur) : Spotify n'est pas
      //   selfAdvancing, le cockpit enchaîne le suivant (onEngineAdvanced via trackEnded).
      onTrackEnd:    () => { this.onLog('Spotify : fin de titre → enchaînement', 'info'); this._emit('trackEnded', { providerId: this._lastProviderId }); },
      onLog:         (msg, lvl) => this.onLog(msg, lvl)
    });
  }

  /**
   * Traduction du state Spotify (sonde /me/player) → contrat commun + événements.
   * Sémantique : 'trackChanged' à chaque changement d'URI (y compris la 1re sonde, sans
   * 'trackEnded') ; 'trackEnded' pour l'URI précédente juste avant — SAUF quand le Web
   * Playback SDK est actif (device navigateur), où onTrackEnd est la seule autorité de fin ;
   * rejouer le MÊME titre (prev) n'émet rien. 'stateChanged' à chaque sonde.
   */
  _onSpotifyState(s) {
    if (!s) return;
    const { isPlaying, item, progress, duration } = s;
    const providerId = item?.uri || null;
    this._state = {
      providerId,
      positionMs: progress || 0,
      durationMs: duration || 0,
      isPlaying:  !!isPlaying,
      title:      item?.name || null,
      artist:     (item?.artists || []).map(a => a.name).join(', ') || null,
      artworkUrl: item?.album?.images?.[1]?.url || item?.album?.images?.[0]?.url || null
    };
    if (providerId && providerId !== this._lastProviderId) {
      const prev = this._lastProviderId;
      this._lastProviderId = providerId;
      // ★ 03/10/2026 — fin de titre à la racine : avec le Web Playback SDK actif
      //   (this.raw._sdkDeviceId défini), onTrackEnd est la SEULE autorité de fin. Le
      //   trackEnded déduit ici du changement d'URI par la sonde Connect est toujours
      //   périmé/redondant et déclenchait la cascade de double-avance (jusqu'ici neutralisée
      //   seulement par le garde côté cockpit). On ne l'émet donc que sans SDK (mobile /
      //   Connect-only). trackChanged/stateChanged (sonde d'affichage) restent inchangés.
      if (prev && !this.raw._sdkDeviceId) this._emit('trackEnded', { providerId: prev });
      this._emit('trackChanged', { ...this._state });
    }
    this._emit('stateChanged', { ...this._state });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  /** Callback PKCE présent dans l'URL ? (code + state=host_auth) */
  static hasCallbackInUrl() {
    const p = new URLSearchParams(window.location.search);
    return !!(p.get('code') && p.get('state') === 'host_auth');
  }

  /**
   * @param {{interactive?: boolean}} opts — interactive=false : jamais de redirection
   *   (connexion silencieuse : callback PKCE dans l'URL ou tokens en sessionStorage).
   */
  async connect(opts = {}) {
    if (this.isReady()) { await this._initBrowserDevice(); return { ok: true, user: { firstName: this.raw.userFirstName, isPremium: this.raw.isPremium } }; }
    // Callback PKCE : traité UNE seule fois ; en cas d'échec l'URL est nettoyée pour que
    // l'appel interactif suivant reparte sur startPKCE() (revue 01/10, P1.2).
    if (!opts.interactive && !this._cbTried && SpotifyEngine.hasCallbackInUrl()) {
      this._cbTried = true;
      try {
        await this.raw.handleCallback();
      } catch (e) {
        try { window.history.replaceState({}, '', window.location.pathname); } catch {}
        throw e;
      }
      const me = await this.raw.fetchMe();
      if (this.isReady()) await this._initBrowserDevice();
      return { ok: this.isReady(), user: me ? { firstName: me.firstName, isPremium: me.isPremium } : null, reachable: !!me };
    }
    const already = this.raw.accessToken ? true : await this.raw.init();
    if (already) {
      const me = await this.raw.fetchMe();
      if (this.isReady()) await this._initBrowserDevice();
      return { ok: this.isReady(), user: me ? { firstName: me.firstName, isPremium: me.isPremium } : null, reachable: !!me };
    }
    if (!opts.interactive) return { ok: false, needsAuth: true };
    await this.raw.startPKCE();   // redirection OAuth → la page reviendra avec ?code
    return { ok: false, redirecting: true };
  }

  // Web Playback SDK : navigateur = device Spotify (desktop). Best-effort, non bloquant en cas d'échec.
  async _initBrowserDevice() { try { await this.raw.initWebPlayback(); } catch (e) { this.onLog('initWebPlayback: ' + e.message, 'warn'); } }

  isReady()        { return !!(this.raw.accessToken && this.raw.isPremium); }
  notReadyReason() {
    if (!this.raw.accessToken) return 'Spotify non connecté';
    if (!this.raw.isPremium)   return 'Spotify non Premium';
    return null;
  }

  // ── Résolution ────────────────────────────────────────────────────────────
  async resolve(track) {
    if (track?.spotifyUri) return track.spotifyUri;
    const id = await super.resolve(track);
    return id ? (id.startsWith('spotify:') ? id : `spotify:track:${id}`) : null;
  }

  // ── Lecture ───────────────────────────────────────────────────────────────
  async play(providerId)      { return this.raw.play([providerId]); }
  async queueNext(providerId) { return this.raw.queue(providerId); }
  async pause()               { await this.raw.pause(); }
  async resume()              { await this.raw.resume(); }
  async next()                { await this.raw.next(); }
  getState()                  { return { ...this._state }; }
  dispose() {
    try {
      this.raw._clearProbes?.();
      this.raw.releaseWakeLock?.();
      if (this.raw._refreshTimer) { clearTimeout(this.raw._refreshTimer); this.raw._refreshTimer = null; }
    } catch {}
    this._handlers = {};
  }
}
