#!/usr/bin/env node
/**
 * Garde statique — Task #67 (host-identity claim).
 * Doctrine 3.11 : AUCUN token/jeton forgé, aucune connexion. On lit le source et on
 * assert la présence des garde-fous anti-régression du bundle host-identity :
 *   1. Handler serveur host:claim présent.
 *   2. host:claim exempté de validateHostSecret dans l'intercepteur host:*.
 *   3. Durcissement intercepteur : hostSocketId (re)posé après validation du secret.
 *   4. participants:update émis AUSSI à la room host:${...} (parité roster) ≥ 6 sites.
 *   5. host-engine.js : fonction claim(), emit 'host:claim', export claim.
 *   6. host-cockpit.js : appel e.claim() + rollback optimiste sur ack.ok === false.
 * Exit 0 si tout est présent, 1 sinon.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const server = read('server.js');
const engine = read('public/shared/ui/host-engine.js');
const cockpit = read('public/shared/ui/host-cockpit.js');

const checks = [];
const assert = (label, ok) => checks.push({ label, ok: !!ok });

// 1. Handler host:claim
assert("server.js — socket.on('host:claim')", /socket\.on\(\s*['"]host:claim['"]/.test(server));

// 2. host:claim dans la liste d'exemption de l'intercepteur
const exemptMatch = server.match(/\[\s*'host:startParty'[^\]]*\]\.includes\(event\)/s);
assert("server.js — host:claim exempté dans l'intercepteur host:*",
  !!exemptMatch && /'host:claim'/.test(exemptMatch[0]));

// 3. Durcissement intercepteur : hostSocketId (re)posé après validateHostSecret
assert("server.js — intercepteur (re)pose hostSocketId après validateHostSecret",
  /if\s*\(!validateHostSecret\(socket, payload\)\) return;[\s\S]{0,800}?hostSocketId = socket\.id/.test(server));

// 4. participants:update à la room host (parité roster) — au moins 6 sites
const hostParticipantsUpdate = (server.match(/io\.to\(`host:\$\{[^}]+\}`\)\.emit\(\s*['"]participants:update['"]/g) || []).length;
assert(`server.js — participants:update → room host sur ≥6 sites (trouvés: ${hostParticipantsUpdate})`,
  hostParticipantsUpdate >= 6);

// 5. host-engine.js — claim()
assert('host-engine.js — function claim(', /function\s+claim\s*\(/.test(engine));
assert("host-engine.js — emit 'host:claim'", /emit\(\s*['"]host:claim['"]/.test(engine));
assert('host-engine.js — export claim', /claim:\s*claim/.test(engine));

// 6. host-cockpit.js — appel claim + rollback optimiste
assert('host-cockpit.js — appel e.claim()', /e\.claim\s*\(\s*\)/.test(cockpit));
assert('host-cockpit.js — rollback toggle sur ack.ok === false',
  /ack\.ok === false[\s\S]{0,80}?waitApproval = !next/.test(cockpit));

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? '✅' : '❌'} ${c.label}`);
  if (!c.ok) failed++;
}
if (failed) {
  console.error(`\n❌ t67 — ${failed}/${checks.length} assertion(s) en échec.`);
  process.exit(1);
}
console.log(`\n✅ t67 — ${checks.length}/${checks.length} assertions OK (host-identity claim présent).`);
process.exit(0);
