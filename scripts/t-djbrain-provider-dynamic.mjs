#!/usr/bin/env node
/**
 * Garde de régression — G1 (parité provider host web).
 * Vérifie que l'appel DJ Brain cloud (host-engine.js) n'envoie PLUS un provider codé en dur
 * 'youtube' mais le provider RÉEL de la soirée (party.provider). Empêche la réintroduction
 * du hardcode qui faisait une file YouTube-optimisée même pour une soirée Spotify/Apple.
 * Exit 0 si OK, 1 sinon.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engine = readFileSync(join(root, 'public/shared/ui/host-engine.js'), 'utf8');

const checks = [];
const assert = (label, ok) => checks.push({ label, ok: !!ok });

// 1. Plus de hardcode &provider=youtube dans l'URL /api/djbrain/next
const djbrainFetch = engine.match(/\/api\/djbrain\/next[^\n;]*/);
assert('host-engine.js — plus de hardcode "&provider=youtube" dans le fetch /api/djbrain/next',
  !!djbrainFetch && !/provider=youtube/.test(djbrainFetch[0]));

// 2. L'appel DJ Brain cloud utilise le provider réel (party.provider)
assert('host-engine.js — le fetch DJ Brain envoie le provider réel (party.provider)',
  /\/api\/djbrain\/next[\s\S]{0,200}?provider=['"]?\s*\+\s*encodeURIComponent\(\s*_prov/.test(engine) ||
  /_prov\s*=\s*\(party && party\.provider\)/.test(engine));

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? '✅' : '❌'} ${c.label}`);
  if (!c.ok) failed++;
}
if (failed) {
  console.error(`\n❌ t-djbrain-provider — ${failed}/${checks.length} assertion(s) en échec.`);
  process.exit(1);
}
console.log(`\n✅ t-djbrain-provider — ${checks.length}/${checks.length} OK (DJ Brain = provider réel de la soirée).`);
process.exit(0);
