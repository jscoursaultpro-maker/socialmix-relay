/**
 * routes/djbrain.js
 * ★ DJ Brain Cloud — GET /api/djbrain/next
 *
 * Remplace /api/djbrain-lite/next (gardé en alias). Le serveur DÉRIVE lui-même la phase
 * et l'énergie depuis l'état de soirée (RAM store), charge un pool de candidats Mongo
 * cohérent avec la phase, et applique le scoring du DJ Brain (services/djbrain).
 *
 * Auth : Bearer JWT Supabase (même pattern que /api/resolve).
 *
 * Lot A : dramaturgie complète (phases/énergie/genres/bangers/popularité/continuité/cooldown/
 * bpm-smoothing/provider-aware) + anti-répétition intra-soirée. Lot B : Fresh Rotation cross-party
 * N=8 (clé _id), bonus performance feuRatio, First Track Doctrine.
 */
import { Router } from 'express';
import Track from '../models/Track.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';
import { STAGES, isPhaseCompatible } from '../services/djbrain/phases.js';
import { computeStage } from '../services/djbrain/progression.js';
import { selectNextTracks, formatTrack } from '../services/djbrain/select.js';
import { buildCrossPartyFreshness } from '../services/djbrain/crossPartyFreshness.js';

const router = Router();

const PROVIDERS = ['spotify', 'apple', 'youtube'];
const POOL_LIMIT = 500;
// Champs projetés sur chaque candidat (incl. data moat performance pour le bonus perf Lot B).
const TRACK_PROJECTION = {
  title: 1, artist: 1, durationMs: 1, coverArtURL: 1, phase: 1, phaseAlternate: 1,
  energy: 1, bpm: 1, deezerRank: 1, isBanger: 1, qualityLevel: 1, genre: 1, genreBDD: 1,
  danceability: 1, providers: 1, appleMusicID: 1, isrc: 1,
  // ★ Lot B — bonus performance (applyPerformanceBonus) :
  performance: 1, adminQualified: 1, suggestCount: 1,
};

/**
 * ★ Lot B — First Track Doctrine (Task #61). Premier titre de soirée (aucun titre joué) :
 * pool = arrival + isEmotional + BPM∈]0,85] + suggestable + non-bloqué + deezer dispo,
 * trié deezerRank DESC, pick aléatoire dans le top 20 (port 1:1 de /api/tracks/firstTrackCandidates
 * + selectFirstTrackForArrival côté iOS). Renvoie un doc Track lean formatable, ou null.
 */
async function pickFirstTrack() {
  const candidates = await Track.find({
    phase: 'arrival',
    isEmotional: true,
    bpm: { $gt: 0, $lte: 85 },
    suggestable: { $ne: false },
    isBlocked: { $ne: true },
    'providers.deezer.trackId': { $gt: 0 },
  })
    .sort({ deezerRank: -1 })
    .limit(20)
    .select(TRACK_PROJECTION)
    .lean();
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function requireSupabaseAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'AUTH_MISSING' });
    const payload = await verifySupabaseJWT(authHeader.slice(7));
    req.currentUser = await findOrCreateFromSupabase(payload);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'AUTH_FAILED' });
  }
}

// Rate-limit par utilisateur (20/min) — même prudence que /api/resolve.
const rateLimitMap = new Map();
const RATE_PER_USER = 20;
setInterval(() => rateLimitMap.clear(), 60_000).unref?.();

/** Construit la map suggestions { trackId: {consensus,guestCount,boostCount} } depuis l'état party. */
function buildSuggestionsMap(party) {
  const map = {};
  const list = party?.suggestions || [];
  for (const s of list) {
    const tid = s.trackId || s.trackObjectId || s._id;
    if (!tid) continue;
    map[String(tid)] = {
      consensus: s.consensusScore != null ? s.consensusScore : 60,
      guestCount: Array.isArray(s.suggestedBy) ? s.suggestedBy.length
        : (Array.isArray(s.suggestedByUsers) ? s.suggestedByUsers.length : 1),
      boostCount: Array.isArray(s.boostedByUsers) ? s.boostedByUsers.length : 0,
    };
  }
  return map;
}

router.get('/next', requireSupabaseAuth, async (req, res) => {
  const uid = String(req.currentUser?._id || 'anon');
  const count = (rateLimitMap.get(uid) || 0) + 1;
  rateLimitMap.set(uid, count);
  if (count > RATE_PER_USER) return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });

  try {
    const partyCode = String(req.query.partyCode || '').toUpperCase();
    const provider = PROVIDERS.includes(String(req.query.provider || '').toLowerCase())
      ? String(req.query.provider).toLowerCase() : null;
    const n = Math.min(parseInt(req.query.count, 10) || 5, 20);

    const parties = req.app.get('parties');
    const party = partyCode ? parties?.get(partyCode) : null;

    // ── Dérivation phase + énergie depuis l'état de soirée ────────────────────
    const vibeScore = party?.vibeScore ?? 5;              // 0-10
    const energyLevel = Math.max(0, Math.min(100, vibeScore * 10));
    const sessionStartMs = party?.phaseStartedAt ? new Date(party.phaseStartedAt).getTime()
      : (party?.lifecycle?.startedAt ? new Date(party.lifecycle.startedAt).getTime()
        : (party?.createdAt ? new Date(party.createdAt).getTime() : Date.now()));
    const { stage, elapsedMins } = computeStage({
      baseAutoStage: party?.baseAutoStage || 'arrival',
      sessionStartMs,
      energyLevel,
      override: party?.sessionModeOverride || null,
      locked: party?.isPhaseLocked || false,
    });

    // party.genreVotes est la tally {genre:count} ; guestGenreVotes est {voter:genre} (forme ≠) → ne pas l'utiliser ici.
    const genreVotes = party?.genreVotes || {};
    const trackHistory = party?.trackHistory || []; // NEWEST-FIRST (index 0 = dernier joué)
    const lastHist = trackHistory[0];
    const currentBPM = lastHist?.bpm || party?.currentBPM || 0;
    const suggestions = buildSuggestionsMap(party);

    // ── First Track Doctrine (Lot B / Task #61) ───────────────────────────────
    // Aucun titre encore joué → ouverture dédiée (arrival+emotional+BPM≤85, deezerRank DESC).
    // Le reste de la file est complété par la sélection normale, le titre d'ouverture exclu.
    const isFirstTrack = trackHistory.length === 0;
    let firstTrackFormatted = null;
    if (isFirstTrack) {
      try {
        const ft = await pickFirstTrack();
        if (ft) firstTrackFormatted = formatTrack(ft, 1e9, { firstTrackDoctrine: true });
      } catch (e) { console.warn('[djbrain] First Track Doctrine KO:', e.message); }
    }

    // ── Fresh Rotation cross-party N=8 (Lot B) — map keyée par Track._id ───────
    // Isolation par hôte : l'appelant authentifié EST l'hôte de sa soirée.
    let freshness = {};
    try {
      freshness = await buildCrossPartyFreshness(req.currentUser?._id);
    } catch (e) { console.warn('[djbrain] cross-party freshness KO:', e.message); }

    // ── Pool de candidats cohérent avec la phase ──────────────────────────────
    const allowedPhases = STAGES.filter((p) => isPhaseCompatible(p, stage));
    const filter = {
      isBlocked: { $ne: true },
      suggestable: { $ne: false },
      qualityLevel: { $in: ['platine', 'complete', 'partielle'] },
      $or: [
        { phase: { $in: allowedPhases } },
        { phase: null },
        { phase: { $exists: false } },
      ],
    };
    // Pool représentatif via $sample (PAS trié par popularité : la courbe de popularité par
    // phase doit pouvoir faire remonter des titres peu/moyennement connus — doctrine arrival/groove).
    const pool = await Track.aggregate([
      { $match: filter },
      { $sample: { size: POOL_LIMIT } },
      { $project: TRACK_PROJECTION },
    ]);

    // Si doctrine premier titre active : on complète la file avec la sélection normale,
    // en excluant l'ouverture choisie (évite le doublon en tête de « À suivre »).
    const selectCount = firstTrackFormatted ? Math.max(0, n - 1) : n;
    const result = selectCount > 0 ? selectNextTracks({
      tracks: pool,
      stage,
      energyLevel,
      genreVotes,
      trackHistory,
      currentBPM,
      freshness,            // ★ Lot B : Fresh Rotation cross-party (clé _id)
      suggestions,
      provider,
      count: selectCount + (firstTrackFormatted ? 1 : 0),
    }) : { tracks: [], debug: { pool: pool.length, scored: 0 } };

    let tracks = result.tracks;
    if (firstTrackFormatted) {
      const ftId = String(firstTrackFormatted.trackId);
      tracks = [firstTrackFormatted, ...tracks.filter((t) => String(t.trackId) !== ftId)].slice(0, n);
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      tracks,
      phase: stage,
      energyLevel,
      elapsedMins,
      count: tracks.length,
      partyCode: partyCode || null,
      provider,
      firstTrackDoctrine: !!firstTrackFormatted,
      _debug: { ...result.debug, freshnessTracks: Object.keys(freshness).length },
      _source: 'djbrain-cloud',
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[djbrain] /next erreur :', err.message);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

export default router;
