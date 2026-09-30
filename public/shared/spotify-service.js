/**
 * public/shared/spotify-service.js
 * ★ feat(host-web) — Service Spotify Web API partagé (spike → cockpit hôte)
 *
 * Capacités :
 *   - PKCE auth (redirect URI dynamique depuis window.location)
 *   - Refresh token automatique (60 s avant expiration)
 *   - GET /me (premium check)
 *   - GET /me/player/devices
 *   - Transfert initial PUT /me/player
 *   - play / queue / next / pause SANS device_id (comme iOS SpotifyService.swift L796,L844)
 *   - Validation IDs via GET /tracks?ids=…&market=from_token avant play/queue
 *   - Sonde économe : +1,5 s après action ; mi-piste ; fin-15 s puis fin-5 s
 *   - WakeLock
 *   - Gestion 429/Retry-After, 403 Restriction = no-op, 404 device → callback onNoDevice
 *   - AutoPlay detection : item.uri OU item.linked_from.uri ∉ nos URIs, seulement après 1er play
 *
 * DOCTRINE (extrait du spike/README.md) :
 *   - Ne jamais utiliser GET /me/player/queue comme preuve de transition (non fiable)
 *   - La transition est confirmée quand la sonde voit le titre attendu jouer
 *   - Ne pas passer device_id en query param (comme iOS, PKCE flow)
 *
 * Usage :
 *   import SpotifyService from '/shared/spotify-service.js';
 *   const svc = new SpotifyService({ clientId: '2c7bee...', onStateChange, onNoDevice, onAutoPlay });
 *   await svc.init();
 */

const SPOTIFY_BASE = 'https://api.spotify.com/v1';
const ACCOUNTS_BASE = 'https://accounts.spotify.com';

// qualityLevel → priority pour sorting
const QUALITY_ORDER = { platine: 4, complete: 3, partielle: 2, vide: 1 };

export default class SpotifyService {
  /**
   * @param {object} opts
   * @param {string} opts.clientId
   * @param {function} [opts.onStateChange]   — appelé après chaque sonde avec le state
   * @param {function} [opts.onNoDevice]      — appelé quand 404 device ou pas de lecture active
   * @param {function} [opts.onAutoPlay]      — appelé quand autoplay détecté
   * @param {function} [opts.onRelink]        — appelé quand track relinking détecté
   * @param {function} [opts.onLog]           — appelé avec (message, level) pour log UI
   */
  constructor(opts = {}) {
    this.clientId       = opts.clientId || '';
    this.onStateChange  = opts.onStateChange  || (() => {});
    this.onNoDevice     = opts.onNoDevice     || (() => {});
    this.onAutoPlay     = opts.onAutoPlay     || (() => {});
    this.onRelink       = opts.onRelink       || (() => {});
    this.onLog          = opts.onLog          || ((msg) => console.log('[SpotifyService]', msg));

    // Auth state
    this.accessToken    = null;
    this.refreshToken   = null;
    this.tokenExpiry    = 0;
    this.userId         = null;
    this.isPremium      = false;
    this.userFirstName  = null;

    // Device state
    this.devices        = [];
    this.activeDeviceId = null;   // le device "ciblé" (pas passé en query param)

    // Playback state
    this.queuedUris     = new Set();
    this.hasInteracted  = false;
    this.isPlaying      = false;
    this.currentItem    = null;
    this.nextExpectedUri = null;   // pour vérifier la transition

    // Probe timers
    this._probeTimers   = [];
    this._wakeLock      = null;
    this._apiCallCount  = 0;
    this._refreshTimer  = null;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  /**
   * Initialise : charge tokens depuis sessionStorage si présents.
   * @returns {Promise<boolean>} true si déjà authentifié
   */
  async init() {
    const stored = this._loadTokens();
    if (!stored) return false;
    // Vérifier que le token est encore valide (ou rafraîchissable)
    if (Date.now() > this.tokenExpiry - 60000) {
      const ok = await this._refreshAccessToken();
      if (!ok) { this._clearTokens(); return false; }
    }
    return true;
  }

  // ─── PKCE Auth ────────────────────────────────────────────────────────────

  get redirectUri() {
    const { protocol, host, pathname } = window.location;
    // Redirect URI = URL courante sans les query params (pour PKCE callback)
    return `${protocol}//${host}${pathname}`;
  }

  async startPKCE() {
    const scopes = [
      'user-read-private', 'user-read-email',
      'user-modify-playback-state', 'user-read-playback-state',
      'streaming'
    ].join(' ');

    const verifier = this._randomString(64);
    const challenge = await this._pkceChallenge(verifier);
    sessionStorage.setItem('pkce_verifier', verifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     this.clientId,
      scope:         scopes,
      redirect_uri:  this.redirectUri,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state: 'host_auth'
    });
    window.location.href = `${ACCOUNTS_BASE}/authorize?${params}`;
  }

  async handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');
    const state  = params.get('state');
    const error  = params.get('error');

    if (error) throw new Error(`Spotify auth error: ${error}`);
    if (!code || state !== 'host_auth') return false;

    const verifier = sessionStorage.getItem('pkce_verifier');
    if (!verifier) throw new Error('PKCE verifier manquant');

    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  this.redirectUri,
      client_id:     this.clientId,
      code_verifier: verifier
    });

    const res = await fetch(`${ACCOUNTS_BASE}/api/token`, { method: 'POST', body });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
    const data = await res.json();

    this._setTokens(data);
    sessionStorage.removeItem('pkce_verifier');

    // Nettoyer l'URL (enlever code + state)
    window.history.replaceState({}, '', window.location.pathname);
    return true;
  }

  async fetchMe() {
    const data = await this._api('GET', '/me');
    if (!data) return null;
    this.isPremium    = data.product === 'premium';
    this.userId       = data.id;
    this.userFirstName = data.display_name?.split(' ')[0] || data.id;
    return { isPremium: this.isPremium, firstName: this.userFirstName, id: this.userId };
  }

  // ─── Devices ──────────────────────────────────────────────────────────────

  async fetchDevices() {
    const data = await this._api('GET', '/me/player/devices');
    this.devices = data?.devices || [];
    return this.devices;
  }

  /**
   * Transfert initial vers un device (comme iOS L611 PUT /me/player {device_ids, play:false})
   * @param {string} deviceId
   */
  async transferToDevice(deviceId) {
    const res = await this._api('PUT', '/me/player', { device_ids: [deviceId], play: false });
    if (res === null) {
      // 403 = appareil indisponible (fantôme) ou 404 = device inconnu
      // _api a déjà appelé onNoDevice() pour 404 ; pour 403, on le fait ici
      this._log('TRANSFERT échoué (403/404) — appareil fantôme → screen-device', 'warn');
      this.onNoDevice();
      return false;
    }
    this.activeDeviceId = deviceId;
    this._log(`TRANSFERT → device ${deviceId}`);
    await new Promise(r => setTimeout(r, 1000)); // iOS attend 1s
    return true;
  }

  /**
   * ensureActiveDevice : GET devices → si aucun actif, transfert vers le premier
   * @returns {string|null} deviceId actif, ou null si aucun
   */
  async ensureActiveDevice() {
    const devices = await this.fetchDevices();
    const active  = devices.find(d => d.is_active);
    if (active) {
      this.activeDeviceId = active.id;
      this._log(`Device actif : ${active.name}`, 'ok');
      return active.id;
    }
    if (devices.length > 0) {
      // 2. Tenter le transfert — si 403 (fantôme), retourner null
      const ok = await this.transferToDevice(devices[0].id);
      if (!ok) return null;
      return devices[0].id;
    }
    this._log('Aucun device Spotify disponible', 'warn');
    this.onNoDevice();
    return null;
  }

  // ─── Playback ─────────────────────────────────────────────────────────────

  /**
   * Play une ou plusieurs URIs.
   * Valide les IDs avant d'envoyer.
   * @param {string|string[]} uris
   * @param {number} [positionMs=0]
   */
  async play(uris, positionMs = 0) {
    const uriArray = Array.isArray(uris) ? uris : [uris];
    const valid    = await this._validateUris(uriArray);
    if (!valid.length) { this._log('Aucun URI valide', 'error'); return false; }

    valid.forEach(u => this.queuedUris.add(u));
    this.hasInteracted = true;

    const body = { uris: valid };
    if (positionMs > 0) body.position_ms = positionMs;
    if (valid.length > 1) body.offset = { position: 0 };

    // Comme iOS : PAS de device_id en query param (L796 SpotifyService.swift)
    const res = await this._api('PUT', '/me/player/play', body);
    if (res !== null) {
      this._log(`▶ PLAY [${valid.map(u => u.split(':').pop()).join(', ')}]`, 'ok');
      await this._requestWakeLock();
      this._scheduleProbe(1500);
      return true;
    }
    return false;
  }

  /**
   * Queue un URI (comme iOS L844 POST /me/player/queue — PAS de device_id).
   * @param {string} uri
   */
  async queue(uri) {
    const valid = await this._validateUris([uri]);
    if (!valid.length) { this._log(`URI invalide : ${uri}`, 'error'); return false; }

    this.queuedUris.add(valid[0]);
    this.nextExpectedUri = valid[0];
    const res = await this._api('POST', `/me/player/queue?uri=${encodeURIComponent(valid[0])}`);
    if (res !== null) {
      this._log(`📋 QUEUE ${valid[0].split(':').pop()}`, 'ok');
      return true;
    }
    return false;
  }

  async next() {
    const res = await this._api('POST', '/me/player/next');
    if (res !== null) {
      this._log('⏭ NEXT', 'ok');
      this._scheduleProbe(1500);
    }
    return res !== null;
  }

  async pause() {
    const res = await this._api('PUT', '/me/player/pause');
    if (res !== null) {
      this._log('⏸ PAUSE', 'ok');
      this.isPlaying = false;
    }
  }

  async resume() {
    const res = await this._api('PUT', '/me/player/play');
    if (res !== null) {
      this._log('▶ RESUME', 'ok');
      this._scheduleProbe(1500);
    }
  }

  // ─── Track validation ─────────────────────────────────────────────────────

  /**
   * Valide les URIs via GET /tracks — élimine les IDs inexistants/non jouables.
   * Doctrine : ne jamais envoyer un ID non validé à Spotify (accepte en silence).
   */
  async _validateUris(uris) {
    const ids = uris.map(u => u.split(':').pop()).join(',');
    const data = await this._api('GET', `/tracks?ids=${ids}&market=from_token`);
    if (!data?.tracks) return uris; // si validation échoue, laisser passer (non-bloquant)
    const valid = [];
    data.tracks.forEach((t, i) => {
      if (t && t.is_playable !== false) {
        valid.push(uris[i]);
      } else {
        this._log(`URI écarté (inexistant/non jouable) : ${uris[i]}`, 'warn');
      }
    });
    return valid;
  }

  // ─── Smart Probing ────────────────────────────────────────────────────────

  _clearProbes() {
    this._probeTimers.forEach(t => clearTimeout(t));
    this._probeTimers = [];
  }

  _probeCounter = 0; // compteur global d'armements (unicité)
  _scheduleProbe(delayMs) {
    this._probeCounter++;
    const n = this._probeCounter;
    const t = setTimeout(() => {
      this._log(`🔍 sonde armée #${n} (+${delayMs}ms)`, 'info');
      this._probe();
    }, delayMs);
    this._probeTimers.push(t);
  }

  async _probe() {
    const data = await this._api('GET', '/me/player');

    if (!data || !data.item) {
      if (data === null) {
        this._log('ℹ️ Pas de lecture active', 'warn');
        this.onNoDevice();
      }
      this.onStateChange(null);
      return;
    }

    const item      = data.item;
    const progress  = data.progress_ms || 0;
    const duration  = item.duration_ms || 1;

    this.isPlaying  = data.is_playing;
    this.currentItem = item;

    // Log enrichi
    this._log(
      `🔍 SONDE : ${data.is_playing ? '▶' : '⏸'} "${item.name}" ` +
      `${this._ms2time(progress)}/${this._ms2time(duration)} ` +
      `ctx=${data.context?.uri || 'null'} repeat=${data.repeat_state}`,
      'info'
    );

    // AutoPlay detection (relink-aware)
    const linkedFromUri = item.linked_from?.uri || null;
    const isOurs = this.queuedUris.has(item.uri) ||
      (linkedFromUri && this.queuedUris.has(linkedFromUri));

    if (linkedFromUri && this.queuedUris.has(linkedFromUri) && !this.queuedUris.has(item.uri)) {
      this.queuedUris.add(item.uri);
      this._log(`🔗 RELINK : demandé ${linkedFromUri} → joué ${item.uri}`, 'info');
      this.onRelink({ requested: linkedFromUri, played: item.uri, name: item.name });
    }

    if (!isOurs && this.hasInteracted) {
      this._log(`⚡ AUTOPLAY détecté : ${item.name} (${item.uri})`, 'warn');
      this.onAutoPlay({ name: item.name, uri: item.uri });
    }

    // Transition détectée ?
    if (this.nextExpectedUri && item.uri === this.nextExpectedUri) {
      this._log(`✅ TRANSITION confirmée : ${item.name}`, 'ok');
      this.nextExpectedUri = null;
    }

    // Callback state
    this.onStateChange({
      isPlaying:   data.is_playing,
      item,
      progress,
      duration,
      device:      data.device,
      context:     data.context,
      repeatState: data.repeat_state,
      shuffleState: data.shuffle_state
    });

    // Planifier prochaines sondes
    this._clearProbes();
    if (!data.is_playing) return;

    const remaining = duration - progress;
    const half      = duration / 2 - progress;

    // Mi-piste
    if (half > 2000) this._scheduleProbe(half);

    // T-15s
    if (remaining > 17000) this._scheduleProbe(remaining - 15000);

    // T-5s (earlyTransitionThreshold comme iOS L76)
    if (remaining > 6000) this._scheduleProbe(remaining - 5000);

    // T+1s (confirmation après fin probable)
    this._scheduleProbe(remaining + 1000);
  }

  // ─── WakeLock ─────────────────────────────────────────────────────────────

  async _requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._log('WakeLock: screen actif', 'info');
      } catch (_) { /* non-fatal */ }
    }
  }

  releaseWakeLock() {
    this._wakeLock?.release().catch(() => {});
    this._wakeLock = null;
  }

  // ─── HTTP API ─────────────────────────────────────────────────────────────

  /**
   * Appel API Spotify avec gestion 401/429/403/404.
   * @returns {object|null} data (null = erreur 4xx gérée)
   */
  async _api(method, endpoint, body = null) {
    await this._ensureToken();
    if (!this.accessToken) { this._log('Pas de token', 'error'); return null; }

    this._apiCallCount++;

    const opts = {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}` }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    const url = endpoint.startsWith('http') ? endpoint : `${SPOTIFY_BASE}${endpoint}`;

    let res;
    try {
      res = await fetch(url, opts);
    } catch (netErr) {
      // 3. "Load failed" = Safari suspend l'onglet (bascule app).
      // NE PAS relancer — tous les appelants attendent null en cas d'échec.
      // Poster lastNetworkError pour que _withBusy le lise et pose pendingCmd.
      const isAppSuspend = netErr instanceof TypeError &&
        /load failed|network|fetch/i.test(netErr.message);
      this.lastNetworkError = { at: Date.now(), suspended: isAppSuspend };
      if (isAppSuspend) {
        this._log(`Réseau suspendu (bascule app) : ${netErr.message}`, 'info');
      } else {
        this._log(`Erreur réseau : ${netErr.message}`, 'error');
      }
      return null;
    }

    // 204 = succès sans body
    if (res.status === 204) return {};

    // 429 Rate limit
    if (res.status === 429) {
      const retry = parseInt(res.headers.get('Retry-After') || '2');
      this._log(`429 Rate limit — retry dans ${retry}s`, 'warn');
      await new Promise(r => setTimeout(r, retry * 1000));
      return this._api(method, endpoint, body);
    }

    // 401 → refresh et retry
    if (res.status === 401) {
      const ok = await this._refreshAccessToken();
      if (ok) return this._api(method, endpoint, body);
      this._log('401 non récupérable — reconnexion requise', 'error');
      this._clearTokens();
      return null;
    }

    // 403 Restriction violated → no-op (comme doc Spotify)
    if (res.status === 403) {
      this._log('403 Restriction — no-op', 'warn');
      return null;
    }

    // 404 → no device
    if (res.status === 404) {
      this._log('404 Device introuvable — ouvre Spotify', 'warn');
      this.onNoDevice();
      return null;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this._log(`HTTP ${res.status} : ${txt.slice(0, 100)}`, 'error');
      return null;
    }

    try {
      return await res.json();
    } catch (_) {
      return {};
    }
  }

  // ─── Token management ─────────────────────────────────────────────────────

  _setTokens(data) {
    this.accessToken  = data.access_token;
    this.refreshToken = data.refresh_token || this.refreshToken;
    this.tokenExpiry  = Date.now() + (data.expires_in || 3600) * 1000;
    sessionStorage.setItem('sp_access_token',  this.accessToken);
    sessionStorage.setItem('sp_refresh_token', this.refreshToken);
    sessionStorage.setItem('sp_token_expiry',  String(this.tokenExpiry));
    this._scheduleTokenRefresh();
  }

  _loadTokens() {
    this.accessToken  = sessionStorage.getItem('sp_access_token');
    this.refreshToken = sessionStorage.getItem('sp_refresh_token');
    this.tokenExpiry  = parseInt(sessionStorage.getItem('sp_token_expiry') || '0');
    return !!(this.accessToken && this.refreshToken);
  }

  _clearTokens() {
    this.accessToken = this.refreshToken = null;
    this.tokenExpiry = 0;
    ['sp_access_token', 'sp_refresh_token', 'sp_token_expiry', 'pkce_verifier'].forEach(k => sessionStorage.removeItem(k));
  }

  async _ensureToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) return;
    await this._refreshAccessToken();
  }

  async _refreshAccessToken() {
    if (!this.refreshToken) return false;
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: this.refreshToken,
      client_id:     this.clientId
    });
    try {
      const res  = await fetch(`${ACCOUNTS_BASE}/api/token`, { method: 'POST', body });
      if (!res.ok) return false;
      const data = await res.json();
      this._setTokens(data);
      return true;
    } catch (_) { return false; }
  }

  _scheduleTokenRefresh() {
    clearTimeout(this._refreshTimer);
    const delay = Math.max(0, this.tokenExpiry - Date.now() - 60000);
    this._refreshTimer = setTimeout(() => this._refreshAccessToken(), delay);
  }

  // ─── Utils ────────────────────────────────────────────────────────────────

  _ms2time(ms) {
    const s = Math.floor((ms || 0) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  _randomString(len) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr)).replace(/[^a-zA-Z0-9]/g, '').slice(0, len);
  }

  async _pkceChallenge(verifier) {
    const data    = new TextEncoder().encode(verifier);
    const digest  = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  _log(msg, level = 'info') {
    this.onLog(msg, level);
  }
}
