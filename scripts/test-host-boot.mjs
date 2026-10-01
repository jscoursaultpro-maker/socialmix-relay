/**
 * scripts/test-host-boot.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Test d'exécution du boot host.js — stubs minimaux (vm.createContext).
 * Détecte les TDZ ReferenceError que node --check ne peut pas voir.
 *
 * Usage : node scripts/test-host-boot.mjs
 *         npm run test:host-boot
 *
 * Exit 0 = aucune TDZ. Exit 1 = TDZ détectée.
 *
 * RÈGLE : toute variable let/const utilisée au boot (IIFE ~L66 de host.js)
 * doit être déclarée AVANT le boot. node --check ne détecte pas la TDZ ;
 * seul un run le fait. Ce script constitue le filet de sécurité.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { TextDecoder, TextEncoder } = require('util');
const vm   = require('vm');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const hostJsPath = path.join(__dirname, '..', 'public', 'host', 'host.js');

// ── Stubs ─────────────────────────────────────────────────────────────────────
const atobFn = (b64) => Buffer.from(b64, 'base64').toString('binary');
const btoa_fn = (bin) => Buffer.from(bin, 'binary').toString('base64');
const navStub = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };

const _ssStore = {};
const ssMock = {
  getItem: k => _ssStore[k] ?? null,
  setItem: (k, v) => { _ssStore[k] = String(v); },
  removeItem: k => { delete _ssStore[k]; }
};
const _lsStore = {};
const lsMock = {
  getItem: k => _lsStore[k] ?? null,
  setItem: (k, v) => { _lsStore[k] = String(v); },
  removeItem: k => { delete _lsStore[k]; }
};
const _els = {};
const _mkEl = (id) => ({
  id, tagName: 'DIV', className: '', textContent: '', innerHTML: '', style: {}, dataset: {}, value: '', src: '', disabled: false,
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle() {}, contains(c) { return this._s.has(c); } },
  appendChild: () => {}, addEventListener: () => {}, getAttribute: () => null, setAttribute: () => {}, prepend: () => {}
});
const docMock = {
  cookie: '',
  // ★ Lot 1 : éléments factices (sinon le boot plante à dateInput.value et le flux SSO n'est jamais exercé)
  getElementById: (id) => (_els[id] ||= _mkEl(id)),
  addEventListener: () => {},
  querySelectorAll: () => ({ forEach: () => {} }),
  querySelector: () => null,
  createElement: () => ({
    tagName: 'DIV', id: '', className: '', textContent: '', innerHTML: '',
    style: {}, dataset: {}, value: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    appendChild: () => {}, addEventListener: () => {},
    getAttribute: () => null, setAttribute: () => {}, prepend: () => {}
  }),
  body: { appendChild: () => {} }
};
const winMock = {
  location: { origin: 'https://join.ahouai.com', hostname: 'join.ahouai.com',
               href: 'https://join.ahouai.com/host/', search: '', pathname: '/host/' },
  URLSearchParams, SupabaseCookie: null
};
// ★ Lot 1 : simule /api/config/supabase (activé), /api/me (user sans lecteur mémorisé), settings PATCH
const fetchCalls = [];
const fetchMock = (url, opts = {}) => {
  fetchCalls.push({ url: String(url), method: opts.method || 'GET' });
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), headers: { get: () => null } });
  if (String(url).startsWith('/api/config/supabase')) return ok({ enabled: true, url: 'https://stub.supabase.co', anonKey: 'anon' });
  if (String(url).startsWith('/api/me'))              return ok({ _id: 'u1', email: 'h@test', profile: { firstName: 'Hôte' }, settings: { preferredProvider: process.env.TEST_PREFERRED || null } });
  if (String(url).startsWith('/api/user/me/settings')) return ok({});
  return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}), headers: { get: () => null } });
};
// Client Supabase factice : une session présente dès le boot
const supabaseMock = { createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: { access_token: 'jwt', user: { id: 'sb1', email: 'h@test' } } } }),
  onAuthStateChange: () => {}, signOut: async () => {}, signInWithOAuth: async () => ({})
} }) };
let createEngineCalls = 0;
const ioMock = () => ({
  connected: false, id: 'stub-socket',
  on: () => {}, emit: () => {}, disconnect: () => {}
});
const SpotifyServiceStub = function () {
  this.isPremium = false; this.devices = []; this.userId = null;
  this.fetchDevices = async () => []; this.fetchMe = async () => null;
  this.startPKCE = async () => {}; this.handleCallback = async () => ({});
  this.play = async () => false; this.queue = async () => false;
  this.next = async () => {}; this.transferToDevice = async () => {};
  this.getPlaybackState = async () => null;
  this.onStateChange = () => {}; this.disconnect = () => {};
};

// ── Charger host.js, retirer l'import ES ─────────────────────────────────────
let src = fs.readFileSync(hostJsPath, 'utf8');
src = src.replace("import SpotifyService from '/shared/spotify-service.js';", '');
// ★ Lot 1 : host.js importe le contrat engine (stubs ci-dessous : createEngine, PROVIDERS)
src = src.replace("import { createEngine, PROVIDERS } from '/shared/player-engine.js';", '');

// ── Exécution dans vm ─────────────────────────────────────────────────────────
let tdzError = null;
let bootLineReached = false;

process.on('unhandledRejection', () => {}); // ignorer fetch/socket rejects

const origLog   = console.log.bind(console);
const origError = console.error.bind(console);

const ctx = vm.createContext({
  window: { ...winMock, supabase: supabaseMock, SupabaseCookie: { makeStorage: () => ssMock }, HOST: null },
  location: winMock.location, history: { replaceState: () => {} }, document: docMock, navigator: navStub,
  sessionStorage: ssMock, localStorage: lsMock,
  fetch: fetchMock, io: ioMock, SpotifyService: SpotifyServiceStub,
  // ★ Lot 1 : stubs du contrat engine
  PROVIDERS: { spotify: { label: 'Spotify', hint: '' }, apple: { label: 'Apple Music', hint: '' }, youtube: { label: 'YouTube', hint: '' } },
  createEngine: async (id) => ({
    id, capabilities: {}, raw: new SpotifyServiceStub(), _c: ++createEngineCalls,
    on() { return this; }, connect: async () => ({ ok: false, needsAuth: true }),
    isReady: () => false, notReadyReason: () => 'stub', resolve: async () => null,
    play: async () => false, queueNext: async () => false, pause: async () => {}, resume: async () => {},
    next: async () => {}, getState: () => ({}), dispose() {}
  }),
  console: {
    log: (...args) => {
      const s = String(args[0] || '');
      if (s.includes('Boot host.js')) bootLineReached = true;
    },
    warn: () => {}, error: () => {}, dir: () => {}
  },
  Promise, setTimeout, clearTimeout, setInterval, clearInterval,
  URL, URLSearchParams, encodeURIComponent, decodeURIComponent,
  JSON, Math, Date, Array, Object, String, Boolean, Number, Error,
  parseInt, parseFloat, isNaN, isFinite,
  Map, Set, WeakMap, RegExp, Uint8Array,
  TextDecoder, TextEncoder,
  atob: atobFn, btoa: btoa_fn
});

try {
  new vm.Script(src, { filename: 'host.js' }).runInContext(ctx);
} catch (e) {
  if (e && e.message && /before initialization/.test(e.message)) {
    tdzError = e;
    origError('❌ TDZ ReferenceError:', e.message);
    origError('   at:', e.stack.split('\n').slice(1, 3).join('\n'));
  }
  // Autres erreurs (stubs incomplets) = non-TDZ → ignorer
}

// Attendre les promises du boot (SSO simulé → _afterSSO → écran provider ou createEngine)
await new Promise(r => setTimeout(r, 900));

// ★ Lot 1 : assertions de flux (session présente dès le boot + poll 200ms → une seule init)
const meCalls = fetchCalls.filter(c => c.url.startsWith('/api/me')).length;
const flowErrors = [];
if (meCalls !== 1) flowErrors.push(`/api/me appelé ${meCalls}× (attendu 1 — double _onSupabaseSession ?)`);
if (createEngineCalls > 1) flowErrors.push(`createEngine appelé ${createEngineCalls}× (attendu ≤ 1)`);
const expectProvider = process.env.TEST_PREFERRED || null;
if (!expectProvider && createEngineCalls !== 0) flowErrors.push('sans lecteur mémorisé, createEngine ne doit pas être appelé (écran provider attendu)');
if (expectProvider && createEngineCalls !== 1) flowErrors.push(`lecteur mémorisé ${expectProvider} : createEngine attendu 1×, obtenu ${createEngineCalls}`);
const providerScreenActive = _els['screen-provider']?.classList.contains('active') === true;
if (!expectProvider && !providerScreenActive) flowErrors.push('écran screen-provider non activé sans lecteur mémorisé');

origLog('');
origLog('=== RÉSULTAT TEST BOOT ===');
origLog(`TDZ ReferenceError : ${tdzError ? '❌ ' + tdzError.message.slice(0, 70) : '✅ aucune'}`);
origLog(`"Boot host.js" logué : ${bootLineReached ? '✅' : '(stub console intercept — pas de TDZ)'}`);
origLog(`Flux SSO (préféré=${expectProvider || 'aucun'}) : /api/me ×${meCalls}, createEngine ×${createEngineCalls}, screen-provider actif=${providerScreenActive}`);
if (flowErrors.length) flowErrors.forEach(e => origError('❌ ' + e));
const fail = !!tdzError || flowErrors.length > 0;
origLog(!fail ? '✅ TEST PASS' : '❌ TEST FAIL');
process.exit(fail ? 1 : 0);
