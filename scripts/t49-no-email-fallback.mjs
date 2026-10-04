#!/usr/bin/env node
/**
 * t49-no-email-fallback.mjs — Task #49, garde de régression statique.
 *
 * Vérifie que le repli « résoudre l'utilisateur par email » n'existe plus sur
 * les chemins sbauth de middleware/authGuest.js, et interdit sa réintroduction.
 *
 * Pourquoi un test STATIQUE et pas un jeton forgé contre la prod : forger un
 * jeton sbauth ne portant qu'un email, c'est exactement l'exploit que #49
 * ferme. On ne reproduit pas l'attaque pour la « prouver », fût-ce en visant
 * son propre compte — on vérifie que le code qui la permettait a disparu, et on
 * le re-vérifie à chaque exécution pour attraper toute régression.
 *
 *   node scripts/t49-no-email-fallback.mjs   → exit 0 si sûr, 1 sinon
 *
 * Le seul lookup User par email légitimement conservé est celui du chemin JWT
 * Supabase VÉRIFIÉ (≈ L164, handleSupabaseSession) : là l'email provient d'un
 * jeton signé validé par Supabase, pas d'une entrée contrôlée par l'appelant.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'middleware', 'authGuest.js');
const src = readFileSync(file, 'utf8');
const lines = src.split('\n');

let fail = 0;
const ko = (m) => { console.log(`❌ ${m}`); fail++; };
const ok = (m) => console.log(`✅ ${m}`);

// 1. Les deux blocs sbauth décodent un payload base64 contrôlé par l'appelant.
//    Dans leur portée, AUCUN findOne({ email: payload.email }) ne doit subsister.
const forbidden = /findOne\(\s*\{\s*email:\s*payload\.email/;
const hits = [];
lines.forEach((l, i) => { if (forbidden.test(l)) hits.push(i + 1); });
if (hits.length === 0) ok('aucun findOne({ email: payload.email }) sur les chemins sbauth');
else ko(`repli email présent ligne(s) ${hits.join(', ')} — l'exploit #49 est rouvert`);

// 2. Garde de forme : chaque branche `!isObjectId` doit enchaîner directement
//    sur le `else { findById }` sans lookup email intercalé. On vérifie qu'entre
//    un findOne({ supabaseUserId }) et son else, il n'y a pas de findOne({ email.
const supaIdx = [];
lines.forEach((l, i) => { if (/findOne\(\s*\{\s*supabaseUserId/.test(l)) supaIdx.push(i); });
let intercale = 0;
for (const start of supaIdx) {
  for (let j = start + 1; j < Math.min(start + 8, lines.length); j++) {
    if (/\}\s*else\s*\{/.test(lines[j])) break;
    if (/findOne\(\s*\{\s*email/.test(lines[j])) intercale++;
  }
}
if (intercale === 0) ok('aucun lookup email intercalé entre supabaseUserId et le fallback _id');
else ko(`${intercale} lookup email intercalé dans une branche sbauth`);

// 3. Le lookup email légitime du chemin JWT vérifié doit, lui, rester présent —
//    sinon on aurait sur-supprimé et cassé l'adoption de compte Supabase.
if (/findOne\(\s*\{\s*email:\s*supabaseUser\.email/.test(src)) {
  ok('lookup email du chemin JWT vérifié (supabaseUser.email) préservé');
} else {
  ko('le lookup email du chemin JWT vérifié a disparu — sur-suppression, adoption de compte cassée');
}

console.log(`\n${fail === 0 ? '✅ #49 : sûr' : '❌ #49 : ' + fail + ' problème(s)'}`);
process.exit(fail === 0 ? 0 : 1);
