#!/usr/bin/env node
/**
 * Garde de régression — G3 (drag&drop file « À suivre » host web + parité).
 * Doctrine 3.11 (fix feature) : le vrai test est fonctionnel sur vrai iPhone (Jean-Sé).
 * Cette garde assure juste que la tuyauterie G3 reste en place (anti-régression) :
 *   - moteur : moveTo(trackId, index) + getQueuedTrackId, exportés ;
 *   - cockpit : poignée .hc-drag + wiring pointerdown + commit via moveTo ;
 *   - estampille « suggéré par » PRÉSERVÉE ; marqueur « prochain » présent ;
 *   - ↑/↓ conservés (accessibilité/desktop).
 * Exit 0 si OK, 1 sinon.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const engine = read('public/shared/ui/host-engine.js');
const cockpit = read('public/shared/ui/host-cockpit.js');

const checks = [];
const assert = (label, ok) => checks.push({ label, ok: !!ok });

assert('host-engine.js — function moveTo(trackId, toIndex)', /function\s+moveTo\s*\(\s*trackId\s*,\s*toIndex\s*\)/.test(engine));
assert('host-engine.js — moveTo exporté', /moveTo:\s*moveTo/.test(engine));
assert('host-engine.js — getQueuedTrackId exporté', /getQueuedTrackId:\s*getQueuedTrackId/.test(engine));
assert('host-cockpit.js — poignée .hc-drag dans la file', /class="hc-drag"/.test(cockpit) && /\.hc-drag\{/.test(cockpit));
assert('host-cockpit.js — wiring pointerdown sur la poignée', /addEventListener\(\s*['"]pointerdown['"]/.test(cockpit) && /closest\(\s*['"]\.hc-drag['"]\s*\)/.test(cockpit));
assert('host-cockpit.js — commit du drop via engine.moveTo', /\.moveTo\(\s*id\s*,\s*newIdx\s*\)/.test(cockpit));
assert('host-cockpit.js — estampille « suggéré par » préservée', /suggéré par/.test(cockpit));
assert('host-cockpit.js — marqueur « prochain » (hc-next-badge)', /hc-next-badge/.test(cockpit));
assert('host-cockpit.js — ↑/↓ conservés', /data-act="up"/.test(cockpit) && /data-act="down"/.test(cockpit));

let failed = 0;
for (const c of checks) { console.log(`${c.ok ? '✅' : '❌'} ${c.label}`); if (!c.ok) failed++; }
if (failed) { console.error(`\n❌ t-g3 — ${failed}/${checks.length} en échec.`); process.exit(1); }
console.log(`\n✅ t-g3 — ${checks.length}/${checks.length} OK (DnD file + parité préservée).`);
process.exit(0);
