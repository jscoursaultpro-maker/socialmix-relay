// generate-apple-jwt.mjs
// Génère un JWT ES256 pour Supabase Apple OAuth (valide 180 jours max)
// Usage : node scripts/generate-apple-jwt.mjs
//
// Pré-requis :
//   1. Renseigne TEAM_ID, KEY_ID, SERVICES_ID ci-dessous
//   2. Copie ton fichier AuthKey_XXXXX.p8 dans relay-server/ (temporairement, à supprimer après !)
//   3. Renseigne P8_PATH avec le chemin exact
//
// Sécurité : NE JAMAIS commit ni le .p8 ni le JWT généré.

import { SignJWT, importPKCS8 } from 'jose';
import { readFileSync } from 'fs';

// ─── À RENSEIGNER ─────────────────────────────────────────────────
const TEAM_ID     = 'DQDAY9MA9A';           // ton Team ID Apple (visible haut à droite du Developer Portal)
const KEY_ID      = 'REMPLACE_PAR_TON_KEY_ID';  // format 10 caractères ex: ABC123DEFG
const SERVICES_ID = 'com.ahouai.auth';       // ton Services ID (pas le Bundle ID)
const P8_PATH     = './AuthKey_REMPLACE_PAR_TON_KEY_ID.p8'; // chemin vers ton .p8
// ──────────────────────────────────────────────────────────────────

const privateKeyPEM = readFileSync(P8_PATH, 'utf8');
const privateKey    = await importPKCS8(privateKeyPEM, 'ES256');

const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
  .setIssuer(TEAM_ID)
  .setIssuedAt()
  .setExpirationTime('180d') // Apple max = 6 mois. À régénérer tous les 6 mois.
  .setAudience('https://appleid.apple.com')
  .setSubject(SERVICES_ID)
  .sign(privateKey);

console.log('\n──── APPLE JWT (à coller dans Supabase > Auth > Providers > Apple > Secret Key) ────\n');
console.log(jwt);
console.log('\n──── Rappel sécurité ────');
console.log('1. Copie le JWT ci-dessus dans Supabase');
console.log('2. SUPPRIME le fichier .p8 de relay-server/ (ou déplace-le dans un dossier sécurisé hors du repo)');
console.log('3. NOTE dans ton agenda : régénérer ce JWT dans 5 mois (avant expiration 6 mois)');
