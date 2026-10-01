/**
 * scripts/youtube-preresolve.mjs
 * ★ Lot 3 host web (01/10/2026) — Pré-résolution des videoId YouTube des titres curés.
 *
 * Résout providers.youtube.videoId pour les titres jouables, PAR LOTS QUOTIDIENS pour
 * respecter le quota YouTube Data API (10 000 unités/jour ÷ 100 par search.list = 100/jour).
 * Reprise automatique : ne retouche que les titres sans videoId, les plus demandés d'abord.
 *
 * Usage :
 *   node --env-file=.env scripts/youtube-preresolve.mjs            # défaut : 90 titres max
 *   node --env-file=.env scripts/youtube-preresolve.mjs --limit 50
 *   node --env-file=.env scripts/youtube-preresolve.mjs --dry      # n'écrit rien
 *
 * À planifier une fois par jour (cron / scheduled task) jusqu'à couverture complète.
 * Jamais de clé dans les logs.
 */
import mongoose from 'mongoose';
import Track from '../models/Track.js';
import { _resolveYouTube } from '../routes/youtube-resolve.js';

const args = process.argv.slice(2);
const LIMIT = Number((args[args.indexOf('--limit') + 1]) || 90);
const DRY   = args.includes('--dry');
const DAILY_CAP = 95;   // marge sous les 100 search.list/jour

async function main() {
  if (!process.env.YOUTUBE_API_KEY) { console.error('❌ YOUTUBE_API_KEY absente — abandon'); process.exit(1); }
  if (!process.env.MONGODB_URI)     { console.error('❌ MONGODB_URI absente — abandon'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB connecté');

  const n = Math.min(LIMIT, DAILY_CAP);
  // Titres jouables, sans videoId YouTube, triés par qualité (proxy de "demande")
  const query = {
    $and: [
      { $or: [{ 'providers.youtube.videoId': { $exists: false } }, { 'providers.youtube.videoId': null }, { 'providers.youtube.videoId': '' }] },
      { title: { $exists: true, $ne: '' } },
      { artist: { $exists: true, $ne: '' } },
    ]
  };
  const tracks = await Track.find(query)
    .select('title artist isrc qualityLevel')
    .sort({ qualityLevel: -1, _id: 1 })
    .limit(n)
    .lean();

  console.log(`→ ${tracks.length} titres à résoudre (cap quotidien ${n})${DRY ? ' [DRY]' : ''}`);
  let ok = 0, miss = 0, searches = 0;
  for (const t of tracks) {
    if (searches >= DAILY_CAP) { console.log('⏸ cap quotidien atteint — reprise demain'); break; }
    searches++;
    const videoId = await _resolveYouTube(t.title, t.artist, t.isrc, t._id.toString());
    if (videoId) {
      ok++;
      if (!DRY) await Track.updateOne({ _id: t._id }, { $set: { 'providers.youtube.videoId': videoId } });
    } else {
      miss++;
    }
    await new Promise(r => setTimeout(r, 200)); // respiration
  }
  console.log(`✅ Terminé : ${ok} résolus, ${miss} sans correspondance, ${searches} recherches consommées`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
