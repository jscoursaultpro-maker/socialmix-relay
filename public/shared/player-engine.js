/**
 * public/shared/player-engine.js
 * ★ Lot 1 host web (01/10/2026) — Contrat commun des moteurs de lecture.
 *
 * Le cockpit hôte (host.js) ne connaît QUE cette interface. Chaque lecteur
 * (Spotify, Apple Music, YouTube) l'implémente dans son propre module.
 *
 * ┌─ PlayerEngine ──────────────────────────────────────────────────────────┐
 * │ id            : 'spotify' | 'apple' | 'youtube'                          │
 * │ capabilities  : { fullTracks, lockScreen, needsVisiblePlayer,            │
 * │                   needsSubscription: 'premium' | 'apple' | null }        │
 * │ connect({interactive}) → Promise<{ ok, user?, redirecting?, needsAuth? }>│
 * │                 idempotent ; interactive=true peut rediriger (OAuth)      │
 * │ isReady()     → bool   prêt à jouer (auth OK + prérequis, ex. Premium)   │
 * │ notReadyReason() → string|null  raison lisible si !isReady()             │
 * │ resolve(track) → Promise<string|null>  id provider (via GET /api/resolve)│
 * │ play(providerId)      → Promise<bool>                                    │
 * │ queueNext(providerId) → Promise<bool>  appelé UNE fois à T−45 s          │
 * │ pause() resume() next() → Promise<void>                                  │
 * │ getState()    → { providerId, positionMs, durationMs, isPlaying,         │
 * │                   title, artist, artworkUrl }                            │
 * │ on(event, cb) : 'stateChanged' | 'trackChanged' | 'trackEnded' |         │
 * │                 'error' | 'needsUserGesture' | 'noDevice'                 │
 * │ dispose()                                                                │
 * │ raw           : service sous-jacent (usage réservé aux écrans propres    │
 * │                 au provider, toujours gardé par `engine.id === …`)       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Doctrine web (inchangée) : un seul titre en file, posé à T−45 s, pour tous
 * les moteurs. Le cockpit décide du QUAND ; le moteur exécute.
 */

export const PROVIDERS = {
  spotify: { label: 'Spotify',     hint: 'Spotify Premium requis',
             capabilities: { fullTracks: true,  lockScreen: true,  needsVisiblePlayer: false, needsSubscription: 'premium' } },
  apple:   { label: 'Apple Music', hint: 'Abonnement Apple Music requis · titres complets',
             capabilities: { fullTracks: true,  lockScreen: true,  needsVisiblePlayer: false, needsSubscription: 'apple' } },
  youtube: { label: 'YouTube',     hint: 'Gratuit · l\'écran doit rester allumé',
             capabilities: { fullTracks: true,  lockScreen: false, needsVisiblePlayer: true,  needsSubscription: null } },
};

/** Base minimale : gestion des événements + resolve() commun via /api/resolve. */
export class BasePlayerEngine {
  constructor(id, opts = {}) {
    this.id           = id;
    this.capabilities = PROVIDERS[id]?.capabilities || {};
    this._handlers    = {};
    this._getToken    = opts.getToken || (() => null);   // JWT Supabase pour /api/resolve
    this.onLog        = opts.onLog   || (() => {});
    this.raw          = null;
  }
  on(event, cb) { (this._handlers[event] ||= []).push(cb); return this; }
  _emit(event, payload) { for (const cb of this._handlers[event] || []) { try { cb(payload); } catch (e) { this.onLog(`handler ${event}: ${e.message}`, 'error'); } } }

  /** Résolution serveur : id provider pour un titre AhOuai ({ trackId }). */
  async resolve(track) {
    if (!track?.trackId) return null;
    const token = this._getToken();
    try {
      const r = await fetch(`/api/resolve?provider=${this.id}&trackId=${encodeURIComponent(track.trackId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!r.ok) { this.onLog(`resolve ${this.id} HTTP ${r.status}`, 'warn'); return null; }
      const j = await r.json();
      return j.providerId || null;
    } catch (e) {
      this.onLog(`resolve ${this.id} erreur : ${e.message}`, 'warn');
      return null;
    }
  }

  // À implémenter par chaque moteur
  async connect(_opts = {}) { throw new Error(`${this.id}: connect() non implémenté`); }
  isReady()               { return false; }
  notReadyReason()        { return `${PROVIDERS[this.id]?.label || this.id} non disponible`; }
  async play()            { return false; }
  async queueNext()       { return false; }
  async pause()           {}
  async resume()          {}
  async next()            {}
  getState()              { return { providerId: null, positionMs: 0, durationMs: 0, isPlaying: false, title: null, artist: null, artworkUrl: null }; }
  dispose()               {}
}

/** Moteur pas encore livré (Apple = Lot 2, YouTube = Lot 3) : jamais prêt, raison explicite. */
export class NotYetAvailableEngine extends BasePlayerEngine {
  async connect()  { return { ok: false, reason: this.notReadyReason() }; }
  notReadyReason() { return `${PROVIDERS[this.id]?.label || this.id} arrive dans quelques jours`; }
}

/**
 * Fabrique : charge le module du moteur à la demande (import dynamique) pour ne
 * pas embarquer les trois SDK. Retourne toujours un engine (NotYetAvailable si absent).
 */
export async function createEngine(id, opts = {}) {
  try {
    if (id === 'spotify') {
      const { default: SpotifyEngine } = await import('/shared/spotify-engine.js');
      return new SpotifyEngine(opts);
    }
    if (id === 'apple') {
      const mod = await import('/shared/apple-engine.js').catch(() => null);
      if (mod?.default) return new mod.default(opts);
    }
    if (id === 'youtube') {
      const mod = await import('/shared/youtube-engine.js').catch(() => null);
      if (mod?.default) return new mod.default(opts);
    }
  } catch (e) {
    opts.onLog?.(`createEngine(${id}) : ${e.message}`, 'error');
  }
  return new NotYetAvailableEngine(id, opts);
}
