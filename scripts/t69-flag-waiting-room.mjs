#!/usr/bin/env node
/**
 * Garde statique — Task #69 (feature flag « Salle d'attente », source unique serveur).
 * Étend la couverture de t67. Doctrine 3.11 : aucune connexion, aucun token forgé — on lit
 * le source et on assert que le flag global waitingRoom est bien défini ET consulté à TOUS
 * les points de contrôle requiresApproval (exposition, gate requestJoin, toggle), plus l'UI admin
 * et les garde-fous clients.
 * Exit 0 si tout est présent, 1 sinon.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const server = read('server.js');
const admin = read('admin/feature-flags.html');
const cockpit = read('public/shared/ui/host-cockpit.js');
const app = read('public/app.js');

const checks = [];
const assert = (label, ok) => checks.push({ label, ok: !!ok });

// 1. Admin UI — entrée Salle d'attente (id waitingRoom + libellé)
assert("admin/feature-flags.html — entrée waitingRoom « Salle d'attente »",
  /id:\s*'waitingRoom'/.test(admin) && /Salle d\\?'attente/.test(admin));

// 2. Serveur — flag déclaré dans DEFAULT_FEATURE_FLAGS, défaut false
assert('server.js — waitingRoom dans DEFAULT_FEATURE_FLAGS (défaut false)',
  /DEFAULT_FEATURE_FLAGS\s*=\s*\{[\s\S]*?waitingRoom:\s*false[\s\S]*?\};/.test(server));

// 3. Serveur — helper featureEnabled (vérif stricte === true)
assert('server.js — helper featureEnabled(name) strict',
  /function\s+featureEnabled\s*\(name\)\s*\{[\s\S]{0,160}?===\s*true/.test(server));

// 4. Exposition buildLightState gatée par le flag
assert('server.js — requiresApproval exposé gaté par featureEnabled(\'waitingRoom\')',
  /requiresApproval:\s*featureEnabled\(\s*'waitingRoom'\s*\)\s*&&/.test(server));

// 5. buildLightState expose waitingRoomEnabled (pilote le client)
assert('server.js — waitingRoomEnabled exposé dans buildLightState',
  /waitingRoomEnabled:\s*featureEnabled\(\s*'waitingRoom'\s*\)/.test(server));

// 6. Gate requestJoin gaté par le flag
assert('server.js — gate requestJoin : const requiresApproval = featureEnabled(\'waitingRoom\') &&',
  /const requiresApproval = featureEnabled\(\s*'waitingRoom'\s*\)\s*&&/.test(server));

// 7. host:setApprovalMode refuse si flag OFF (FEATURE_DISABLED)
assert('server.js — host:setApprovalMode refuse (FEATURE_DISABLED) si flag OFF',
  /if\s*\(!featureEnabled\(\s*'waitingRoom'\s*\)\)[\s\S]{0,220}?FEATURE_DISABLED/.test(server));

// 8. host-cockpit.js — carte masquée + toggle inerte si flag OFF
assert('host-cockpit.js — carte masquée si flag OFF (!featureOn → display none)',
  /if\s*\(!featureOn\)\s*\{\s*card\.style\.display\s*=\s*'none';\s*return;/.test(cockpit));
assert('host-cockpit.js — toggle inerte si flag OFF',
  /addEventListener\('click',[\s\S]{0,120}?if\s*\(!featureOn\)\s*return;/.test(cockpit));

// 9. app.js — safety belt guest : showWaitingRoom ignoré si flag OFF
assert('app.js — showWaitingRoom ignoré si _waitingRoomEnabled === false',
  /_waitingRoomEnabled === false[\s\S]{0,80}?return;/.test(app));

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? '✅' : '❌'} ${c.label}`);
  if (!c.ok) failed++;
}
if (failed) {
  console.error(`\n❌ t69 — ${failed}/${checks.length} assertion(s) en échec.`);
  process.exit(1);
}
console.log(`\n✅ t69 — ${checks.length}/${checks.length} assertions OK (flag waitingRoom source unique serveur, lu partout).`);
process.exit(0);
