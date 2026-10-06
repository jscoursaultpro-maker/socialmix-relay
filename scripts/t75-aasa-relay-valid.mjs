#!/usr/bin/env node
/**
 * Garde statique — Task #75 (Universal Links) — AASA relais (join.ahouai.com).
 * Vérifie : JSON valide, PLUS de placeholder <TEAM_ID>/<BUNDLE_ID>, appID réel
 * "DQDAY9MA9A.com.ahouai.app", composant racine "/" matchant ?code (lien WhatsApp),
 * et composant /join/* (legacy). Exit 0 si OK, 1 sinon.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'public/.well-known/apple-app-site-association'), 'utf8');

const checks = [];
const assert = (label, ok) => checks.push({ label, ok: !!ok });

assert('AASA relais — pas de placeholder <TEAM_ID>/<BUNDLE_ID>', !/<TEAM_ID>|<BUNDLE_ID>/.test(raw));

let json = null;
try { json = JSON.parse(raw); assert('AASA relais — JSON valide', true); }
catch (e) { assert('AASA relais — JSON valide (' + e.message + ')', false); }

if (json) {
  const details = json?.applinks?.details || [];
  const appIDs = details.flatMap(d => d.appIDs || []);
  assert('AASA relais — appID réel DQDAY9MA9A.com.ahouai.app', appIDs.includes('DQDAY9MA9A.com.ahouai.app'));
  const comps = details.flatMap(d => d.components || []);
  assert('AASA relais — composant racine "/" matchant ?code (lien WhatsApp)',
    comps.some(c => c['/'] === '/' && c['?'] && typeof c['?'].code === 'string'));
  assert('AASA relais — composant /join/* (legacy)', comps.some(c => c['/'] === '/join/*'));
}

let failed = 0;
for (const c of checks) { console.log(`${c.ok ? '✅' : '❌'} ${c.label}`); if (!c.ok) failed++; }
if (failed) { console.error(`\n❌ t75-aasa-relay — ${failed}/${checks.length} en échec.`); process.exit(1); }
console.log(`\n✅ t75-aasa-relay — ${checks.length}/${checks.length} OK.`);
process.exit(0);
