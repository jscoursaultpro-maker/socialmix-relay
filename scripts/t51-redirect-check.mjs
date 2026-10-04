/**
 * Banc de test du middleware Task #51 — lit le bloc DIRECTEMENT dans server.js
 * et l'évalue, pour qu'aucune divergence entre le code testé et le code livré
 * ne soit possible. Le serveur complet ne peut pas démarrer ici (MongoDB requis,
 * et mongodb-memory-server ne peut pas télécharger son binaire : fastdl.mongodb.org
 * est hors allowlist du conteneur).
 */
import express from 'express';
import http from 'http';
import { readFileSync } from 'fs';

const src = readFileSync('/home/claude/socialmix-relay/server.js', 'utf8');

// Extraction du bloc réel : de la constante bots jusqu'au redirect legacy exclu.
const start = src.indexOf('// ─── Bots sociaux — source unique');
const end   = src.indexOf('// ─── Legacy QR redirect');
if (start < 0 || end < 0 || end <= start) {
  console.error('❌ Impossible de localiser le bloc Task #51 dans server.js');
  process.exit(1);
}
const block = src.slice(start, end);
console.log(`Bloc extrait de server.js : ${block.split('\n').length} lignes\n`);

const app = express();
// eslint-disable-next-line no-new-func
new Function('app', block)(app);

// Sentinelle : tout ce qui n'est PAS redirigé doit atterrir ici.
app.use((req, res) => res.status(200).send('PASSTHROUGH'));

const server = app.listen(10078, async () => {
  let pass = 0, fail = 0;

  const t = async (nom, { path, host = 'socialmix-relay.onrender.com', method = 'GET', headers = {} }, attendu) => {
    // ATTENTION : fetch/undici INTERDIT de surcharger l'en-tête Host (il le
    // réécrit vers l'adresse réelle). Un banc basé sur fetch ne teste donc
    // JAMAIS la détection d'hôte : tout passe en PASSTHROUGH et les tests
    // négatifs réussissent trivialement. http.request, lui, laisse poser Host.
    const hdrs = { host, accept: 'text/html,application/xhtml+xml', 'sec-fetch-mode': 'navigate', ...headers };
    for (const k of Object.keys(hdrs)) if (hdrs[k] === '') delete hdrs[k];

    const res = await new Promise((resolve, reject) => {
      const rq = http.request(
        { host: '127.0.0.1', port: 10078, path, method, headers: hdrs },
        r => { r.resume(); r.on('end', () => resolve({ status: r.statusCode, location: r.headers.location })); }
      );
      rq.on('error', reject);
      rq.end();
    });

    const obtenu = res.status === 302 ? `302 → ${res.location}` : `${res.status} PASSTHROUGH`;
    const ok = obtenu === attendu;
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${nom}`);
    if (!ok) console.log(`     attendu : ${attendu}\n     obtenu  : ${obtenu}`);
  };

  console.log('── Ce qui DOIT être redirigé (navigations de document) ──');
  await t('QR scanné : /?code=FTMP63',
    { path: '/?code=FTMP63' },
    '302 → https://join.ahouai.com/?code=FTMP63');
  await t('Query multiple préservée (code + sb + state)',
    { path: '/?code=FTMP63&sb=1&state=host_auth' },
    '302 → https://join.ahouai.com/?code=FTMP63&sb=1&state=host_auth');
  await t('sbauth dans la query préservé intact',
    { path: '/?code=X&sb=1&sbauth=eyJ1c2VySWQiOiJhYmMifQ%3D%3D' },
    '302 → https://join.ahouai.com/?code=X&sb=1&sbauth=eyJ1c2VySWQiOiJhYmMifQ%3D%3D');
  await t('Racine nue',
    { path: '/' },
    '302 → https://join.ahouai.com/');
  await t('Navigation détectée par Accept seul (pas de Sec-Fetch-Mode)',
    { path: '/?code=ABC', headers: { 'sec-fetch-mode': '' } },
    '302 → https://join.ahouai.com/?code=ABC');

  console.log('\n── Ce qui NE doit PAS être redirigé ──');
  await t('XHR /api/me avec query (preflight suivrait sinon)',
    { path: '/api/me/suggestions/past?limit=12&excludeCode=FTMP63', headers: { accept: 'application/json', 'sec-fetch-mode': 'cors' } },
    '200 PASSTHROUGH');
  await t('Preflight CORS OPTIONS sur /api',
    { path: '/api/party/FTMP63/suggest', method: 'OPTIONS', headers: { accept: '*/*', 'sec-fetch-mode': 'cors' } },
    '200 PASSTHROUGH');
  await t('POST /api (écriture)',
    { path: '/api/party/FTMP63/suggest', method: 'POST', headers: { accept: '*/*', 'sec-fetch-mode': 'cors' } },
    '200 PASSTHROUGH');
  await t('Transport Socket.IO',
    { path: '/socket.io/?EIO=4&transport=polling', headers: { accept: '*/*', 'sec-fetch-mode': 'cors' } },
    '200 PASSTHROUGH');
  await t('Bot WhatsApp (doit atteindre l\'OG SSR)',
    { path: '/?code=FTMP63', headers: { 'user-agent': 'WhatsApp/2.23' } },
    '200 PASSTHROUGH');
  await t('Bot iMessage',
    { path: '/?code=FTMP63', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) imessage-preview' } },
    '200 PASSTHROUGH');
  await t('Harnais de test node (UA node, non-navigation)',
    { path: '/api/party/NC94TX/public-info', headers: { accept: '*/*', 'user-agent': 'node', 'sec-fetch-mode': '' } },
    '200 PASSTHROUGH');
  await t('Health check Go-http-client sur /',
    { path: '/', headers: { accept: '*/*', 'user-agent': 'Go-http-client/2.0', 'sec-fetch-mode': '' } },
    '200 PASSTHROUGH');
  await t('/.well-known (Universal Links)',
    { path: '/.well-known/apple-app-site-association', headers: { accept: '*/*', 'sec-fetch-mode': '' } },
    '200 PASSTHROUGH');
  await t('/admin', { path: '/admin' }, '200 PASSTHROUGH');
  await t('/legal/cgu', { path: '/legal/cgu' }, '200 PASSTHROUGH');

  console.log('\n── Absence de boucle : autres hôtes intouchés ──');
  await t('join.ahouai.com (la cible) n\'est pas redirigé',
    { path: '/?code=FTMP63', host: 'join.ahouai.com' },
    '200 PASSTHROUGH');
  await t('api.ahouai.com intouché',
    { path: '/?code=FTMP63', host: 'api.ahouai.com' },
    '200 PASSTHROUGH');
  await t('admin.ahouai.com intouché',
    { path: '/', host: 'admin.ahouai.com' },
    '200 PASSTHROUGH');
  await t('localhost intouché (dev)',
    { path: '/?code=FTMP63', host: 'localhost:10077' },
    '200 PASSTHROUGH');

  console.log(`\n${'═'.repeat(52)}\n${pass} réussis · ${fail} échoués`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
});
