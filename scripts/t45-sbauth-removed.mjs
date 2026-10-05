/**
 * Garde statique Task #45 (doctrine 3.11) — empêche la réintroduction de l'auth `sbauth`
 * (jeton base64 NON SIGNÉ, forgeable). Analyse statique du source, hors commentaires.
 *
 * Elle NE vérifie PAS « zéro occurrence du mot sbauth » : deux lignes de NETTOYAGE légitimes
 * subsistent et doivent subsister (purge du cookie à la déconnexion + expiration Max-Age=0).
 * Elle interdit les PATTERNS d'ACCEPTATION / ÉMISSION / INGESTION sbauth, qui sont la faille.
 *
 * Exit 0 = aucun pattern interdit. Exit 1 = régression (sbauth réintroduit).
 */
import { readFileSync } from 'fs';

// Retire commentaires de ligne (// …) et de bloc (/* … */) pour ne tester que le code actif.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
}

const ROOT = new URL('..', import.meta.url).pathname;
// Fichier → patterns interdits (regex testées sur le code SANS commentaires).
const RULES = [
  { file: 'middleware/authGuest.js', forbidden: [
    { re: /authType\s*===\s*['"]sbauth['"]/, why: "acceptation en-tête X-Auth-Type: sbauth" },
    { re: /cookies\s*\[\s*['"]sbauth['"]\s*\]/, why: "acceptation cookie sbauth" },
  ] },
  { file: 'public/app.js', forbidden: [
    { re: /type\s*:\s*['"]sbauth['"]/, why: "getAuthCredential renvoie un credential sbauth" },
    { re: /get\(\s*['"]sbauth['"]\s*\)/, why: "ingestion du paramètre d'URL ?sbauth=" },
    { re: /['"]X-Auth-Type['"]/, why: "en-tête X-Auth-Type (routage sbauth)" },
    { re: /document\.cookie\s*=\s*[`'"]sbauth=\$\{/, why: "pose d'un cookie sbauth avec valeur" },
  ] },
];

let fail = 0;
console.log('── Task #45 — garde statique : non-réintroduction de l\'auth sbauth ──');
for (const { file, forbidden } of RULES) {
  let code;
  try { code = stripComments(readFileSync(ROOT + file, 'utf8')); }
  catch (e) { console.log(`❌ ${file} : illisible (${e.message})`); fail++; continue; }
  let fileOk = true;
  for (const { re, why } of forbidden) {
    if (re.test(code)) { console.log(`❌ ${file} : pattern interdit présent — ${why}  (${re})`); fail++; fileOk = false; }
  }
  if (fileOk) console.log(`✅ ${file} : aucun pattern d'auth sbauth`);
}
console.log('─'.repeat(60));
console.log(fail === 0 ? 'OK — sbauth auth absent (nettoyage/purge autorisés)' : `${fail} pattern(s) interdit(s) → régression sbauth`);
process.exit(fail === 0 ? 0 : 1);
