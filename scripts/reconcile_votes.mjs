// scripts/reconcile_votes.mjs
// CLI trigger manuel de la réconciliation Party.guestVotes → Track.performance.
// Le cron horaire dans server.js (Task #114 bis) fait déjà tourner ça automatiquement,
// mais ce script permet de trigger sur demande + choisir dry-run et fenêtre lookback.
//
// Usage :
//   Dry-run (défaut, aucune écriture) — derniers 30j :
//     node --env-file=.env scripts/reconcile_votes.mjs
//   Apply — derniers 30j :
//     node --env-file=.env scripts/reconcile_votes.mjs --apply
//   Apply — TOUS les votes historiques (attention, plus long) :
//     node --env-file=.env scripts/reconcile_votes.mjs --apply --all
//   Dry-run derniers 7j :
//     node --env-file=.env scripts/reconcile_votes.mjs --days 7

import mongoose from 'mongoose';
import { reconcileAllVotes } from '../services/voteReconciliation.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const daysIdx = args.indexOf('--days');
const LOOKBACK_DAYS = daysIdx !== -1 && args[daysIdx + 1]
  ? parseInt(args[daysIdx + 1], 10)
  : 30;

async function run() {
  // Accepte MONGO_URI (usage historique) OU MONGODB_URI (nom du .env relay-server)
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI || MONGO_URI.includes('********')) {
    console.error('❌ MONGO_URI ou MONGODB_URI env variable required');
    console.error('   Usage: node --env-file=.env scripts/reconcile_votes.mjs [--apply] [--all] [--days N]');
    process.exit(1);
  }

  console.log(APPLY ? '🚨 MODE APPLY — les mutations seront écrites en base' : 'ℹ️  Mode dry-run (aucune écriture). --apply pour écrire.');
  console.log(ALL ? '📅 Fenêtre : TOUTES les parties historiques' : `📅 Fenêtre : ${LOOKBACK_DAYS} derniers jours`);

  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const since = ALL ? null : new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);
  const result = await reconcileAllVotes({ since, dryRun: !APPLY });

  console.log('═══════════════════════════════════════════');
  console.log('📊 REPORT');
  console.log('═══════════════════════════════════════════');
  console.log(`  Parties scannées         : ${result.partiesScanned}`);
  console.log(`  Track ratings agrégés    : ${result.trackRatingsCount}`);
  console.log(`  Tracks ${APPLY ? 'updatées' : 'à updater'}  : ${result.updated}`);
  console.log(`  Tracks not-found (ISRC)  : ${result.notFound}`);
  console.log(`  Votes orphelins (no match) : ${result.voteOrphans}`);
  console.log(`  Exécuté à                : ${result.executedAt}`);
  if (!APPLY) console.log('\n  → Relancer avec --apply pour écrire');

  await mongoose.disconnect();
  console.log('\n✅ Done');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
