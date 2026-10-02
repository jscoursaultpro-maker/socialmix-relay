/**
 * services/youtubePreresolve.js
 * ★ Curation continue — pré-résolution des videoId YouTube du catalogue, PAR LOTS.
 *
 * Nourrit providers.youtube.videoId pour les titres jouables qui n'en ont pas encore,
 * afin qu'une lecture host web n'ait (presque) jamais à faire d'appel YouTube Data en
 * direct (quota 10 000 u/j ÷ 100 par search.list = 100 recherches/jour).
 *
 * Partagé par :
 *   - le planificateur in-process du relay (server.js boot → ~1×/jour, pausé si soirée live) ;
 *   - le script CLI scripts/youtube-preresolve.mjs (run manuel).
 *
 * Reprise automatique : ne retouche que les titres sans videoId, les plus qualifiés d'abord.
 * Jamais de clé dans les logs.
 */
import Track from '../models/Track.js';
import { _resolveYouTube } from '../routes/youtube-resolve.js';

const HARD_CAP = 95;         // marge sous les 100 search.list/jour
export const DEFAULT_LIMIT = 60;  // défaut in-process : laisse du quota au live

/**
 * Résout un lot de titres sans videoId YouTube et écrit providers.youtube.videoId.
 * @param {object} [opts]
 * @param {number} [opts.limit=60]  nombre max de recherches (plafonné à 95)
 * @param {boolean} [opts.dry=false] n'écrit rien
 * @returns {Promise<{ok:number,miss:number,searches:number,considered:number,skipped?:string}>}
 */
export async function preresolveYoutubeBatch(opts = {}) {
  const dry = !!opts.dry;
  if (!process.env.YOUTUBE_API_KEY) return { ok: 0, miss: 0, searches: 0, considered: 0, skipped: 'no_key' };

  const n = Math.min(Number(opts.limit) || DEFAULT_LIMIT, HARD_CAP);
  const query = {
    $and: [
      { $or: [{ 'providers.youtube.videoId': { $exists: false } }, { 'providers.youtube.videoId': null }, { 'providers.youtube.videoId': '' }] },
      { title: { $exists: true, $ne: '' } },
      { artist: { $exists: true, $ne: '' } },
      { suggestable: { $ne: false } },
      { isBlocked: { $ne: true } },
    ],
  };
  const tracks = await Track.find(query)
    .select('title artist isrc qualityLevel')
    .sort({ qualityLevel: -1, _id: 1 })
    .limit(n)
    .lean();

  let ok = 0, miss = 0, searches = 0;
  for (const t of tracks) {
    if (searches >= HARD_CAP) break;
    searches++;
    const videoId = await _resolveYouTube(t.title, t.artist, t.isrc, t._id.toString());
    if (videoId) {
      ok++;
      if (!dry) await Track.updateOne({ _id: t._id }, { $set: { 'providers.youtube.videoId': videoId } });
    } else {
      miss++;
    }
    await new Promise((r) => setTimeout(r, 200)); // respiration (politesse API)
  }
  return { ok, miss, searches, considered: tracks.length };
}
