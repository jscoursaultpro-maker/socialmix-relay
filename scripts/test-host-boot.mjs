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
const docMock = {
  cookie: '',
  getElementById: () => null,
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
const fetchMock = () => Promise.resolve({
  ok: false, status: 503, json: () => Promise.resolve({}), headers: { get: () => null }
});
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

// ── Exécution dans vm ─────────────────────────────────────────────────────────
let tdzError = null;
let bootLineReached = false;

process.on('unhandledRejection', () => {}); // ignorer fetch/socket rejects

const origLog   = console.log.bind(console);
const origError = console.error.bind(console);

const ctx = vm.createContext({
  window: winMock, document: docMock, navigator: navStub,
  sessionStorage: ssMock, localStorage: lsMock,
  fetch: fetchMock, io: ioMock, SpotifyService: SpotifyServiceStub,
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

// Attendre les promises du boot
await new Promise(r => setTimeout(r, 400));

origLog('');
origLog('=== RÉSULTAT TEST BOOT ===');
origLog(`TDZ ReferenceError : ${tdzError ? '❌ ' + tdzError.message.slice(0, 70) : '✅ aucune'}`);
origLog(`"Boot host.js" logué : ${bootLineReached ? '✅' : '(stub console intercept — pas de TDZ)'}`);
origLog(!tdzError ? '✅ TEST PASS' : '❌ TEST FAIL');
process.exit(tdzError ? 1 : 0);
