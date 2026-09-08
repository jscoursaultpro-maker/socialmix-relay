#!/usr/bin/env node
// ★ feat(bug-82-B1): Script READ-ONLY pour aider Jean-Sé à identifier et dropper
// l'index TTL 90j sur la collection parties (endedAt_1).
//
// USAGE:
//   MONGO_URI="mongodb+srv://..." node scripts/drop-party-ttl-index.mjs
//
// Ce script :
//   1. Liste tous les index de la collection 'parties'
//   2. Identifie l'index TTL sur endedAt
//   3. Affiche la commande dropIndex à exécuter manuellement
//
// ⚠️  NE DROP PAS l'index automatiquement — Jean-Sé valide manuellement sur Atlas.

import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI requis. Usage: MONGO_URI="mongodb+srv://..." node scripts/drop-party-ttl-index.mjs');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const db = mongoose.connection.db;
  const collection = db.collection('parties');

  // List all indexes
  const indexes = await collection.indexes();
  console.log(`\n📋 ${indexes.length} index(es) on 'parties' collection:\n`);

  let ttlIndex = null;
  for (const idx of indexes) {
    const isTTL = idx.expireAfterSeconds !== undefined;
    const marker = isTTL ? ' ⚠️  TTL INDEX' : '';
    console.log(`  ${idx.name}${marker}`);
    console.log(`    key: ${JSON.stringify(idx.key)}`);
    if (isTTL) {
      console.log(`    expireAfterSeconds: ${idx.expireAfterSeconds} (${Math.round(idx.expireAfterSeconds / 86400)}j)`);
      if (idx.partialFilterExpression) {
        console.log(`    partialFilterExpression: ${JSON.stringify(idx.partialFilterExpression)}`);
      }
      ttlIndex = idx;
    }
    console.log('');
  }

  if (ttlIndex) {
    console.log('═══════════════════════════════════════');
    console.log('⚠️  INDEX TTL TROUVÉ — À DROPPER MANUELLEMENT');
    console.log('═══════════════════════════════════════');
    console.log(`\n  Index name: "${ttlIndex.name}"`);
    console.log(`  Auto-deletes ended parties after ${Math.round(ttlIndex.expireAfterSeconds / 86400)} days\n`);
    console.log('  Commande Atlas Shell / mongosh :');
    console.log(`    db.parties.dropIndex("${ttlIndex.name}")`);
    console.log('\n  Ou via Atlas UI :');
    console.log('    Database → parties → Indexes → Find endedAt_1 → Drop Index');
    console.log('\n  ✅ Après drop, les parties ended ne seront plus auto-supprimées.');
    console.log('  ℹ️  Le code Mongoose ne recrée plus cet index (commenté dans models/Party.js).\n');
  } else {
    console.log('✅ Aucun index TTL trouvé — rien à dropper.');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
