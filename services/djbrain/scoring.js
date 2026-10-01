/**
 * services/djbrain/scoring.js
 * ★ DJ Brain Cloud — scoring composite (port de DJBrain.swift computeNextTrack, chemin Explore).
 *
 * Fidélité : mêmes poids, mêmes bonus/pénalités, mêmes constantes que l'iOS. Les artefacts
 * propres à la source iOS (candidats issus de recherches Deezer typées via `sq.source`) sont
 * remplacés par les vrais champs Mongo (Track.energy, Track.genre, Track.deezerRank…), ce qui
 * est strictement plus précis — AUCUNE constante de doctrine n'est modifiée.
 *
 * Banger : le serveur n'a qu'un seul chemin de scoring, donc il réunit les DEUX traitements
 * banger de l'iOS : le match de phase (+80 / −20, ex-chemin curé monitorBangerBonus) ET le
 * BANGER_BOOST (+20 de fraîcheur sur phases hautes, ex-chemin Explore).
 */

import {
  WEIGHTS, targetEnergy, popularityBonus, stageGenreRouting,
  isPhaseCompatible, BANGER_BOOST_PHASES, SUGGESTION_PHASE_MULT,
  ARTIST_COOLDOWN_MINUTES, CROSS_PARTY_WINDOW,
} from './phases.js';

// ── BPM ────────────────────────────────────────────────────────────────────
/** BPM cible selon l'énergie (0-100). Port 1:1. */
export function targetBPM(energyLevel) {
  if (energyLevel > 80) return 135;
  if (energyLevel > 60) return 128;
  if (energyLevel > 40) return 118;
  if (energyLevel > 20) return 105;
  return 95;
}

/** Score de proximité BPM — gaussienne σ=15 ; repli half-time si >160. Port 1:1. */
export function bpmScore(trackBPM, tgt) {
  if (!trackBPM || trackBPM <= 0) return 50; // inconnu = neutre
  let eff = trackBPM;
  if (eff > 160) eff /= 2.0; // half-time (171 → 85.5)
  const diff = Math.abs(eff - tgt);
  return 100.0 * Math.exp(-(diff * diff) / (2.0 * 15.0 * 15.0));
}

/** BPM perçu (repli half-time) pour le lissage. */
function effectiveBPM(bpm) {
  if (!bpm || bpm <= 0) return 0;
  return bpm > 160 ? bpm / 2.0 : bpm;
}

// ── Continuité de genre ──────────────────────────────────────────────────────
/** +6 par match dans les 3 derniers, max +18, decay après 4+ consécutifs. Port 1:1. */
export function continuityBonus(candidateGenre, recentGenres) {
  if (!candidateGenre || !recentGenres || recentGenres.length === 0) return 0;
  const last3 = recentGenres.slice(-3);
  const matchCount = last3.filter((g) => g === candidateGenre).length;
  const base = matchCount * 6.0;
  // consécutifs en fin de liste
  let consecutive = 0;
  for (let i = recentGenres.length - 1; i >= 0; i--) {
    if (recentGenres[i] === candidateGenre) consecutive++; else break;
  }
  let decay = 1.0;
  if (consecutive === 4) decay = 0.67;
  else if (consecutive === 5) decay = 0.33;
  else if (consecutive >= 6) decay = 0.0;
  return base * decay;
}

/** Malus Fresh Rotation cross-party : −((N − staleness) × 30). Port 1:1. */
export function crossPartyMalus(staleness, windowN = CROSS_PARTY_WINDOW) {
  if (staleness == null || staleness >= windowN) return 0;
  return -((windowN - staleness) * 30);
}

// ── Genre : clusters de compatibilité (approximation macro côté serveur) ──────
const GENRE_CLUSTERS = [
  ['house', 'electro', 'techno', 'disco', 'dance', 'deep house', 'tech house', 'melodic house', 'afro house', 'amapiano'],
  ['hip-hop', 'rap', 'r&b', 'afro', 'latin', 'urban groove', 'reggaeton'],
  ['pop', 'rock', 'soul', 'funk', 'cocovariet', 'chill', 'lounge', 'jazz', 'old school'],
];
function sameCluster(a, b) {
  if (!a || !b) return false;
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (la === lb) return true;
  return GENRE_CLUSTERS.some((c) => c.includes(la) && c.includes(lb));
}

function genreAllowedInStage(trackGenre, stage) {
  const routing = stageGenreRouting(stage);
  if (!routing) return true; // tous genres (groove, party)
  if (!trackGenre) return true;
  const lg = trackGenre.toLowerCase();
  return routing.some((g) => g.toLowerCase() === lg) || routing.some((g) => sameCluster(g, trackGenre));
}

const LOUNGE_JAZZ = new Set(['lounge', 'jazz']);

/**
 * Score complet d'un titre. Pur et déterministe (sauf variété : jitter fourni par l'appelant).
 * @param {object} track  document Track (lean) : _id,title,artist,genre,phase,phaseAlternate,energy,bpm,deezerRank,isBanger,danceability,providers
 * @param {object} ctx    contexte de soirée (voir select.js)
 * @returns {{score:number, breakdown:object}}
 */
export function scoreTrack(track, ctx) {
  const {
    stage, energyLevel, dominantGenre, hasGenreVotes,
    recentGenres, recentArtists, recentArtistTimestamps,
    playedSongTitles, currentBPM, firstTrack,
    freshness, suggestions, lastAcceptedWasHymn, provider, nowMs, varietyJitter,
  } = ctx;

  const tgtEnergy = targetEnergy(stage);
  const tgtBpm = targetBPM(energyLevel);
  const candEnergy = (track.energy && track.energy > 0) ? track.energy : 5;
  const genre = track.genre || track.genreBDD || '';
  const idStr = String(track._id);
  const artistKey = (track.artist || '').toLowerCase().replace(/[^a-z]/g, '');

  // ── Sous-scores pondérés ────────────────────────────────────────────────
  let genreScore;
  if (!hasGenreVotes || !dominantGenre) genreScore = 50;          // pas de tendance → neutre
  else if (genre && genre.toLowerCase() === dominantGenre.toLowerCase()) genreScore = 100;
  else if (sameCluster(genre, dominantGenre)) genreScore = 60;
  else genreScore = 30;

  const energyScore = Math.max(0, 100 - 15 * Math.abs(tgtEnergy - candEnergy));
  const bpmProximity = bpmScore(track.bpm, tgtBpm);
  const popScore = Math.min(100.0, (track.deezerRank || 0) / 5000.0);
  const candPop = popScore / 10.0;

  // Suggestions guests (passées validées + live) : map trackId → {consensus,guestCount,boostCount}
  const sugg = suggestions ? suggestions[idStr] : null;
  const isSuggestion = !!sugg;
  let suggScore = 0, suggestionDirectBoost = 0, boostBonus = 0;
  if (sugg) {
    suggScore = sugg.consensus != null ? sugg.consensus : 60;
    boostBonus = (sugg.boostCount || 0) * 30.0;
    const mult = SUGGESTION_PHASE_MULT[stage] ?? 1.0;
    const guestCount = sugg.guestCount || 1;
    if (guestCount >= 2) suggestionDirectBoost = (guestCount - 1) * 50.0 * mult;
    else suggestionDirectBoost = Math.max(0, (mult - 0.5) * 50.0 * 0.4);
  }

  const varScore = 30 + (varietyJitter != null ? varietyJitter : 0) * 50; // jitter 0..1 → 30..80

  let composite = genreScore * WEIGHTS.genre
    + energyScore * WEIGHTS.energy
    + bpmProximity * WEIGHTS.bpm
    + popScore * WEIGHTS.popularity
    + suggScore * WEIGHTS.suggestion
    + varScore * WEIGHTS.variety;
  composite += boostBonus;

  // Bonus/pénalité de genre connu (port 1:1 : +25 bon genre / −50 mauvais) — seulement si tendance.
  if (hasGenreVotes && dominantGenre && genre) {
    if (genre.toLowerCase() === dominantGenre.toLowerCase() || sameCluster(genre, dominantGenre)) composite += 25.0;
    else composite -= 50.0;
  }

  const candidateGenre = genre || dominantGenre || '';
  composite += continuityBonus(candidateGenre, recentGenres);

  // ── Bonus de phase ────────────────────────────────────────────────────────
  const phaseEnergyBonus = Math.max(0.0, 10.0 - Math.abs(tgtEnergy - candEnergy));

  let phasePopBonus = popularityBonus(stage, candPop);
  if (lastAcceptedWasHymn && candPop >= 7.5) phasePopBonus -= 50.0;

  // ── Bangers : match de phase (+80 / −20) + BANGER_BOOST (+20 fraîcheur) ──────
  let bangerPhaseBonus = 0;
  if (track.isBanger) {
    const inPhase = (track.phase === stage) || (track.phaseAlternate === stage);
    bangerPhaseBonus = inPhase ? 80.0 : -20.0;
  }

  // ── Fraîcheur (0-100) + banger boost + cross-party ──────────────────────────
  let freshnessScore = freshness && freshness[idStr] != null
    ? Number(freshness[idStr].freshnessScore ?? freshness[idStr] ?? 100) : 100;
  if (isSuggestion) freshnessScore = 100; // override guest : bypass fraîcheur
  if (BANGER_BOOST_PHASES.has(stage) && track.isBanger) freshnessScore += 20;
  const staleness = freshness && freshness[idStr] ? freshness[idStr].partyStaleness : null;
  const crossPartyPenalty = isSuggestion ? 0 : crossPartyMalus(staleness);

  // ── Pénalités dures / anti-saturation ──────────────────────────────────────
  const isLounge = LOUNGE_JAZZ.has((genre || '').toLowerCase());
  const blockLounge = isLounge && (stage === 'takeoff' || stage === 'groove' || stage === 'party');
  const blockMissingArtist = !track.artist || track.artist === 'Unknown';
  const unknownPenalty = (blockLounge || blockMissingArtist) ? -1000000.0 : 0.0;

  const artistTs = recentArtistTimestamps ? recentArtistTimestamps[artistKey] : null;
  const artistMinutesAgo = artistTs ? (nowMs - artistTs) / 60000 : 999;
  const artistCooldownPenalty = artistMinutesAgo < ARTIST_COOLDOWN_MINUTES ? -200.0 : 0.0;

  const last2Artists = (recentArtists || []).slice(-2);
  const consecutiveArtistMalus = (last2Artists.length >= 2 && artistKey
    && last2Artists.every((a) => a === artistKey)) ? -200.0 : 0.0;

  const lg = (candidateGenre || '').toLowerCase();
  const last3Genres = (recentGenres || []).slice(-3);
  const last2Genres = (recentGenres || []).slice(-2);
  let consecutiveGenreMalus = 0;
  if (lg) {
    if (last3Genres.length >= 3 && last3Genres.every((g) => (g || '').toLowerCase() === lg)) consecutiveGenreMalus = -100.0;
    else if (last2Genres.length >= 2 && last2Genres.every((g) => (g || '').toLowerCase() === lg)) consecutiveGenreMalus = -30.0;
  }

  const titleKey = normalizeTitle(track.title);
  const sameSongPenalty = (playedSongTitles && playedSongTitles.has(titleKey)) ? -500.0 : 0.0;

  const arrivalEnergyPenalty = (stage === 'arrival' && candEnergy > 6) ? -40.0 : 0.0;

  // ── Lissage BPM vs titre courant ────────────────────────────────────────────
  let bpmJumpPenalty = 0;
  if (!firstTrack && currentBPM > 0 && track.bpm > 0) {
    const lastBPM = effectiveBPM(currentBPM) || currentBPM;
    const delta = Math.abs(effectiveBPM(track.bpm) - lastBPM);
    const pct = (delta / lastBPM) * 100.0;
    if (pct < 6) bpmJumpPenalty = 0;
    else if (pct < 12) bpmJumpPenalty = -100;
    else if (pct < 18) bpmJumpPenalty = -300;
    else bpmJumpPenalty = -1000;
    if (stage === 'arrival') bpmJumpPenalty *= 0.7;
  }

  // ── Provider-aware (NOUVEAU, préférence douce — jamais d'exclusion) ──────────
  const providerBonus = isResolvableOnProvider(track, provider) ? 15.0 : 0.0;

  const score = composite
    + phaseEnergyBonus + phasePopBonus + bangerPhaseBonus
    + unknownPenalty + artistCooldownPenalty + consecutiveArtistMalus + consecutiveGenreMalus
    + arrivalEnergyPenalty + sameSongPenalty
    + suggestionDirectBoost + freshnessScore + crossPartyPenalty + bpmJumpPenalty
    + providerBonus;

  return {
    score,
    breakdown: {
      genreScore, energyScore, bpmProximity, popScore, suggScore, varScore,
      phaseEnergyBonus, phasePopBonus, bangerPhaseBonus, freshnessScore, crossPartyPenalty,
      artistCooldownPenalty, consecutiveArtistMalus, consecutiveGenreMalus,
      arrivalEnergyPenalty, sameSongPenalty, suggestionDirectBoost, bpmJumpPenalty,
      providerBonus, unknownPenalty,
    },
  };
}

/** Un titre est-il résolvable d'emblée sur le provider ? (préférence douce) */
export function isResolvableOnProvider(track, provider) {
  const p = track.providers || {};
  if (provider === 'youtube') return !!p.youtube?.videoId;
  if (provider === 'spotify') return !!p.spotify?.trackId;
  if (provider === 'apple') return !!(p.appleMusic?.trackId || track.appleMusicID);
  return false;
}

/** Normalisation de titre pour la dédup / same-song guard (alphanumérique simple). */
export function normalizeTitle(title) {
  return (title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

export { isPhaseCompatible };
