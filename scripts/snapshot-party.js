/**
 * snapshot-party.js — Export complet d'une party MongoDB
 *
 * Usage : node scripts/snapshot-party.js <PARTY_CODE>
 * Exemple: node scripts/snapshot-party.js XETZFR
 *
 * ⚠️  Le schéma réel utilise un document Party embarqué :
 *      suggestions[], participants[], photos[], trackHistory[], etc.
 *      sont tous des sous-documents de la collection 'parties'.
 */

import mongoose from 'mongoose';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Charger .env manuellement (pas de dotenv dans node_modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

// Supporte MONGODB_URI et MONGO_URI (les 2 conventions utilisées dans ce projet)
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const PARTY_CODE = process.argv[2]?.toUpperCase();

if (!PARTY_CODE) {
  console.error('Usage: node scripts/snapshot-party.js <PARTY_CODE>');
  process.exit(1);
}

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI manquant dans .env');
  process.exit(1);
}

console.log(`🔌 Connexion MongoDB...`);
await mongoose.connect(MONGODB_URI);
const db = mongoose.connection.db;

// ─── 1. Lister les collections disponibles (pour debug) ──────────────────────
const collections = await db.listCollections().toArray();
const collectionNames = collections.map(c => c.name).sort();
console.log(`📦 Collections MongoDB : [${collectionNames.join(', ')}]`);

// ─── 2. Récupérer le document Party ──────────────────────────────────────────
console.log(`🔍 Recherche party code=${PARTY_CODE}...`);
const party = await db.collection('parties').findOne({ code: PARTY_CODE });

if (!party) {
  console.error(`❌ Party ${PARTY_CODE} introuvable en BDD`);
  await mongoose.disconnect();
  process.exit(1);
}

// ─── 3. Récupérer les GuestSessions liées si la collection existe ─────────────
let guestSessions = [];
if (collectionNames.includes('guestsessions')) {
  guestSessions = await db.collection('guestsessions').find({ partyCode: PARTY_CODE }).toArray();
}

// ─── 4. Construire le snapshot ────────────────────────────────────────────────
const snapshot = {
  snapshotAt:   new Date().toISOString(),
  partyCode:    PARTY_CODE,
  schemaNote:   'Tout est embarqué dans le document Party (suggestions, participants, photos, etc.)',
  availableCollections: collectionNames,
  party,                          // Document Party complet
  guestSessions,                  // Collection séparée si elle existe
};

// ─── 5. Sauvegarder ───────────────────────────────────────────────────────────
const dir = `.backups/2026-06-26/xetzfr/`;
fs.mkdirSync(dir, { recursive: true });
const ts = Date.now();
const filename = `${dir}${PARTY_CODE.toLowerCase()}-snapshot-mongodb-${ts}.json`;
fs.writeFileSync(filename, JSON.stringify(snapshot, null, 2));

// ─── 6. Stats ─────────────────────────────────────────────────────────────────
const p = party;
console.log(`\n✅ Snapshot sauvé : ${filename}`);
console.log(`📊 Stats :`);
console.log(`   - Code         : ${p.code}`);
console.log(`   - Participants : ${p.participants?.length ?? 0}`);
console.log(`   - Suggestions  : ${p.suggestions?.length ?? 0}`);
console.log(`   - Photos       : ${p.photos?.length ?? 0} (photoCount=${p.photoCount ?? 0})`);
console.log(`   - TrackHistory : ${p.trackHistory?.length ?? 0}`);
console.log(`   - CostumeEntries: ${p.costumeEntries?.length ?? 0}`);
console.log(`   - PlayedKeys   : ${p.playedKeys?.length ?? 0}`);
console.log(`   - GuestSessions: ${guestSessions.length}`);
console.log(`   - Taille JSON  : ${(fs.statSync(filename).size / 1024).toFixed(1)} KB`);

// ─── 7. Validation photos (URLs Cloudinary, pas base64 vide) ─────────────────
const photos = p.photos ?? [];
const cloudinaryPhotos = photos.filter(ph => (ph.dataURL || ph.url || '').includes('cloudinary'));
const emptyPhotos = photos.filter(ph => !(ph.dataURL || ph.url || '').trim());
if (photos.length > 0) {
  console.log(`   - Photos Cloudinary : ${cloudinaryPhotos.length}/${photos.length}`);
  if (emptyPhotos.length > 0) {
    console.warn(`   ⚠️  ${emptyPhotos.length} photos avec URL vide`);
  }
}

await mongoose.disconnect();
console.log(`\n🔒 MongoDB déconnecté. Snapshot complet.`);
