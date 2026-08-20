// routes/tracks-seed.js
// ★ Chantier 2 (20/08) — GET /api/tracks/seed
// Public endpoint : iOS apps pull the Track catalogue at startup / on seed:updated.
// No auth required — the catalogue is public data (no PII, no secrets).

import { Router } from 'express';
import Track from '../models/Track.js';
import { getSeedVersion } from '../models/Meta.js';

const router = Router();

// Projection : only fields iOS needs for DJ Brain scoring + UI display
const SEED_PROJECTION = {
  _id: 1,
  isrc: 1,
  fallbackHash: 1,
  title: 1,
  artist: 1,
  album: 1,
  artworkUrl: 1,
  coverArtURL: 1,
  genre: 1,
  subGenre: 1,
  era: 1,
  language: 1,
  phase: 1,
  phaseAlternate: 1,
  energy: 1,
  bpm: 1,
  bpmDetected: 1,
  bpmDetectedCount: 1,
  bpmConflict: 1,
  mood: 1,
  tags: 1,
  uiCategoryPrimary: 1,
  uiCategoriesSecondary: 1,
  explicit: 1,
  releaseYear: 1,
  durationSec: 1,
  'performance.feuRatio': 1,
  'performance.totalPlays': 1,
  'providers.deezer.trackId': 1,
  'providers.apple.trackId': 1,
  'providers.spotify.trackId': 1,
  qualityLevel: 1,
  isVerified: 1,
  doctrineVersion: 1,
  suggestable: 1,
  updatedAt: 1,
};

/**
 * GET /api/tracks/seed
 * Query params:
 *   since (number, default 0) — client's last known seedVersion
 *   format ("full" | "diff", default: auto)
 *
 * Returns:
 *   { version, serverTime, count, tracks[] }
 */
router.get('/', async (req, res) => {
  try {
    const since = parseInt(req.query.since, 10) || 0;
    const currentVersion = await getSeedVersion();

    // Client is already up-to-date
    if (since > 0 && since >= currentVersion) {
      return res.json({
        version: currentVersion,
        serverTime: new Date().toISOString(),
        count: 0,
        tracks: [],
      });
    }

    // Full dump (V1 simplifiée — diff smart sera V1.1)
    const tracks = await Track.find({})
      .select(SEED_PROJECTION)
      .lean();

    res.json({
      version: currentVersion,
      serverTime: new Date().toISOString(),
      count: tracks.length,
      tracks,
    });
  } catch (err) {
    console.error(`[TracksSeed] ❌ ${err.message}`);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

export default router;
