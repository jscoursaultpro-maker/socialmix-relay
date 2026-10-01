/**
 * routes/youtube-resolve.js
 * ★ Lot 3 host web (01/10/2026) — Résolution titre AhOuai → videoId YouTube.
 *
 * Exporte _resolveYouTube(title, artist, isrc?, mongoId?) → videoId|null
 *   utilisé par routes/resolve.js (provider=youtube) et par scripts/youtube-preresolve.mjs.
 *
 * Source : YouTube Data API v3 `search.list` (env YOUTUBE_API_KEY).
 *   - type=video, videoCategoryId=10 (Music), regionCode=FR, maxResults=5
 *   - on privilégie les chaînes officielles / " - Topic " (chaînes auto-générées par
 *     les ayants droit), on exclut live / karaoke / cover / reaction / sped up.
 *   - write-back providers.youtube.videoId (idempotent, via resolve.js).
 *
 * Quota : search.list coûte 100 unités ; quota par défaut 10 000/jour = 100 recherches.
 *   → la résolution de masse passe par scripts/youtube-preresolve.mjs (lots quotidiens).
 *   À l'exécution, budget strict + cache (géré par l'appelant resolve.js).
 *
 * Jamais de clé dans les logs.
 */
import { _normalizeForMatch } from './djbrain-lite.js';

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const _BLACKLIST = [
  'karaoke', 'tribute', 'made famous', 'backing track', 'instrumental version',
  'cover', 'reaction', 'sped up', 'slowed', 'nightcore', 'lyrics video',
  'live at', 'en vivo', '8d audio', 'remix by', '1 hour', 'loop',
];

let _warnedNoKey = false;

function _scoreCandidate(item, wantTitle, wantArtist) {
  const sn = item.snippet || {};
  const title   = (sn.title || '').toLowerCase();
  const channel = (sn.channelTitle || '').toLowerCase();
  const normT   = _normalizeForMatch(sn.title || '');
  let score = 0;

  // Rejets durs : versions parasites
  for (const bad of _BLACKLIST) if (title.includes(bad)) return -1e6;

  // Chaîne officielle : " - Topic " (auto-générée par les ayants droit) ou "VEVO" ou "Official"
  if (/ - topic$/.test(channel))      score += 60;
  if (channel.includes('vevo'))       score += 40;
  if (/official/.test(channel))       score += 25;

  // Correspondance titre
  if (normT.includes(_normalizeForMatch(wantTitle)))  score += 50;
  if (normT.includes(_normalizeForMatch(wantArtist))) score += 30;

  // Signaux "officiel" dans le titre
  if (/official (video|audio|music video)/.test(title)) score += 20;
  if (/\(audio\)/.test(title))                          score += 10;

  return score;
}

/** @returns {Promise<string|null>} videoId YouTube ou null. */
export async function _resolveYouTube(title, artist, _isrc = null, _mongoId = null) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    if (!_warnedNoKey) { _warnedNoKey = true; console.warn('[youtube] YOUTUBE_API_KEY absente — résolution YouTube désactivée'); }
    return null;
  }
  if (!title || !artist) return null;

  const q = `${artist} ${title}`.trim();
  const params = new URLSearchParams({
    part: 'snippet', q, type: 'video', videoCategoryId: '10',
    regionCode: 'FR', relevanceLanguage: 'fr', maxResults: '5', key,
  });
  try {
    const res = await fetch(`${SEARCH_URL}?${params.toString()}`);
    if (res.status === 403) {
      // quota dépassé ou clé invalide — ne pas spammer
      const body = await res.json().catch(() => ({}));
      const reason = body?.error?.errors?.[0]?.reason || 'forbidden';
      console.warn(`[youtube] search 403 (${reason}) — budget/clé`);
      return null;
    }
    if (!res.ok) { console.warn(`[youtube] search HTTP ${res.status}`); return null; }
    const data = await res.json();
    const items = data.items || [];
    if (!items.length) return null;

    let best = null, bestScore = -Infinity;
    for (const it of items) {
      const s = _scoreCandidate(it, title, artist);
      if (s > bestScore) { bestScore = s; best = it; }
    }
    if (!best || bestScore <= 0) return null;          // aucun candidat crédible
    const videoId = best.id?.videoId || null;
    if (videoId) console.log(`[youtube] "${artist} - ${title}" → ${videoId} (score ${bestScore})`);
    return videoId;
  } catch (e) {
    console.warn(`[youtube] résolution erreur : ${e.message}`);
    return null;
  }
}
