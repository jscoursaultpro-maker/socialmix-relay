// scripts/backfill_missing_users.mjs
// Chantier 5 Étape 5 : Migration des Users manquants (guests sans User doc)
//
// Usage:
//   node --env-file=.env scripts/backfill_missing_users.mjs           # DRY-RUN (default)
//   node --env-file=.env scripts/backfill_missing_users.mjs --live    # LIVE mode (create Users)
//
// Détecte les emails présents dans party.participants[].email SANS User doc correspondant,
// et crée les User docs manquants avec cguAcceptedAt=null (pas de consent yet).
// Le consent RGPD sera demandé au prochain guest:requestJoin de ces emails.
//
// Marque les Users créés avec isBackfilled=true et isMigrated=true.

import mongoose from 'mongoose';

const DRY_RUN = !process.argv.includes('--live');
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGODB_URI (ou MONGO_URI) manquant dans .env');
  process.exit(1);
}

console.log(`\n🔍 Chantier 5 Étape 5 — Backfill Users manquants`);
console.log(`Mode : ${DRY_RUN ? '⚠️  DRY-RUN (aucune modif BDD)' : '🚀 LIVE (création réelle)'}\n`);

await mongoose.connect(MONGO_URI);

// Loose schemas (bypass strict validation)
const Party = mongoose.model('Party', new mongoose.Schema({}, { strict: false }));
const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

// ─── 1. Collect all unique emails from party.participants ─────────────────────
const parties = await Party.find({}, { code: 1, participants: 1, createdAt: 1 }).lean();
console.log(`📊 ${parties.length} parties scannées`);

const emailMap = new Map(); // email → { firstName, lastName, partyCodes: Set, firstSeenAt }

for (const party of parties) {
  if (!Array.isArray(party.participants)) continue;
  for (const p of party.participants) {
    const email = (p.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) continue;

    if (!emailMap.has(email)) {
      emailMap.set(email, {
        firstName: p.firstName || p.name || '',
        lastName: p.lastName || '',
        partyCodes: new Set(),
        firstSeenAt: party.createdAt || new Date(),
      });
    }
    const entry = emailMap.get(email);
    entry.partyCodes.add(party.code);
    // Update names if better data found
    if (!entry.firstName && (p.firstName || p.name)) entry.firstName = p.firstName || p.name;
    if (!entry.lastName && p.lastName) entry.lastName = p.lastName;
  }
}

console.log(`📧 ${emailMap.size} emails uniques dans participants`);

// ─── 2. Check which emails have NO User doc ───────────────────────────────────
const existingUsers = await User.find(
  { email: { $in: Array.from(emailMap.keys()) } },
  { email: 1 }
).lean();
const existingEmails = new Set(existingUsers.map(u => u.email.toLowerCase()));

console.log(`✅ ${existingEmails.size} emails ont déjà un User doc`);

const missing = [];
for (const [email, data] of emailMap.entries()) {
  if (!existingEmails.has(email)) {
    missing.push({ email, ...data, partyCodes: Array.from(data.partyCodes) });
  }
}

console.log(`\n🎯 ${missing.length} emails à migrer (sans User doc):\n`);
missing.forEach((m, i) => {
  console.log(`  ${i + 1}. ${m.email}`);
  console.log(`     Prénom: ${m.firstName || '(vide)'} | Nom: ${m.lastName || '(vide)'}`);
  console.log(`     Parties: ${m.partyCodes.join(', ')} (${m.partyCodes.length})`);
});

if (DRY_RUN) {
  console.log(`\n⚠️  DRY-RUN — aucune création. Pour créer réellement:`);
  console.log(`   node --env-file=.env scripts/backfill_missing_users.mjs --live\n`);
  process.exit(0);
}

// ─── 3. LIVE: Create missing User docs ────────────────────────────────────────
console.log(`\n🚀 LIVE — création des ${missing.length} User docs...\n`);

let created = 0;
let failed = 0;
for (const m of missing) {
  try {
    const doc = {
      email: m.email,
      profile: {
        firstName: m.firstName || 'Guest',
        lastName: m.lastName || '',
        emoji: '🎉',
      },
      authProvider: null,
      cguAcceptedAt: null, // ← consent RGPD à demander au prochain guest:requestJoin
      cguVersion: null,
      isBackfilled: true, // ← marker pour tracer les migrations
      isMigrated: true,
      schemaVersion: '2.0',
      createdAt: m.firstSeenAt,
      lastSeenAt: new Date(),
      stats: {
        partiesCount: m.partyCodes.length,
        suggestionsCount: 0,
        suggestionsPlayedCount: 0,
        photosUploadedCount: 0,
        totalPoints: 0,
        feuVotesCount: 0,
      },
    };
    const user = await User.create(doc);
    console.log(`  ✅ ${m.email} → _id=${user._id}`);
    created++;
  } catch (err) {
    console.error(`  ❌ ${m.email} → ${err.message}`);
    failed++;
  }
}

console.log(`\n═══════════════════════════════`);
console.log(`✅ Créés : ${created}`);
console.log(`❌ Échoués : ${failed}`);
console.log(`═══════════════════════════════\n`);

process.exit(0);
