/**
 * services/djbrain/select.js
 * ★ DJ Brain Cloud — sélection des prochains titres (pur, testable sans HTTP).
 *
 * Reçoit un pool de candidats (docs Track lean, déjà filtrés/chargés par la route),
 * l'état de soirée, les scores de fraîcheur et les suggestions, et renvoie le top N.
 */

import { scoreTrack, normalizeTitle } from './scoring.js';

/**
 * @param {object} opts
 * @param {object[]} opts.tracks        pool de candidats (docs Track lean)
 * @param {string}   opts.stage         phase effective (arrival…closing)
 * @param {number}   opts.energyLevel   0-100
 * @param {object}   [opts.genreVotes]  { genre: count }
 * @param {object[]} [opts.trackHistory] titres déjà joués cette soirée [{title,artist,deezerRank?,playedAt?}]
 * @param {number}   [opts.currentBPM]  BPM du titre courant
 * @param {object}   [opts.freshness]   { trackId: {freshnessScore, partyStaleness} }
 * @param {object}   [opts.suggestions] { trackId: {consensus,guestCount,boostCount} }
 * @param {string}   [opts.provider]    spotify|apple|youtube (préférence douce)
 * @param {number}   [opts.count=5]
 * @param {number}   [opts.nowMs=Date.now()]
 * @returns {{tracks:object[], stage:string, energyLevel:number, debug:object}}
 */
export function selectNextTracks(opts) {
  const {
    tracks = [], stage, energyLevel = 50, genreVotes = {}, trackHistory = [],
    currentBPM = 0, freshness = {}, suggestions = {}, provider = null,
    count = 5, nowMs = Date.now(),
  } = opts;

  // ── Dérivations depuis l'historique de soirée ──────────────────────────────
  // ⚠️ party.trackHistory est NEWEST-FIRST (cappedUnshift côté serveur) : index 0 = dernier joué.
  // On réoriente en oldest→newest pour que le « dernier » soit en fin de liste (attendu par
  // continuityBonus / consecutive malus).
  const playedSongTitles = new Set(trackHistory.map((t) => normalizeTitle(t.title)));
  const firstTrack = trackHistory.length === 0;

  const recentOldestToNewest = trackHistory.slice(0, 8).reverse(); // 8 plus récents, ordre chrono
  const recentGenres = recentOldestToNewest.map((t) => t.genre || t.genreBDD || '').filter(Boolean);
  const recentArtists = recentOldestToNewest.slice(-3)
    .map((t) => (t.artist || '').toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean);
  const recentArtistTimestamps = {};
  for (const t of trackHistory) {
    const k = (t.artist || '').toLowerCase().replace(/[^a-z]/g, '');
    const ts = t.playedAt ? new Date(t.playedAt).getTime() : (t.ts || null);
    if (k && ts) recentArtistTimestamps[k] = Math.max(recentArtistTimestamps[k] || 0, ts);
  }

  const last = trackHistory[0]; // dernier joué (newest-first)
  const lastRank = last ? (last.deezerRank || last.rank || 0) : 0;
  const lastAcceptedWasHymn = (lastRank / 5000.0) / 10.0 >= 7.5; // candPop du dernier titre ≥ 7.5

  // ── Tendance de genre ──────────────────────────────────────────────────────
  const voteEntries = Object.entries(genreVotes || {});
  const totalVotes = voteEntries.reduce((s, [, v]) => s + (v || 0), 0);
  const hasGenreVotes = totalVotes > 0;
  const dominantGenre = hasGenreVotes
    ? voteEntries.sort((a, b) => b[1] - a[1])[0][0] : '';

  const ctx = {
    stage, energyLevel, dominantGenre, hasGenreVotes,
    recentGenres, recentArtists, recentArtistTimestamps,
    playedSongTitles, currentBPM, firstTrack,
    freshness, suggestions, lastAcceptedWasHymn, provider, nowMs,
  };

  // ── Scoring ────────────────────────────────────────────────────────────────
  const scored = [];
  for (const track of tracks) {
    // Exclure les titres déjà joués cette soirée (dédup par titre normalisé).
    if (playedSongTitles.has(normalizeTitle(track.title))) continue;
    const { score, breakdown } = scoreTrack(track, { ...ctx, varietyJitter: Math.random() });
    if (score <= -100000) continue; // bloqué dur (lounge en peak, artiste manquant…)
    scored.push({ track, score, breakdown });
  }

  scored.sort((a, b) => b.score - a.score);

  // ── Dédup par _id et par titre normalisé, top N ────────────────────────────
  const seenIds = new Set();
  const seenTitles = new Set();
  const out = [];
  for (const s of scored) {
    const id = String(s.track._id);
    const tkey = normalizeTitle(s.track.title);
    if (seenIds.has(id) || seenTitles.has(tkey)) continue;
    seenIds.add(id); seenTitles.add(tkey);
    out.push(s);
    if (out.length >= count) break;
  }

  return {
    tracks: out.map((s) => formatTrack(s.track, s.score, s.breakdown)),
    stage,
    energyLevel,
    debug: {
      pool: tracks.length, scored: scored.length, dominantGenre, hasGenreVotes,
      firstTrack, recentGenres, top: out.slice(0, 3).map((s) => ({ title: s.track.title, score: Math.round(s.score) })),
    },
  };
}

export function formatTrack(t, score, breakdown) {
  return {
    trackId: String(t._id),
    title: t.title,
    artist: t.artist,
    durationMs: t.durationMs || 0,
    coverArtURL: t.coverArtURL || null,
    // Contrat compat djbrain-lite : spotifyUri + isrc pour host:trackUpdate (deep-link guests).
    spotifyUri: t.providers?.spotify?.trackId ? `spotify:track:${t.providers.spotify.trackId}` : null,
    isrc: t.isrc || null,
    phase: t.phase || null,
    bpm: t.bpm || 0,
    energy: t.energy || 0,
    qualityLevel: t.qualityLevel || null,
    isBanger: !!t.isBanger,
    _score: Math.round(score),
    _breakdown: breakdown,
  };
}
