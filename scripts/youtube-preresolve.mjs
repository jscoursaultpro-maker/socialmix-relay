/**
 * scripts/youtube-preresolve.mjs
 * ★ Lot 3 host web — Pré-résolution des videoId YouTube (run manuel / cron externe).
 *
 * La logique vit dans services/youtubePreresolve.js (partagée avec le planificateur
 * in-process du relay). Ce script ne fait que connecter Mongo et lancer un lot.
 *
 * Usage :
 *   node --env-file=.env scripts/youtube-preresolve.mjs            # défaut 90 titres
 *   node --env-file=.env scripts/youtube-preresolve.mjs --limit 50
 *   node --env-file=.env scripts/youtube-preresolve.mjs --dry      # n'écrit rien
 */
import mongoose from 'mongoose';
import { preresolveYoutubeBatch } from '../services/youtubePreresolve.js';

const args = process.argv.slice(2);
const LIMIT = Number((args[args.indexOf('--limit') + 1]) || 90);
const DRY = args.includes('--dry');

async function main() {
  if (!process.env.YOUTUBE_API_KEY) { console.error('❌ YOUTUBE_API_KEY absente — abandon'); process.exit(1); }
  if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI absente — abandon'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB connecté');
  const r = await preresolveYoutubeBatch({ limit: LIMIT, dry: DRY });
  console.log(`✅ Terminé : ${r.ok} résolus, ${r.miss} sans correspondance, ${r.searches} recherches${DRY ? ' [DRY]' : ''}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => { console.error('❌', err.message); process.exit(1); });
