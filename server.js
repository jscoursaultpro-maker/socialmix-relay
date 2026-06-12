import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { networkInterfaces } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createPartyState, isValidPartyCode } from './partyState.js';
import { connectDB, restoreParties, startFlushLoop, stopFlushLoop, flushEndedParty } from './db.js';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import Party from './models/Party.js';
import Friendship from './models/Friendship.js';
import Track from './models/Track.js';
import HostPreference from './models/HostPreference.js';
import { startMetrics } from './stress-test/metrics.js';   // no-op unless STRESS_METRICS=1

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FEEDBACK_PATH = join(__dirname, 'socialmix_feedback.json');

// ─── FallbackHash normalization (mirrors EditorialSeedLoader.swift) ────
function fallbackHash(title, artist) {
  const normalize = (s) => s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${normalize(title || '')}_${normalize(artist || '')}`;
}

// ─── Genre normalization — unifies editorial_seed + track_metadata genres ─
const GENRE_MAP = {
  'Electro/Dance': 'Electro', 'Dance':    'Electro', 'Club':        'Electro',
  'Pop FR':        'COCOVARIET', 'Variété Fr': 'COCOVARIET', 'Chanson': 'COCOVARIET',
  'Dancehall':     'Afro',    'Afro House': 'Afro',
  'Latino':        'Latin',   'Reggaeton': 'Reggaeton',
  'R&B':           'R&B',     'Soul':      'R&B',
  'Hip-Hop':       'Hip-Hop', 'Rap':       'Hip-Hop',
  'House':         'House',   'Deep House': 'House', 'Funk': 'Disco',
};
function normalizeGenre(g) { return GENRE_MAP[g] || g || 'Electro'; }

// ─── Admin auth middleware ───────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'socialmix-admin-2026';
const ADMIN_TOKENS   = new Set(); // In-memory tokens (restart invalidates — acceptable)

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !ADMIN_TOKENS.has(token))
    return res.status(401).json({ error: 'Unauthorized — invalid or missing admin token' });
  next();
}


// ─── Seed editorial catalog into MongoDB ────────────────────────────
async function seedEditorialCatalog() {
  try {
    const count = await Track.countDocuments({ source: { $in: ['editorial', 'host-library'] } });
    console.log(`[Seed] 🔄 Running upsert seed (${count} existing tracks in DB)...`);
    // No early return — $setOnInsert is a no-op on existing docs, safe to re-run.

    // Chemin depuis relay-server/ → ../SocialMixApp/SocialMixApp/Resources/
    const seedPath = join(__dirname, '..', 'SocialMixApp', 'SocialMixApp', 'Resources', 'editorial_seed.json');
    let seedData;
    try {
      seedData = JSON.parse(readFileSync(seedPath, 'utf8'));
    } catch {
      // Fallback : même dossier que le serveur
      const altPath = join(__dirname, 'editorial_seed.json');
      try { seedData = JSON.parse(readFileSync(altPath, 'utf8')); }
      catch { console.warn('[Seed] ⚠️ editorial_seed.json not found — skipping editorial seed'); return; }
    }

    const tracks = Array.isArray(seedData) ? seedData : (seedData.tracks || []);
    console.log(`[Seed] 🌱 Seeding ${tracks.length} editorial tracks into MongoDB...`);

    let inserted = 0, skipped = 0;
    for (const t of tracks) {
      if (!t.title || !t.artist) { skipped++; continue; }
      const hash = t.fallbackHash || fallbackHash(t.title, t.artist);
      const genre = normalizeGenre(t.genre);
      const deezerTrackId = t.providers?.deezer?.trackId || null;

      // Build Deezer cover art URL if we have an albumId
      let coverArtURL = null;
      if (t.providers?.deezer?.albumId) {
        coverArtURL = `https://api.deezer.com/album/${t.providers.deezer.albumId}/image`;
      }

      const filter = t.isrc ? { isrc: t.isrc } : { fallbackHash: hash };

      // $set → always enrich genre/bpm/deezerID (even for existing docs)
      // $setOnInsert → only write identity fields on brand-new inserts
      const update = {
        $set: {
          ...(genre                && { genre }),
          ...(t.bpm > 0           && { bpm: t.bpm }),
          ...(t.energy > 0        && { energy: t.energy }),
          ...(deezerTrackId       && { 'providers.deezer.trackId': deezerTrackId }),
          ...(t.providers?.deezer?.albumId && { 'providers.deezer.albumId': t.providers.deezer.albumId }),
          ...(coverArtURL         && { coverArtURL }),
        },
        $setOnInsert: {
          title:       t.title,
          artist:      t.artist,
          fallbackHash: hash,
          ...(t.isrc        && { isrc: t.isrc }),
          ...(t.album       && { album: t.album }),
          ...(t.releaseYear && { releaseYear: t.releaseYear }),
          source: 'editorial',
        },
      };

      try {
        await Track.findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'before' });
        inserted++;
      } catch (e) {
        if (e.code !== 11000) console.error(`[Seed] ❌ ${t.title}: ${e.message}`);
        else skipped++; // Duplicate key — already exists
      }
    }
    console.log(`[Seed] ✅ Editorial seed complete: ${inserted} upserted, ${skipped} skipped`);
  } catch (err) {
    console.error('[Seed] ❌ Seed failed:', err.message);
  }
}

// ★ Phase 3 — Debounced vote aggregation
const pendingRatings = new Map();  // partyCode → Map<trackKey, {feu,cool,bof,genre,hour}>

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3069;

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 10e6,
  pingTimeout: 120000,     // 2 min — tolerate iOS background/network hiccups
  pingInterval: 25000,     // 25s — keep-alive heartbeat
  connectTimeout: 30000,   // 30s — connection handshake timeout
  allowEIO3: false         // EIO4 only (matches iOS client)
});

// ─── Multi-Party State ──────────────────────────────────────────────
const parties = new Map();           // code → PartyState
const partyCleanupTimers = new Map(); // code → setTimeout ID

function markDirty(party) { if (party) party.isDirty = true; }

function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === 'IPv4' && !net.internal) return net.address;
  return 'localhost';
}

// ─── Static files ───────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, 'public')));

// ─── Admin SPA ──────────────────────────────────────────────────────
// Servi depuis /relay-server/admin/ — auth gérée par le SPA via token
app.use('/admin', express.static(join(__dirname, 'admin')));
app.get('/admin', (req, res) => res.sendFile(join(__dirname, 'admin', 'index.html')));
app.get('/admin/*', (req, res) => res.sendFile(join(__dirname, 'admin', 'index.html')));

// ─── Health check ───────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const codes = [...parties.keys()];
  const total = codes.reduce((s, c) => s + parties.get(c).participants.length, 0);
  res.json({ status: 'Social Mix Relay Server 🎧', activeParties: codes.length, codes, totalParticipants: total });
});
app.get('/status', (req, res) => {
  const codes = [...parties.keys()];
  const mongoState = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
  res.json({
    status: 'Social Mix Relay Server 🎧',
    version: 'v15-parity',
    activeParties: codes.length,
    codes,
    uptime: Math.floor(process.uptime()) + 's',
    mongo: mongoState,
    mongoURI: process.env.MONGO_URI ? '✅ configured' : '❌ not set'
  });
});

// GET /api/tracks/snapshot — DJ Brain cache (utilisé au démarrage de soirée)
// Règle : réponse < 3s garantie par timeout côté iOS. Si Mongo KO → fallback JSON.
app.get('/api/tracks/snapshot', async (req, res) => {
  try {
    const genres   = req.query.genres ? req.query.genres.split(',') : [];
    const limit     = Math.min(parseInt(req.query.limit) || 500, 1000);
    const adminOnly = req.query.adminOnly === 'true';

    const filter = {};
    if (genres.length > 0) filter.genre = { $in: genres };
    if (adminOnly) filter.adminQualified = true;

    const tracks = await Track.find(filter)
      .sort({ adminQualified: -1, 'performance.feuRatio': -1, 'performance.totalPlays': -1 })
      .limit(limit)
      .select('isrc fallbackHash title artist genre bpm energy coverArtURL providers source adminQualified tags partyMoment suggestCount performance.totalPlays performance.feuRatio performance.avgVibeAtPlay performance.genreContexts performance.hourBuckets')
      .lean();

    console.log(`[API] 📊 Snapshot: ${tracks.length} tracks (genres: ${genres.join(',') || 'all'}, adminOnly: ${adminOnly})`);
    res.json({ tracks, count: tracks.length, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[API] ❌ Snapshot error:', err.message);
    res.status(500).json({ error: 'Failed to fetch snapshot' });
  }
});

// ─── Admin API ────────────────────────────────────────────────────────

// POST /api/admin/auth — obtenir un token admin
app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD)
    return res.status(403).json({ error: 'Invalid password' });
  const token = randomUUID();
  ADMIN_TOKENS.add(token);
  // Tokens expirent après 24h
  setTimeout(() => ADMIN_TOKENS.delete(token), 24 * 60 * 60 * 1000);
  res.json({ token });
});

// GET /api/admin/tracks — liste paginée avec filtres
app.get('/api/admin/tracks', adminAuth, async (req, res) => {
  try {
    const page    = Math.max(1, parseInt(req.query.page) || 1);
    const limit   = Math.min(parseInt(req.query.limit) || 50, 200);
    const skip    = (page - 1) * limit;
    const genre   = req.query.genre;
    const status  = req.query.status; // 'qualified' | 'unqualified' | 'all'
    const search  = req.query.search;
    const sortBy  = req.query.sort || 'energy_asc'; // energy_asc, feu_desc, plays_desc, title_asc

    const filter = {};
    if (genre && genre !== 'all') filter.genre = genre;
    if (status === 'qualified')   filter.adminQualified = true;
    if (status === 'unqualified') filter.$or = [{ adminQualified: false }, { energy: 0 }, { bpm: 0 }];
    if (status === 'exotic')      filter.isGuessed = true;
    if (search) filter.$or = [
      { title:  { $regex: search, $options: 'i' } },
      { artist: { $regex: search, $options: 'i' } }
    ];

    const sortMap = {
      energy_asc:  { adminQualified: 1, energy: 1 },
      feu_desc:    { 'performance.feuRatio': -1 },
      plays_desc:  { 'performance.totalPlays': -1 },
      title_asc:   { title: 1 },
    };
    const sort = sortMap[sortBy] || sortMap.energy_asc;

    const [tracks, total] = await Promise.all([
      Track.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Track.countDocuments(filter)
    ]);

    res.json({ tracks, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[Admin] ❌ tracks list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/tracks/:id — qualifier/éditer un titre
app.patch('/api/admin/tracks/:id', adminAuth, async (req, res) => {
  try {
    const { genre, bpm, energy, tags, adminQualified, partyMoment, coverArtURL } = req.body;
    const update = { $set: {} };
    if (genre        !== undefined) update.$set.genre         = normalizeGenre(genre);
    if (bpm          !== undefined) update.$set.bpm           = Number(bpm);
    if (energy       !== undefined) update.$set.energy        = Math.min(10, Math.max(0, Number(energy)));
    if (tags         !== undefined) update.$set.tags          = tags;
    if (adminQualified !== undefined) update.$set.adminQualified = Boolean(adminQualified);
    if (partyMoment  !== undefined) update.$set.partyMoment   = partyMoment;
    if (coverArtURL  !== undefined) update.$set.coverArtURL   = coverArtURL;
    const track = await Track.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!track) return res.status(404).json({ error: 'Track not found' });
    res.json(track);
  } catch (err) {
    console.error('[Admin] ❌ track update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/stats — dashboard stats
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const [total, qualified, noEnergy, noBpm, byGenre, topFeu, recentParties] = await Promise.all([
      Track.countDocuments(),
      Track.countDocuments({ adminQualified: true }),
      Track.countDocuments({ energy: 0 }),
      Track.countDocuments({ bpm: 0 }),
      Track.aggregate([
        { $group: { _id: '$genre', count: { $sum: 1 }, qualified: { $sum: { $cond: ['$adminQualified', 1, 0] } } } },
        { $sort: { count: -1 } }
      ]),
      Track.find({ 'performance.totalPlays': { $gt: 0 } })
        .sort({ 'performance.feuRatio': -1 })
        .limit(10)
        .select('title artist genre performance.feuRatio performance.totalPlays')
        .lean(),
      Party.find({ endedAt: { $ne: null } })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('code createdAt endedAt trackHistory participants')
        .lean()
    ]);
    res.json({ total, qualified, noEnergy, noBpm, byGenre, topFeu, recentParties });
  } catch (err) {
    console.error('[Admin] ❌ stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/parties — historique des soirées
app.get('/api/admin/parties', adminAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const parties = await Party.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('code createdAt endedAt trackHistory participants suggestions vibeScore')
      .lean();
    res.json({ parties, count: parties.length });
  } catch (err) {
    console.error('[Admin] ❌ parties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/analytics — performance globale
app.get('/api/admin/analytics', adminAuth, async (req, res) => {
  try {
    const [byGenre, topSuggested, topPlayed] = await Promise.all([
      Track.aggregate([
        { $match: { 'performance.totalPlays': { $gt: 0 } } },
        { $group: {
          _id: '$genre',
          avgFeuRatio:  { $avg: '$performance.feuRatio' },
          totalPlays:   { $sum: '$performance.totalPlays' },
          trackCount:   { $sum: 1 }
        }},
        { $sort: { avgFeuRatio: -1 } }
      ]),
      Track.find({ suggestCount: { $gt: 0 } })
        .sort({ suggestCount: -1 })
        .limit(20)
        .select('title artist genre suggestCount performance.feuRatio')
        .lean(),
      Track.find({ 'performance.totalPlays': { $gt: 0 } })
        .sort({ 'performance.totalPlays': -1 })
        .limit(20)
        .select('title artist genre performance.totalPlays performance.feuRatio')
        .lean()
    ]);
    res.json({ byGenre, topSuggested, topPlayed });
  } catch (err) {
    console.error('[Admin] ❌ analytics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/deezer/preview/:trackId — proxy preview URL pour le player admin
app.get('/api/admin/deezer/preview/:trackId', adminAuth, async (req, res) => {
  try {
    const r = await fetch(`https://api.deezer.com/track/${req.params.trackId}`);
    const data = await r.json();
    res.json({ preview: data.preview || null, cover: data.album?.cover_medium || null });
  } catch (err) {
    res.status(500).json({ error: 'Deezer preview fetch failed' });
  }
});

// GET /api/monitor/stream/:trackId — streaming proxy audio (évite CORS Deezer CDN)
app.get('/api/monitor/stream/:trackId', adminAuth, async (req, res) => {
  try {
    // 1. Récupérer l'URL de preview depuis l'API Deezer
    const metaRes  = await fetch(`https://api.deezer.com/track/${req.params.trackId}`);
    const meta     = await metaRes.json();
    const previewUrl = meta.preview;
    if (!previewUrl) return res.status(404).json({ error: 'No preview available' });

    // 2. Streamer l'audio depuis Deezer CDN
    const audioRes = await fetch(previewUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!audioRes.ok) return res.status(502).json({ error: `Deezer CDN returned ${audioRes.status}` });

    // 3. Retransmettre les headers et le body
    res.setHeader('Content-Type', audioRes.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Content-Length', audioRes.headers.get('content-length') || '');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');

    // Pipe le stream directement
    const { Readable } = await import('stream');
    const webStream = audioRes.body;
    const nodeStream = Readable.fromWeb(webStream);
    nodeStream.pipe(res);
  } catch (err) {
    console.error('[Monitor Stream] ❌', err.message);
    res.status(500).json({ error: 'Stream failed: ' + err.message });
  }
});


// GET /api/admin/itunes/preview — fetch preview from Apple Music (iTunes Search API)
app.get('/api/admin/itunes/preview', adminAuth, async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q) return res.json({ preview: null });
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=1`);
    const data = await r.json();
    if (data.results && data.results.length > 0) {
      const track = data.results[0];
      res.json({ preview: track.previewUrl || null, cover: track.artworkUrl100 || null });
    } else {
      res.json({ preview: null });
    }
  } catch (err) {
    res.status(500).json({ error: 'iTunes preview fetch failed' });
  }
});

// ─── Monitor Curation API (curated_base_v3.json) ────────────────────────────
const CURATED_DB_PATH = join(__dirname, 'curated_base_v3.json');

function loadCuratedDB() {
  try { return JSON.parse(readFileSync(CURATED_DB_PATH, 'utf-8')); }
  catch { return { tracks: [] }; }
}
function saveCuratedDB(db) {
  db.generatedAt = new Date().toISOString();
  writeFileSync(CURATED_DB_PATH, JSON.stringify(db, null, 2));
}

// GET /api/monitor/tracks — liste paginée avec filtres
app.get('/api/monitor/tracks', adminAuth, (req, res) => {
  const db      = loadCuratedDB();
  const tracks  = db.tracks || [];
  const filter  = req.query.filter  || 'needs_review'; // 'needs_review' | 'all'
  const genre   = req.query.genre   || '';
  const search  = req.query.search  || '';
  const page    = Math.max(1, parseInt(req.query.page) || 1);
  const limit   = Math.min(parseInt(req.query.limit) || 50, 200);

  let filtered = tracks;
  if (filter === 'needs_review') filtered = filtered.filter(t => t.needs_review);
  if (genre && genre !== 'all')  filtered = filtered.filter(t => t.genre === genre);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(t =>
      (t.title  || '').toLowerCase().includes(q) ||
      (t.artist || '').toLowerCase().includes(q)
    );
  }

  const total = filtered.length;
  const paged = filtered.slice((page - 1) * limit, page * limit);

  // Stats
  const needsReviewTotal = tracks.filter(t => t.needs_review).length;
  const genres = {};
  tracks.forEach(t => { genres[t.genre || ''] = (genres[t.genre || ''] || 0) + 1; });

  res.json({ tracks: paged, total, page, pages: Math.ceil(total / limit), needsReviewTotal, genreStats: genres });
});

// GET /api/monitor/track/:deezerID — un track par ID
app.get('/api/monitor/track/:deezerID', adminAuth, (req, res) => {
  const db  = loadCuratedDB();
  const id  = parseInt(req.params.deezerID);
  const t   = db.tracks.find(t => t.deezerID === id);
  if (!t) return res.status(404).json({ error: 'Track not found' });
  res.json(t);
});

// PATCH /api/monitor/track/:deezerID — sauvegarder les modifications
app.patch('/api/monitor/track/:deezerID', adminAuth, (req, res) => {
  const db  = loadCuratedDB();
  const id  = parseInt(req.params.deezerID);
  const t   = db.tracks.find(t => t.deezerID === id);
  if (!t) return res.status(404).json({ error: 'Track not found' });

  const { genre, energy, phase, needs_review, bpm } = req.body;
  if (genre        !== undefined) t.genre        = genre;
  if (energy       !== undefined) t.energy       = Math.min(10, Math.max(1, Number(energy)));
  if (phase        !== undefined) t.phase        = phase;
  if (needs_review !== undefined) t.needs_review = Boolean(needs_review);
  // BPM uniquement si manquant
  if (bpm !== undefined && bpm > 0 && (!t.bpm || t.bpm === 0)) t.bpm = Number(bpm);

  saveCuratedDB(db);
  console.log(`[Monitor] ✅ Track ${id} updated: genre=${t.genre} energy=${t.energy} phase=${t.phase} needs_review=${t.needs_review}`);
  res.json(t);
});

// GET /api/monitor/stats — stats globales de la base
app.get('/api/monitor/stats', adminAuth, (req, res) => {
  const db = loadCuratedDB();
  const tracks = db.tracks || [];
  const genres = {}, phases = {};
  let needsReview = 0, withBPM = 0, withEnergy = 0, withPhase = 0;

  tracks.forEach(t => {
    genres[t.genre || ''] = (genres[t.genre || ''] || 0) + 1;
    phases[t.phase || ''] = (phases[t.phase || ''] || 0) + 1;
    if (t.needs_review) needsReview++;
    if (t.bpm > 0)    withBPM++;
    if (t.energy > 0) withEnergy++;
    if (t.phase)      withPhase++;
  });

  res.json({ total: tracks.length, needsReview, withBPM, withEnergy, withPhase, genres, phases });
});
// ────────────────────────────────────────────────────────────────────────────

// ★ Phase 3 — GET /api/host/:hostId/preferences
app.get('/api/host/:hostId/preferences', async (req, res) => {
  try {
    const prefs = await HostPreference.findOne({ hostId: req.params.hostId }).lean();
    res.json(prefs || { hostId: req.params.hostId, genreBoosts: {}, boostedISRCs: [], bannedISRCs: [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});
// ─── Deezer Proxy ───────────────────────────────────────────────────

// ★ D4: Server-side karaoke/cover filter (mirrors iOS SuggestionFilter.isClean)
const BANNED_KEYWORDS = [
  'karaoke', 'instrumental', 'cover', 'tribute', 'lullaby', 'slowed',
  'sped up', 'reverb', '8d audio', 'nightcore', 'acoustic version',
  'piano version', 'performance live',
  'karaoke version', 'karaoke mix', 'version karaoke',
  'in the style of', 'originally performed by', 'originally performed',
  'made famous by', 'as performed by', 'as made famous',
  'backing track', 'without vocals', 'sing along',
  'rendu celebre', 'playback', 'tribute version', 'instrumental version',
  'acapella', 'a cappella', 'sped'
];

function isDeezerTrackClean(track) {
  const title = track.title || '';
  const artist = track.artist?.name || '';
  const album = track.album?.title || '';
  // Normalize: lowercase, remove diacritics, replace separators with spaces
  const raw = `${title} ${artist} ${album}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .toLowerCase()
    .replace(/[-_.]/g, ' ');
  for (const kw of BANNED_KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(raw)) return false;
  }
  return true;
}

app.get('/api/deezer/search', async (req, res) => {
  const q = req.query.q || '', limit = parseInt(req.query.limit) || 6;
  try {
    // Over-request to compensate for filtered-out karaoke tracks
    const fetchLimit = Math.min(limit * 3, 25);
    const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${fetchLimit}&order=RANKING`);
    const json = await r.json();
    if (json.data) {
      const before = json.data.length;
      json.data = json.data.filter(isDeezerTrackClean);
      // ★ Dedup by title+artist (Deezer returns same song from multiple albums)
      const seen = new Set();
      json.data = json.data.filter(t => {
        const key = `${(t.title||'').toLowerCase()}_${((t.artist||{}).name||'').toLowerCase()}`
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
        return seen.has(key) ? false : (seen.add(key), true);
      }).slice(0, limit);
      if (before !== json.data.length) console.log(`[Deezer] 🚫 Filtered ${before - json.data.length} karaoke/dupe tracks for "${q}"`);
    }
    res.json(json);
  }
  catch (err) { console.error('[Deezer] Search error:', err.message); res.status(500).json({ error: 'Deezer search failed' }); }
});
app.get('/api/deezer/chart', async (req, res) => {
  const limit = parseInt(req.query.limit) || 8;
  try {
    const r = await fetch(`https://api.deezer.com/chart/0/tracks?limit=${Math.min(limit * 2, 20)}`);
    const json = await r.json();
    if (json.data) json.data = json.data.filter(isDeezerTrackClean).slice(0, limit);
    res.json(json);
  }
  catch (err) { console.error('[Deezer] Chart error:', err.message); res.status(500).json({ error: 'Deezer chart failed' }); }
});

app.get('/api/party/:code/explore', async (req, res) => {
  const code = req.params.code;
  const limit = parseInt(req.query.limit) || 10;
  
  try {
    const state = parties.get(code);
    let targetGenre = "House"; // Default
    if (state && state.currentTrack && state.currentTrack.genre) {
        targetGenre = state.currentTrack.genre;
    } else if (state && state.trackHistory && state.trackHistory.length > 0) {
        targetGenre = state.trackHistory[state.trackHistory.length - 1].genre || "House";
    }

    if (!fs.existsSync(CURATED_DB_PATH)) {
        return res.status(404).json({ error: 'DB not found' });
    }
    
    const db = JSON.parse(fs.readFileSync(CURATED_DB_PATH, 'utf-8'));
    const pool = db.tracks.filter(t => t.genre === targetGenre);
    
    // Fisher-Yates Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    
    const selected = pool.slice(0, limit);
    
    // Map to Deezer-like format expected by GuestViews.swift
    const data = selected.map(t => ({
        id: t.deezerID,
        title: t.title,
        artist: { name: t.artist },
        album: { cover_medium: null }, // UI will use fallback
        duration: t.duration || 0,
        bpm: Math.round(t.bpm || 0)
    }));
    
    res.json({ data });
  } catch (err) {
    console.error('[Explore] Error:', err.message);
    res.status(500).json({ error: 'Explore failed' });
  }
});

app.get('/api/state', (req, res) => {
  const code = req.query.code;
  if (code && parties.has(code)) return res.json(parties.get(code));
  // Legacy: return first party or empty
  const first = parties.values().next().value;
  res.json(first || { code: null, participants: [] });
});

// ─── Auth Middleware (session token) ────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'Missing session token' });
  
  for (const [code, party] of parties) {
    const participant = party.participants.find(p => p.sessionToken === token);
    if (participant) {
      req.userId = participant.userId || participant.id;
      req.guestName = participant.name;
      req.partyCode = code;
      req.sessionToken = token;
      return next();
    }
  }
  return res.status(401).json({ error: 'Invalid or expired session token' });
}

// ─── Push Notification Stubs (Phase 2) ──────────────────────────────
function notifyFriendRequest(targetUserId, fromName) {
  console.log(`[Push] 📩 ${fromName} t'a ajouté en ami (target: ${targetUserId})`);
}
function notifyFriendAccepted(requesterId, acceptedByName) {
  console.log(`[Push] ✅ ${acceptedByName} a accepté ta demande (requester: ${requesterId})`);
}

// ─── Friends API ────────────────────────────────────────────────────

// In-memory friendship store (works without MongoDB)
const friendships = [];
let friendshipIdCounter = 1;

function genFriendId() { return 'fr_' + (friendshipIdCounter++) + '_' + Date.now().toString(36); }

// POST /api/friends/request — Send a friend request
app.post('/api/friends/request', authMiddleware, (req, res) => {
  const { targetUserId, partyCode } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
  if (targetUserId === req.userId) return res.status(400).json({ error: 'Cannot friend yourself' });
  
  const [userA, userB] = [req.userId, targetUserId].sort();
  
  const existing = friendships.find(f => f.userA === userA && f.userB === userB);
  if (existing) {
    if (existing.status === 'declined') {
      existing.status = 'pending';
      existing.requestedBy = req.userId;
      existing.createdAt = new Date().toISOString();
      existing.acceptedAt = null;
      notifyFriendRequest(targetUserId, req.guestName);
      return res.json({ ok: true, friendship: existing, reactivated: true });
    }
    return res.status(409).json({ error: 'Friendship already exists', status: existing.status });
  }
  
  const friendship = {
    _id: genFriendId(),
    userA, userB,
    status: 'pending',
    requestedBy: req.userId,
    metAt: partyCode || req.partyCode || null,
    createdAt: new Date().toISOString(),
    acceptedAt: null
  };
  friendships.push(friendship);
  
  // Async persist to MongoDB if available
  Friendship.create(friendship).catch(() => {});
  
  notifyFriendRequest(targetUserId, req.guestName);
  console.log(`👥 [Friends] ${req.guestName} → request → ${targetUserId}`);
  res.json({ ok: true, friendship });
});

// POST /api/friends/accept — Accept a friend request
app.post('/api/friends/accept', authMiddleware, (req, res) => {
  const { friendshipId } = req.body;
  if (!friendshipId) return res.status(400).json({ error: 'friendshipId required' });
  
  const friendship = friendships.find(f => f._id === friendshipId);
  if (!friendship) return res.status(404).json({ error: 'Friendship not found' });
  
  if (friendship.requestedBy === req.userId) {
    return res.status(403).json({ error: 'Cannot accept your own request' });
  }
  if (friendship.userA !== req.userId && friendship.userB !== req.userId) {
    return res.status(403).json({ error: 'Not your friendship' });
  }
  
  friendship.status = 'accepted';
  friendship.acceptedAt = new Date().toISOString();
  
  Friendship.findOneAndUpdate(
    { userA: friendship.userA, userB: friendship.userB },
    { status: 'accepted', acceptedAt: friendship.acceptedAt }
  ).catch(() => {});
  
  notifyFriendAccepted(friendship.requestedBy, req.guestName);
  console.log(`👥 [Friends] ${req.guestName} accepted friendship ${friendshipId}`);
  res.json({ ok: true, friendship });
});

// POST /api/friends/decline — Decline a friend request
app.post('/api/friends/decline', authMiddleware, (req, res) => {
  const { friendshipId } = req.body;
  if (!friendshipId) return res.status(400).json({ error: 'friendshipId required' });
  
  const friendship = friendships.find(f => f._id === friendshipId);
  if (!friendship) return res.status(404).json({ error: 'Friendship not found' });
  if (friendship.userA !== req.userId && friendship.userB !== req.userId) {
    return res.status(403).json({ error: 'Not your friendship' });
  }
  
  friendship.status = 'declined';
  
  Friendship.findOneAndUpdate(
    { userA: friendship.userA, userB: friendship.userB },
    { status: 'declined' }
  ).catch(() => {});
  
  console.log(`👥 [Friends] ${req.guestName} declined friendship ${friendshipId}`);
  res.json({ ok: true });
});

// GET /api/friends/list — My accepted friends
app.get('/api/friends/list', authMiddleware, (req, res) => {
  const friends = friendships.filter(f =>
    (f.userA === req.userId || f.userB === req.userId) && f.status === 'accepted'
  );
  
  const enriched = friends.map(f => {
    const friendUserId = f.userA === req.userId ? f.userB : f.userA;
    const profile = findUserProfile(friendUserId);
    return {
      _id: f._id,
      friendUserId,
      friendName: profile?.name || 'Unknown',
      friendEmoji: profile?.emoji || '🎉',
      friendPhoto: profile?.photo || null,
      metAt: f.metAt,
      acceptedAt: f.acceptedAt,
      createdAt: f.createdAt
    };
  });
  
  res.json({ ok: true, friends: enriched });
});

// GET /api/friends/pending — Received friend requests
app.get('/api/friends/pending', authMiddleware, (req, res) => {
  const pending = friendships.filter(f =>
    (f.userA === req.userId || f.userB === req.userId) &&
    f.status === 'pending' &&
    f.requestedBy !== req.userId
  );
  
  const enriched = pending.map(f => {
    const profile = findUserProfile(f.requestedBy);
    return {
      _id: f._id,
      fromUserId: f.requestedBy,
      fromName: profile?.name || 'Unknown',
      fromEmoji: profile?.emoji || '🎉',
      fromPhoto: profile?.photo || null,
      metAt: f.metAt,
      createdAt: f.createdAt
    };
  });
  
  res.json({ ok: true, pending: enriched });
});

// DELETE /api/friends/:id — Remove a friendship
app.delete('/api/friends/:id', authMiddleware, (req, res) => {
  const idx = friendships.findIndex(f => f._id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Friendship not found' });
  
  const friendship = friendships[idx];
  if (friendship.userA !== req.userId && friendship.userB !== req.userId) {
    return res.status(403).json({ error: 'Not your friendship' });
  }
  
  friendships.splice(idx, 1);
  
  Friendship.findOneAndDelete(
    { userA: friendship.userA, userB: friendship.userB }
  ).catch(() => {});
  
  console.log(`👥 [Friends] ${req.guestName} removed friendship ${req.params.id}`);
  res.json({ ok: true });
});

// Helper: find user profile from active parties
function findUserProfile(userId) {
  for (const party of parties.values()) {
    const p = party.participants.find(p => p.userId === userId || p.id === userId);
    if (p) return { name: p.name, emoji: p.emoji, photo: p.photo };
  }
  return null;
}


// ─── Helpers (party-scoped) ─────────────────────────────────────────
function addPhotoToParty(party, photo) {
  const url = photo.dataURL || '';
  const mid = Math.floor(url.length / 2);
  const hash = url.length + ':' + url.substring(mid, mid + 80);
  if (party.photoHashes.has(hash)) return false;
  party.photoHashes.add(hash);
  party.photos.push(photo);
  return true;
}

function addPoints(party, participantId, name, points, reason) {
  // ★ E1 FIX: When participantId is 'host', ALWAYS use 'DJ' as the name.
  // Never let a custom guestName (e.g. "🎧 Jean Sebastien") overwrite the host entry.
  const isHost = participantId === 'host';
  const normalizedName = isHost ? 'DJ' : (name || participantId || 'Guest').trim();
  let key;
  if (isHost) { key = 'host'; }
  else {
    // First try exact name match, then fall back to participantId match
    const byName = Object.entries(party.participantScores).find(([k, v]) => k === normalizedName || v.name === normalizedName);
    const byId = Object.entries(party.participantScores).find(([, v]) => v.participantId === participantId);
    key = byName ? byName[0] : (byId ? byId[0] : normalizedName);
  }
  if (!party.participantScores[key]) party.participantScores[key] = { name: normalizedName, score: 0, voteCount: 0, participantId: participantId || key };
  party.participantScores[key].score += points;
  // ★ E1 FIX: Host entry name is FROZEN to 'DJ'. For guests, update name normally.
  if (isHost) {
    if (party.participantScores[key].name !== 'DJ') {
      console.log(`[addPoints] ⚠️ host entry name was "${party.participantScores[key].name}" — forced to "DJ" (auto-heal)`);
      party.participantScores[key].name = 'DJ';
    }
  } else if (name && name !== 'DJ' && name !== 'Guest') {
    party.participantScores[key].name = normalizedName;
  }
  if (participantId) party.participantScores[key].participantId = participantId;
  console.log(`⭐ [${party.code}] +${points}pts → ${normalizedName} (${reason}) [total: ${party.participantScores[key].score}]`);
  broadcastLeaderboard(party);
}

function broadcastLeaderboard(party) {
  // ★ E1: Resolve host's real display name from party data (internal name is frozen to "DJ")
  const hostParticipant = party.participants.find(p => p.isHost);
  const hostDisplayName = party.hostProfile?.name || hostParticipant?.name || 'DJ';
  
  // ★ E1 AUTO-HEAL: Merge any ghost host entries into the real 'host' key.
  // Ghost entries were created before the E1 fix when addPoints renamed the host entry.
  const hostNameNorm = hostDisplayName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const hostEntry = party.participantScores['host'];
  if (hostEntry) {
    for (const [key, entry] of Object.entries(party.participantScores)) {
      if (key === 'host') continue;
      // Check if this entry's name matches the host (strip emoji prefix, normalize)
      const entryNameNorm = (entry.name || '').replace(/^[\p{Emoji}\s]+/u, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      if (entryNameNorm && (entryNameNorm === hostNameNorm || hostNameNorm.includes(entryNameNorm) || entryNameNorm.includes(hostNameNorm))) {
        console.log(`[E1 auto-heal] Merging ghost entry "${entry.name}" (${entry.score}pts) into host entry (${hostEntry.score}pts)`);
        hostEntry.score += entry.score;
        delete party.participantScores[key];
      }
    }
  }
  
  const lb = Object.values(party.participantScores)
    .map(d => ({
      id: d.participantId === 'host' ? 'host' : d.name,
      name: d.participantId === 'host' ? hostDisplayName : d.name,
      points: d.score
    }))
    .sort((a, b) => b.points - a.points);
  party.leaderboard = lb;
  io.to(`guest:${party.code}`).emit('leaderboard:update', lb);
  io.to(`host:${party.code}`).emit('leaderboard:update', lb);
}

const GENRE_VOTE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function recomputeGenreVotes(party) {
  const now = Date.now();
  const totals = {};
  const expiry = party.guestGenreVoteExpiry || {};

  // N'inclure que les votes NON expirés
  if (party.guestGenreVotes) {
    for (const [voterKey, genre] of Object.entries(party.guestGenreVotes)) {
      const exp = expiry[voterKey];
      // L'hôte (__HOST__) ne jamais expire ; les guests ont un TTL 30min
      if (voterKey !== '__HOST__' && exp && now > exp) continue;
      totals[genre] = (totals[genre] || 0) + 1;
    }
  }

  // Calculer le genre dominant
  const dominant = Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  if (dominant) {
    // Mémoriser comme dernier dominant (fallback si votes expirent plus tard)
    party._lastDominantGenre = dominant;
  }

  party.genreVotes = totals;
  party._dominantGenre = dominant || party._lastDominantGenre || null;
  return totals;
}

function getParty(socket) {
  return socket.partyCode ? parties.get(socket.partyCode) : null;
}

function getMutableParty(socket) {
  const party = getParty(socket);
  if (party) party.isDirty = true;
  return party;
}

function cancelCleanup(code) {
  if (partyCleanupTimers.has(code)) { clearTimeout(partyCleanupTimers.get(code)); partyCleanupTimers.delete(code); }
}

// ─── Host Secret Auth ───────────────────────────────────────────────
const hostSecretFailures = new Map(); // socketId → { count, blockedUntil }

function validateHostSecret(socket, data) {
  const socketId = socket.id;
  const party = getParty(socket);
  if (!party) return false;
  
  // Check rate limit — blocked?
  const failure = hostSecretFailures.get(socketId);
  if (failure && failure.blockedUntil && Date.now() < failure.blockedUntil) {
    const remaining = Math.ceil((failure.blockedUntil - Date.now()) / 1000);
    console.warn(`🔒 [${party.code}] Socket ${socketId} blocked for ${remaining}s more`);
    return false;
  }
  
  // Extract secret from payload
  const secret = (typeof data === 'object' && data !== null) ? data.hostSecret : undefined;
  
  if (!secret || secret !== party.hostSecret) {
    // Increment failure count
    const current = hostSecretFailures.get(socketId) || { count: 0 };
    current.count++;
    const lastFour = party.hostSecret ? party.hostSecret.slice(-4) : '????';
    console.warn(`🔒 [${party.code}] Invalid host secret attempt ${current.count}/5 from ${socketId} (expected: ****${lastFour})`);
    
    if (current.count >= 5) {
      current.blockedUntil = Date.now() + 5 * 60 * 1000; // 5 min
      hostSecretFailures.set(socketId, current);
      console.warn(`🔒 [${party.code}] Socket ${socketId} BLOCKED for 5 min after 5 failed attempts`);
      socket.emit('auth:error', { error: 'HOST_AUTH_BLOCKED', message: 'Trop de tentatives. Déconnexion 5 min.' });
      socket.disconnect(true);
      return false;
    }
    hostSecretFailures.set(socketId, current);
    socket.emit('auth:error', { error: 'HOST_AUTH_FAILED', message: 'Secret hôte invalide.' });
    return false;
  }
  
  // Valid — reset failure counter
  hostSecretFailures.delete(socketId);
  return true;
}


// Strip hostSecret from payload before broadcasting to guests
function stripSecret(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  const { hostSecret, ...clean } = obj;
  return clean;
}

// Build a lightweight party:state payload for WebSocket sync.
// CRITICAL: Photos in base64 can push the payload to >1MB, which exceeds
// the iOS URLSessionWebSocketTask default limit (1MB) and causes silent
// message drops → host never receives state → all sync breaks.
//
// This function:
// 1. Replaces photos[] with photosMeta[] (guestName + timestamp only, no base64)
// 2. Caps trackHistory to the last 20 entries
// 3. Strips participants' profile photos (keep just name, emoji, id)
// 4. Removes internal server fields
function buildLightState(party) {
  // Lightweight participants
  const lightParticipants = (party.participants || []).map(p => ({
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    isHost: p.isHost || false,
    connected: p.connected !== false,
    partyCode: p.partyCode,
    joinedAt: p.joinedAt,
    photo: p.photo
  }));

  // Cap track history to last 20
  const recentHistory = (party.trackHistory || []).slice(-20);

  const light = {
    code: party.code,
    participants: lightParticipants,
    suggestions: party.suggestions || [],
    trackHistory: recentHistory,
    currentTrack: party.currentTrack || null,
    genreVotes: party.genreVotes || {},
    guestGenreVotes: party.guestGenreVotes || {},
    guestVotes: party.guestVotes || {},
    costumeEntries: party.costumeEntries || [],
    leaderboard: party.leaderboard || [],
    hostProfile: party.hostProfile || null,
    // Recent messages (last 50) for resync
    messages: (party.messages || []).slice(-50),
    // Strip legacy Base64 dataURLs to prevent massive payloads and socket crashes
    photos: (party.photos || []).map(p => {
      const cleanPhoto = { ...p };
      if (cleanPhoto.dataURL && cleanPhoto.dataURL.length > 500) {
        delete cleanPhoto.dataURL;
      }
      return cleanPhoto;
    }),
    photosCount: (party.photos || []).length,
    playedKeys: party.playedKeys || []   // ★ Phase 3: anti-replay keys
  };

  const sizeKB = Math.round(JSON.stringify(light).length / 1024);
  console.log(`📦 [${party.code}] buildLightState: ${sizeKB} KB (${lightParticipants.length} participants, ${(party.photos || []).length} photos, ${recentHistory.length} tracks, ${(party.suggestions || []).length} suggestions)`);

  return light;
}



// ─── Socket.IO Connection Handling ──────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  // Auto-join host room: if ANY host: prefixed event is received,
  // ensure this socket is in the 'host' room (resilient to server restarts)
  function ensureHostRoom() {
    if (!socket.rooms.has('host')) {
      socket.join('host');
      console.log(`🏠 Auto-joined socket ${socket.id} to host room`);
    }
  }

  // Intercept all host: events to auto-join room + validate hostSecret
  const origOn = socket.on.bind(socket);
  socket.on = function(event, handler) {
    if (event.startsWith('host:')) {
      return origOn(event, (...args) => {
        ensureHostRoom();
        // host:startParty sets the secret — skip validation
        if (event === 'host:startParty') {
          handler(...args);
          return;
        }
        // All other host:* events require valid hostSecret
        const payload = args[0];
        if (!validateHostSecret(socket, payload)) return;
        handler(...args);
      });
    }
    return origOn(event, handler);
  };

  // ═══════════════════════════════════════════════════════════════════
  // HOST EVENTS
  // ═══════════════════════════════════════════════════════════════════

  socket.on('host:startParty', (data) => {
    const code = (data.code || 'TEUF2025').toUpperCase();
    socket.partyCode = code;
    socket.join(`host:${code}`);
    cancelCleanup(code);

    const existing = parties.get(code);
    const hostName = data.profile?.name || 'Hôte';
    const hostEmoji = data.profile?.emoji || '🎧';

    // ── RESUME existing party if hostSecret matches ──
    if (existing && existing.hostSecret && data.hostSecret === existing.hostSecret) {
      existing.hostSocketId = socket.id;
      existing.hostProfile = data.profile || existing.hostProfile;
      existing.isDirty = true;

      // Update host participant entry with new socket id
      const hostIdx = existing.participants.findIndex(p => p.isHost);
      if (hostIdx >= 0) {
        existing.participants[hostIdx].id = socket.id;
        existing.participants[hostIdx].connected = true;
      } else {
        existing.participants.unshift({
          id: socket.id, name: hostName, emoji: hostEmoji,
          photo: data.profile?.photo || null,
          phone: data.profile?.phone || '', email: data.profile?.email || '', instagram: data.profile?.instagram || '',
          partyCode: code, joinedAt: new Date().toISOString(), isHost: true, connected: true
        });
      }

      const lastFour = existing.hostSecret.slice(-4);
      const guestCount = existing.participants.filter(p => !p.isHost).length;
      console.log(`🔄 Party RESUMED: ${code} (host: "${hostName}", secret: ****${lastFour}, guests: ${guestCount}, tracks: ${existing.trackHistory.length})`);

      // Re-send lightweight state to host (no base64 photos)
      socket.emit('party:state', buildLightState(existing));

      // Notify guests the host is back
      io.to(`guest:${code}`).emit('party:started', { code, profile: existing.hostProfile });
      io.to(`guest:${code}`).emit('participants:update', existing.participants);
      return;
    }

    // ── NEW party (no existing or secret mismatch) ──
    const party = createPartyState(code);
    party.hostSocketId = socket.id;
    party.hostProfile = data.profile || null;
    parties.set(code, party);

    // Store host secret (never broadcast to guests)
    party.hostSecret = data.hostSecret || null;
    const lastFour = party.hostSecret ? party.hostSecret.slice(-4) : 'NONE';
    
    // Build host participant
    party.participants.unshift({
      id: socket.id, name: hostName, emoji: hostEmoji,
      photo: data.profile?.photo || null,
      phone: data.profile?.phone || '', email: data.profile?.email || '', instagram: data.profile?.instagram || '',
      partyCode: code, joinedAt: new Date().toISOString(), isHost: true
    });

    console.log(`🎉 Party started: ${code} (host: "${hostName}", secret: ****${lastFour}, active parties: ${parties.size})`);
    // Never send hostSecret to guests — only party:started with public data
    io.to(`guest:${code}`).emit('party:started', { code, profile: party.hostProfile });
    io.to(`guest:${code}`).emit('participants:update', party.participants);
  });

  socket.on('host:trackUpdate', (track) => {
    const party = getMutableParty(socket); if (!party) return;
    party.currentTrack = track;

    // ★ R5 fix: hissé hors du bloc if — accessible à l'emit
    let requestedBy = { source: 'djbrain', guestName: null };

    if (track) {
      // Normalize title for dedup: strip leading "ARTIST - " prefix, lowercase
      const normTitle = (t) => (t || '').toLowerCase().replace(/^[^-]+ - /, '').trim();
      const isNewTrack = !party.trackHistory.length ||
        normTitle(party.trackHistory[0]?.title) !== normTitle(track.title);
      if (isNewTrack) {
      // ★ P0-3 — Attribution : qui a demandé ce titre ?
      // (requestedBy déclaré au-dessus — pas de re-déclaration avec let ici)

      // 1. Chercher dans les suggestions récentes (queued ou next)
      if (track.fromSuggestion || track.suggestionId || track.source === 'djBrain_suggestion') {
        const matchedSugg = party.suggestions.find(s =>
          (s.title || '').toLowerCase() === (track.title || '').toLowerCase() &&
          (s.artist || '').toLowerCase() === (track.artist || '').toLowerCase() &&
          ['queued', 'next', 'pending'].includes(s.status)
        );
        if (matchedSugg) {
          requestedBy = { source: 'suggestion', guestName: matchedSugg.guestName || null, guestId: matchedSugg.guestId || null };
          // Marquer la suggestion comme jouée
          matchedSugg.status = 'played';
          matchedSugg.playedAt = new Date().toISOString();
        }
      }

      // 2. Fallback : si track.suggestedBy est renseigné côté iOS (C2/C3 fix), l'utiliser directement
      if (requestedBy.source === 'djbrain' && track.suggestedBy) {
        requestedBy = { source: 'suggestion', guestName: track.suggestedBy, guestId: null };
      }

      // 3. Fallback : recherche souple sur le titre seul si pas encore trouvé
      if (requestedBy.source === 'djbrain') {
        const softMatch = party.suggestions.find(s =>
          (s.title || '').toLowerCase() === (track.title || '').toLowerCase() &&
          ['queued', 'next'].includes(s.status)
        );
        if (softMatch) {
          requestedBy = { source: 'suggestion', guestName: softMatch.guestName || null, guestId: softMatch.guestId || null };
          softMatch.status = 'played';
          softMatch.playedAt = new Date().toISOString();
        }
      }

      party.trackHistory.unshift({
        ...track,
        playedAt: new Date().toISOString(),
        requestedBy,
      });
      addPoints(party, 'host', 'DJ', 15, 'nouveau titre : ' + track.title);

      // Si c'est une suggestion acceptée, bonus de points au guest
      if (requestedBy.source === 'suggestion' && requestedBy.guestId) {
        addPoints(party, requestedBy.guestId, requestedBy.guestName || 'Guest', 20, `suggestion jouée: ${track.title}`);
      }
    } // end if (isNewTrack)
    } // end if (track)

    // ★ R5 fix: requestedBy inclus dans le payload — les guests voient l'attribution en temps réel
    io.to(`guest:${party.code}`).emit('track:update', { ...stripSecret(track), requestedBy });
    console.log(`🎵 [${party.code}] Track: ${track?.title} — ${track?.artist} (by: ${requestedBy.guestName || 'DJ Brain'})`);
  });


  socket.on('host:modeChange', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    party.mode = data.mode;
    io.to(`guest:${party.code}`).emit('mode:change', stripSecret(data));
    console.log(`🎛️ [${party.code}] Mode: ${data.mode}`);
  });

  socket.on('host:genreVote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const genre = data.genre;
    if (genre) {
      if (!party.guestGenreVotes['__HOST__']) addPoints(party, 'host', data.guestName || 'DJ', 15, 'genre vote');
      party.guestGenreVotes['__HOST__'] = genre;
      // L'hôte ne jamais expire (pasde TTL)
      if (!party.guestGenreVoteExpiry) party.guestGenreVoteExpiry = {};
    } else {
      delete party.guestGenreVotes['__HOST__'];
      delete party.guestGenreVoteExpiry['__HOST__'];
    }
    const totals = recomputeGenreVotes(party);
    io.to(`guest:${party.code}`).emit('votes:update', { genreVotes: totals });
    io.to(`host:${party.code}`).emit('votes:update', { genreVotes: totals });
  });

  socket.on('host:costumeVote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const voterId = 'host', targetId = data.targetId;
    if (party.costumeVoters[voterId] === targetId) return;
    if (party.costumeVoters[voterId]) {
      const old = party.costumeEntries.find(e => e.guestId === party.costumeVoters[voterId]);
      if (old) old.votes = Math.max(0, (old.votes || 0) - 1);
    }
    party.costumeVoters[voterId] = targetId;
    const entry = party.costumeEntries.find(e => e.guestId === targetId);
    if (entry) entry.votes = (entry.votes || 0) + 1;
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
  });

  socket.on('host:costumePhoto', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const entry = party.costumeEntries.find(e => e.guestId === 'host');
    if (entry) entry.photo = data.photo;
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
    const photo = { dataURL: data.photo, guestName: entry?.guestName || 'Host', sentAt: new Date().toISOString() };
    if (addPhotoToParty(party, photo)) {
      io.to(`guest:${party.code}`).emit('photo:shared', photo);
    }
  });

  socket.on('host:voteResults', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    party.vibeScore = data.vibeScore || 0;
  });

  socket.on('host:trackHistory', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    // Build vote counts from guest votes
    const trackVotes = {};
    for (const gId in party.guestVotes) {
      const votes = party.guestVotes[gId];
      for (const tId in votes) {
        if (!trackVotes[tId]) trackVotes[tId] = { fire: 0, like: 0, meh: 0 };
        const t = votes[tId];
        if (t === 'fire') trackVotes[tId].fire++;
        else if (t === 'like') trackVotes[tId].like++;
        else if (t === 'meh') trackVotes[tId].meh++;
      }
    }
    // Enrich the SERVER's own trackHistory with vote counts (don't replace it)
    const enriched = party.trackHistory.map(t => ({
      ...t,
      fireCount: trackVotes[t.title]?.fire || 0,
      likeCount: trackVotes[t.title]?.like || 0,
      mehCount: trackVotes[t.title]?.meh || 0
    }));
    party.trackHistory = enriched;
    io.to(`guest:${party.code}`).emit('history:update', enriched);
  });

  socket.on('host:nextTrack', (track) => {
    const party = getMutableParty(socket); if (!party) return;
    party.nextTrack = track;
    io.to(`guest:${party.code}`).emit('nextTrack:update', stripSecret(track));
  });

  // ═══════════════════════════════════════════════════════════════════
  // GUEST EVENTS
  // ═══════════════════════════════════════════════════════════════════

  socket.on('guest:join', (data) => {
    const code = (data.partyCode || '').toUpperCase();
    const party = parties.get(code);
    if (!party) {
      socket.emit('party:wrongCode', { message: 'Aucune soirée active. Le DJ doit lancer la soirée depuis l\'app.' });
      return;
    }
    socket.partyCode = code;
    socket.join(`guest:${code}`);
    cancelCleanup(code);

    // Generate session token for reconnection
    const sessionToken = randomUUID();
    const guestName = data.name || 'Guest';

    // Cancel any pending disconnect timer for this guest
    if (party.disconnectTimers[guestName]) {
      clearTimeout(party.disconnectTimers[guestName]);
      delete party.disconnectTimers[guestName];
    }

    // Generate or reuse stable userId
    const userId = data.userId || 'user_' + randomUUID().replace(/-/g, '').substring(0, 16);

    const guest = {
      id: socket.id, userId, name: guestName, emoji: data.emoji || '🎉',
      photo: data.photo || null, phone: data.phone || '', email: data.email || '', instagram: data.instagram || '',
      partyCode: code, joinedAt: new Date().toISOString(),
      consentVersion: data.consentVersion || '1.0',
      consentTimestamp: data.consentTimestamp || Date.now(),
      sessionToken, connected: true
    };
    // Remove any existing entry with same name OR same userId (prevents duplicates on reconnect)
    // IMPORTANT: Never remove the host entry even if name matches
    // Also: if guest name matches the host name (self-join), skip entirely
    const hostParticipant = party.participants.find(p => p.isHost);
    const hostName = (hostParticipant?.name || '').trim().toLowerCase();
    const guestTrimmed = guestName.trim().toLowerCase();
    if (hostParticipant && (guestTrimmed === hostName || hostName.includes(guestTrimmed) || guestTrimmed.includes(hostName))) {
      // Host is joining as guest (e.g. GuestExperienceView opened from host app) — skip duplicate
      console.log(`[${code}] Host joining as guest (${guestName}) — skipping duplicate participant`);
      socket.emit('party:state', buildLightState(party));
      socket.emit('session:token', { sessionToken: randomUUID(), partyCode: code, userId: data.userId || socket.id });
      return;
    }
    party.participants = party.participants.filter(p => {
      if (p.isHost) return true;  // Never remove the host
      if (p.name === guest.name) return false;   // Same name → remove old guest
      if (userId && p.userId === userId) return false; // Same userId → remove old
      return true;  // Keep everyone else
    });
    party.participants.push(guest);
    party.sessionTokens[sessionToken] = guestName;
    party.isDirty = true;
    recomputeGenreVotes(party);
    socket.emit('party:state', buildLightState(party));
    // Send session token + userId separately (client stores them)
    socket.emit('session:token', { sessionToken, partyCode: code, userId });
    io.to(`host:${code}`).emit('guest:joined', guest);
    io.to(`guest:${code}`).emit('participants:update', party.participants);
    if (guest.name && guest.name !== 'Guest') {
      if (!party.profilePointsGiven.has(guest.name)) {
        party.profilePointsGiven.add(guest.name);
        addPoints(party, socket.id, guest.name, 25, 'profile complete');
      }
    }
    console.log(`👤 [${code}] Guest joined: ${guest.emoji} ${guest.name} (token: ${sessionToken.substring(0, 8)}...) — Total participants: ${party.participants.length}`)
    console.log(`👤 [${code}] Participant list: ${party.participants.map(p => `${p.name}${p.isHost ? ' [HOST]' : ''}`).join(', ')}`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // GUEST RESUME (reconnection via session token)
  // ═══════════════════════════════════════════════════════════════════

  socket.on('guest:resume', (payload, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    const code = (payload?.partyCode || '').toUpperCase();
    const token = payload?.sessionToken;

    if (!code || !token) { cb({ ok: false, reason: 'MISSING_PARAMS' }); return; }

    const party = parties.get(code);
    if (!party) { cb({ ok: false, reason: 'PARTY_NOT_FOUND' }); return; }

    const guestName = party.sessionTokens[token];
    if (!guestName) { cb({ ok: false, reason: 'INVALID_TOKEN' }); return; }

    // Find existing participant
    const participant = party.participants.find(p => p.name === guestName);
    if (!participant) { cb({ ok: false, reason: 'PARTICIPANT_GONE' }); return; }

    // Cancel disconnect timer
    if (party.disconnectTimers[guestName]) {
      clearTimeout(party.disconnectTimers[guestName]);
      delete party.disconnectTimers[guestName];
    }

    // Rebind socket
    participant.id = socket.id;
    participant.connected = true;
    socket.partyCode = code;
    socket.join(`guest:${code}`);
    cancelCleanup(code);

    // Send full state
    // Send lightweight state (no base64 photos)
    socket.emit('party:state', buildLightState(party));
    io.to(`host:${code}`).emit('guest:joined', participant);
    io.to(`guest:${code}`).emit('participants:update', party.participants);

    cb({
      ok: true,
      profile: { name: participant.name, emoji: participant.emoji, photo: participant.photo },
      partyCode: code
    });
    console.log(`🔄 [${code}] Guest resumed: ${participant.emoji} ${participant.name}`);
    

  });

  socket.on('guest:requestState', () => {
    const party = getParty(socket); if (!party) return;
    socket.emit('party:state', buildLightState(party));
  });

  socket.on('host:requestState', (data) => {
    const party = getParty(socket); if (!party) return;
    socket.emit('party:state', buildLightState(party));
    console.log(`🔄 [${party.code}] Host requested state resync`);
  });

  socket.on('guest:vote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    if (!party.guestVotes[data.guestId]) party.guestVotes[data.guestId] = {};
    party.guestVotes[data.guestId][data.trackId || 'current'] = data.type;
    io.to(`host:${party.code}`).emit('guest:voted', data);
    io.to(`guest:${party.code}`).emit('guest:voted', data);
    if (data.guestId) addPoints(party, data.guestId, data.guestName || 'Guest', 10, `vote ${data.type}`);
    
    // ★ Phase 3 — Queue rating for debounced aggregation
    if (data.type && data.trackTitle) {
      const trackKey = data.isrc || fallbackHash(data.trackTitle, data.trackArtist || '');
      if (!pendingRatings.has(party.code)) pendingRatings.set(party.code, new Map());
      const partyPending = pendingRatings.get(party.code);
      if (!partyPending.has(trackKey)) {
        partyPending.set(trackKey, { feu: 0, cool: 0, bof: 0, isrc: data.isrc, title: data.trackTitle, artist: data.trackArtist, genre: party._dominantGenre || '' });
      }
      const entry = partyPending.get(trackKey);
      if (data.type === 'fire') entry.feu++;
      else if (data.type === 'like') entry.cool++;
      else if (data.type === 'meh') entry.bof++;
    }
  });

  socket.on('guest:genreVote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const voterKey = data.guestName || data.guestId || socket.id;
    const genre = data.genre;
    if (!party.guestGenreVoteExpiry) party.guestGenreVoteExpiry = {};
    if (genre) {
      party.guestGenreVotes[voterKey] = genre;
      // Expiration : 30 min à partir du vote
      party.guestGenreVoteExpiry[voterKey] = Date.now() + GENRE_VOTE_TTL_MS;
      if (!party._genreVotedOnce[voterKey]) {
        party._genreVotedOnce[voterKey] = true;
        addPoints(party, data.guestId || socket.id, data.guestName || voterKey, 15, 'genre vote');
      }
    } else {
      delete party.guestGenreVotes[voterKey];
      delete party.guestGenreVoteExpiry[voterKey];
    }
    const totals = recomputeGenreVotes(party);
    io.to(`host:${party.code}`).emit('guest:genreVoted', {
      ...data,
      expiresAt: party.guestGenreVoteExpiry[voterKey] || null
    });
    io.to(`guest:${party.code}`).emit('votes:update', { genreVotes: totals });
    io.to(`host:${party.code}`).emit('votes:update', { genreVotes: totals });
  });

  socket.on('guest:suggest', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const suggestion = {
      ...data,
      status: 'pending',       // pending → queued → next → played / dismissed
      sentAt: new Date().toISOString(),
      queuedAt: null,
      playingAt: null,
      playedAt: null,
      dismissedAt: null,
      socketId: socket.id       // Track originator for status feedback
    };
    party.suggestions.push(suggestion);
    const hostRoom = `host:${party.code}`;
    const hostSockets = io.sockets.adapter.rooms.get(hostRoom);
    const hostCount = hostSockets ? hostSockets.size : 0;
    io.to(hostRoom).emit('guest:suggested', suggestion);
    // Confirm receipt to the guest
    socket.emit('suggestion:status', {
      title: data.title || data.query,
      artist: data.artist || '',
      status: 'pending',
      message: '💡 Suggestion envoyée !'
    });
    console.log(`🎵 [${party.code}] SUGGEST: "${data.title || '?'}" by ${data.guestName || '?'} → host room has ${hostCount} socket(s)`);
    if (data.guestId || data.guestName) addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 5, `suggestion: ${data.title || data.query}`);
  });

  // Track played event — anti-replay + performance tracking + suggestion boost
  socket.on('host:trackPlayed', async (data) => {
    const party = getMutableParty(socket); if (!party) return;
    
    const { title, artist, genre, isrc, deezerID, vibeScore, fromSuggestion, isGuessed } = data;
    const hash = fallbackHash(title, artist);
    
    // 1. Add to playedKeys (both ISRC and fallbackHash)
    if (!party.playedKeys) party.playedKeys = [];
    if (isrc && !party.playedKeys.includes(isrc)) party.playedKeys.push(isrc);
    if (hash && !party.playedKeys.includes(hash)) party.playedKeys.push(hash);
    if (deezerID && !party.playedKeys.includes(String(deezerID))) party.playedKeys.push(String(deezerID));
    
    console.log(`🎵 [${party.code}] Track played: "${title}" — ${artist} (keys: ${party.playedKeys.length})`);
    
    // 2. Upsert Track in MongoDB (async, non-blocking)
    try {
      const hour = new Date().getHours();
      const hourBucket = hour < 21 ? '18-21' : hour < 23 ? '21-23' : hour < 1 || hour >= 23 ? '23-01' : '01-03';
      const partyGenre = party._dominantGenre || genre || '';
      
      const filter = isrc ? { isrc } : { fallbackHash: hash };
      const inc = {
        'performance.totalPlays': 1,
        [`performance.hourBuckets.${hourBucket}.plays`]: 1,
      };
      if (partyGenre) inc[`performance.genreContexts.${partyGenre}.plays`] = 1;
      // Boost suggestCount si ce play vient d'une suggestion (signal fort)
      if (fromSuggestion) inc['suggestCount'] = 1;

      const update = {
        $setOnInsert: {
          isrc:         isrc || undefined,
          fallbackHash: hash,
          title,
          artist,
          genre:        normalizeGenre(genre || ''),
          source:       fromSuggestion ? 'suggestion' : 'exploration',
          'providers.deezer.trackId': deezerID || undefined,
        },
        $inc: inc,
        $set: {
          'performance.avgVibeAtPlay': vibeScore || 0,
          updatedAt: new Date(),
        }
      };
      
      if (isGuessed) update.$set.isGuessed = true;

      await Track.findOneAndUpdate(filter, update, { upsert: true, new: true });
    } catch (err) {
      console.error(`[Track] ❌ Upsert error: ${err.message}`);
    }
  });

  // ★ Option 3 — Persist 19% fire tracks and fire scores
  socket.on('host:track_feedback', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const { deezerID, title, artist, genre, bpm, fireCount, participantCount } = data;
    if (!deezerID) return;
    
    try {
      let feedback = {};
      if (existsSync(FEEDBACK_PATH)) {
        const raw = readFileSync(FEEDBACK_PATH, 'utf-8');
        if (raw.trim()) feedback = JSON.parse(raw);
      }
      
      const idStr = String(deezerID);
      const existing = feedback[idStr] || { deezerID, title, artist, genre, bpm, fireCount: 0, participantCount: 0 };
      
      // Keep track of total fires for DJBrain
      existing.fireCount += fireCount;
      // Keep the highest participant count seen to avoid diluting the ratio
      existing.participantCount = Math.max(existing.participantCount, participantCount);
      
      // Update metadata
      existing.title = title || existing.title;
      existing.artist = artist || existing.artist;
      existing.genre = genre || existing.genre;
      existing.bpm = bpm || existing.bpm;
      
      feedback[idStr] = existing;
      writeFileSync(FEEDBACK_PATH, JSON.stringify(feedback, null, 2));
      console.log(`🔥 [${party.code}] Track feedback saved: "${title}" (Total Fire: ${existing.fireCount})`);
    } catch (err) {
      console.error(`[Feedback] ❌ Error saving feedback: ${err.message}`);
    }
  });

  // ★ Phase 3 — Host preferences update
  socket.on('host:updatePreferences', async (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const hostId = data.hostId;
    if (!hostId) return;
    
    try {
      await HostPreference.findOneAndUpdate(
        { hostId },
        { $set: { genreBoosts: data.genreBoosts || {}, boostedISRCs: data.boostedISRCs || [], bannedISRCs: data.bannedISRCs || [] } },
        { upsert: true, new: true }
      );
      console.log(`[Prefs] ✅ Updated preferences for host ${hostId}`);
    } catch (err) {
      console.error(`[Prefs] ❌ Error: ${err.message}`);
    }
  });

  socket.on('host:suggestionPlayed', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    if (data.guestName) {
      const guestId = data.guestId || data.guestName;
      if (guestId !== 'host') {
          addPoints(party, guestId, data.guestName, 10, `suggestion played: ${data.trackTitle || 'Unknown'}`);
      }
      addPoints(party, 'host', 'DJ', 5, `handled suggestion: ${data.trackTitle || 'Unknown'}`);
    }
    // Update suggestion status and notify the guest
    const match = party.suggestions.find(s =>
      (s.title || '').toLowerCase() === (data.trackTitle || '').toLowerCase() &&
      s.guestName === data.guestName
    );
    if (match) {
      match.status = 'played';
      match.playedAt = new Date().toISOString();
      // Notify the originating guest
      const guestRoom = `guest:${party.code}`;
      io.to(guestRoom).emit('suggestion:status', {
        title: match.title || match.query,
        artist: match.artist || '',
        guestName: data.guestName,
        status: 'played',
        message: `🎉 Well done! "${match.title || match.query}" a été jouée ! +10 pts bonus`
      });
    }
    console.log(`🎵 [${party.code}] SUGGESTION PLAYED: "${data.trackTitle}" suggested by ${data.guestName}`);
  });

  socket.on('host:acceptSuggestion', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const match = party.suggestions.find(s =>
      (s.title || '').toLowerCase() === (data.trackTitle || '').toLowerCase() &&
      (s.guestName || '') === (data.guestName || '')
    );
    if (match) {
      match.status = 'queued';
      match.queuedAt = new Date().toISOString();
      const guestRoom = `guest:${party.code}`;
      io.to(guestRoom).emit('suggestion:status', {
        title: match.title || match.query,
        artist: match.artist || '',
        guestName: data.guestName,
        status: 'queued',
        message: `🎶 Coming soon! "${match.title || match.query}" est dans la file`
      });
      console.log(`🎵 [${party.code}] SUGGESTION QUEUED: "${data.trackTitle}" by ${data.guestName}`);
    }
  });

  // New event: mark a suggestion as "next to play"
  socket.on('host:nextSuggestion', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const match = party.suggestions.find(s =>
      (s.title || '').toLowerCase() === (data.trackTitle || '').toLowerCase() &&
      (s.guestName || '') === (data.guestName || '')
    );
    if (match) {
      match.status = 'next';
      match.playingAt = new Date().toISOString();
      const guestRoom = `guest:${party.code}`;
      io.to(guestRoom).emit('suggestion:status', {
        title: match.title || match.query,
        artist: match.artist || '',
        guestName: data.guestName,
        status: 'next',
        message: `🔥 Next is yours! "${match.title || match.query}" arrive !`
      });
      console.log(`🎵 [${party.code}] SUGGESTION NEXT: "${data.trackTitle}" by ${data.guestName}`);
    }
  });

  socket.on('host:rejectSuggestion', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const match = party.suggestions.find(s =>
      (s.title || '').toLowerCase() === (data.trackTitle || '').toLowerCase() &&
      (s.guestName || '') === (data.guestName || '')
    );
    if (match) {
      match.status = 'dismissed';
      match.dismissedAt = new Date().toISOString();
      const guestRoom = `guest:${party.code}`;
      io.to(guestRoom).emit('suggestion:status', {
        title: match.title || match.query,
        artist: match.artist || '',
        guestName: data.guestName,
        status: 'dismissed',
        message: `Maybe next time! On garde ta suggestion en tête 😉`
      });
      console.log(`🎵 [${party.code}] SUGGESTION DISMISSED: "${data.trackTitle}" by ${data.guestName}`);
    }
  });

  // Cancel a suggestion (guest or host cancels before it's played)
  socket.on('guest:cancelSuggestion', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const idx = party.suggestions.findIndex(s =>
      (s.title || '').toLowerCase() === (data.title || '').toLowerCase() &&
      (s.guestName || '') === (data.guestName || '') &&
      s.status === 'pending'
    );
    if (idx !== -1) {
      party.suggestions.splice(idx, 1);
      // Notify host to remove from their list
      const hostRoom = `host:${party.code}`;
      io.to(hostRoom).emit('suggestion:cancelled', {
        title: data.title,
        guestName: data.guestName
      });
      // Confirm to guest
      socket.emit('suggestion:status', {
        title: data.title,
        artist: data.artist || '',
        guestName: data.guestName,
        status: 'cancelled',
        message: `🗑️ Suggestion annulée`
      });
      console.log(`🎵 [${party.code}] SUGGESTION CANCELLED: "${data.title}" by ${data.guestName}`);
    }
  });

  socket.on('guest:photo', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    
    // Payload size guard — reject > 500KB base64 (~375KB raw)
    const payloadSize = (data.dataURL || '').length;
    if (payloadSize > 500 * 1024) {
      console.warn(`📸 [${party.code}] Photo REJECTED: ${Math.round(payloadSize/1024)} KB from ${data.guestName} (cap: 500KB)`);
      socket.emit('photo:error', { error: 'PHOTO_TOO_LARGE', message: '📸 Photo trop volumineuse même après compression. Essayez une photo plus simple.' });
      return;
    }
    
    // Per-guest photo cap (costume photos excluded)
    const GUEST_PHOTO_CAP = 15;
    const guestPhotoCount = party.photos.filter(p => p.guestName === data.guestName && !p.isCostume).length;
    if (guestPhotoCount >= GUEST_PHOTO_CAP) {
      console.warn(`📸 [${party.code}] Photo cap reached for ${data.guestName} (${guestPhotoCount}/${GUEST_PHOTO_CAP})`);
      socket.emit('photo:error', { error: 'PHOTO_LIMIT', message: '📷 Limite atteinte ! Tu as déjà ' + GUEST_PHOTO_CAP + ' photos.' });
      return;
    }
    
    const photo = { dataURL: data.dataURL, guestName: data.guestName || 'Guest', caption: data.caption || null, sentAt: new Date().toISOString() };
    if (!addPhotoToParty(party, photo)) return;
    const hostRoom = `host:${party.code}`;
    const hostSockets = io.sockets.adapter.rooms.get(hostRoom);
    socket.broadcast.to(`guest:${party.code}`).emit('photo:shared', photo);
    io.to(hostRoom).emit('guest:photo', photo);
    addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 20, 'photo');
    console.log(`📸 [${party.code}] Photo ACCEPTED: ${data.guestName} (${guestPhotoCount + 1}/${GUEST_PHOTO_CAP}, ${Math.round(payloadSize/1024)} KB, host sockets: ${hostSockets ? hostSockets.size : 0})`);
  });

  socket.on('guest:message', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const msg = { id: Date.now().toString(), guestName: data.guestName || 'Guest', message: data.message || '', guestPhoto: data.guestPhoto || null, guestEmoji: data.guestEmoji || '🎉', sentAt: new Date().toISOString() };
    // Store in party state for resync
    if (!party.messages) party.messages = [];
    party.messages.push(msg);
    // Broadcast to host AND all other guests
    io.to(`host:${party.code}`).emit('guest:message', msg);
    socket.broadcast.to(`guest:${party.code}`).emit('guest:message', msg);
    addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 10, 'message');
  });

  socket.on('host:message', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const msg = { id: Date.now().toString(), guestName: data.guestName || 'DJ', message: data.message || '', guestEmoji: data.guestEmoji || '🎧', sentAt: new Date().toISOString() };
    // Store in party state for resync
    if (!party.messages) party.messages = [];
    party.messages.push(msg);
    io.to(`guest:${party.code}`).emit('guest:message', msg);
    addPoints(party, 'host', data.guestName || 'DJ', 10, 'message');
  });

  socket.on('host:photo', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const photo = { dataURL: data.dataURL, guestName: data.guestName || 'Host', sentAt: new Date().toISOString() };
    if (!addPhotoToParty(party, photo)) return;
    io.to(`guest:${party.code}`).emit('photo:shared', photo);
    addPoints(party, 'host', data.guestName || 'DJ', 20, 'photo');
  });

  // ═══════════════════════════════════════════════════════════════════
  // COSTUME CONTEST
  // ═══════════════════════════════════════════════════════════════════

  socket.on('costume:enter', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    party.costumeEntries = party.costumeEntries.filter(e => e.guestId !== data.guestId && e.guestName !== data.guestName);
    party.costumeEntries.push({ guestId: data.guestId || socket.id, guestName: data.guestName || 'Guest', emoji: data.emoji || '🎭', photo: data.photo, votes: 0 });
    if (data.guestId === 'host' && data.guestName && data.guestName !== 'DJ') {
      const hostP = party.participants.find(p => p.isHost);
      if (hostP) { hostP.name = data.guestName; io.to(`guest:${party.code}`).emit('participants:update', party.participants); }
    }
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
    addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 30, 'costume entry');
  });

  socket.on('costume:vote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    if (!party.costumeOpen) return;
    const voterId = data.voterId || socket.id, targetId = data.targetId;
    if (party.costumeVoters[voterId] === targetId) return;
    if (party.costumeVoters[voterId]) {
      const old = party.costumeEntries.find(e => e.guestId === party.costumeVoters[voterId]);
      if (old) old.votes = Math.max(0, (old.votes || 0) - 1);
    }
    party.costumeVoters[voterId] = targetId;
    const entry = party.costumeEntries.find(e => e.guestId === targetId);
    if (entry) entry.votes = (entry.votes || 0) + 1;
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
  });

  socket.on('costume:unvote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const voterId = data.voterId || socket.id;
    if (party.costumeVoters[voterId] !== data.targetId) return;
    delete party.costumeVoters[voterId];
    const entry = party.costumeEntries.find(e => e.guestId === data.targetId);
    if (entry) entry.votes = Math.max(0, (entry.votes || 0) - 1);
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
  });

  socket.on('costume:photo', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const entry = party.costumeEntries.find(e => e.guestId === data.guestId);
    if (entry) entry.photo = data.photo;
    io.to(`guest:${party.code}`).emit('costume:entries', party.costumeEntries);
    io.to(`host:${party.code}`).emit('costume:entries', party.costumeEntries);
    if (data.photo) {
      const photo = { dataURL: data.photo, guestName: entry?.guestName || 'Guest', sentAt: new Date().toISOString(), isCostume: true };
      if (addPhotoToParty(party, photo)) {
        io.to(`host:${party.code}`).emit('guest:photo', photo);
        socket.broadcast.to(`guest:${party.code}`).emit('photo:shared', photo);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // MISSIONS & POINTS
  // ═══════════════════════════════════════════════════════════════════

  socket.on('mission:complete', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const pts = data.points || 0;
    if (pts > 0) addPoints(party, data.participantId || data.guestId || socket.id, data.name || 'Guest', pts, `mission: ${data.mission || 'unknown'}`);
  });

  socket.on('costume:winner', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const winnerId = data.guestId || data.winnerId;
    if (winnerId) addPoints(party, winnerId, data.guestName || data.winnerName || 'Winner', 150, 'costume winner 🏆');
  });

  // ═══════════════════════════════════════════════════════════════════
  // HOST CLOSES COSTUME CONTEST
  // ═══════════════════════════════════════════════════════════════════
  socket.on('host:closeCostume', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    if (!party.costumeOpen) return;
    party.costumeOpen = false;
    const entries = party.costumeEntries || [];
    const sorted = [...entries].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const winner = sorted.length > 0 && sorted[0].votes > 0 ? sorted[0] : null;
    if (winner) addPoints(party, winner.guestId, winner.guestName, 150, 'costume winner 🏆');
    const podium = sorted.slice(0, 3).map((e, i) => ({ rank: i + 1, guestId: e.guestId, guestName: e.guestName, emoji: e.emoji, votes: e.votes || 0, photo: e.photo || null }));
    const closedData = {
      winner: winner ? { guestId: winner.guestId, guestName: winner.guestName, emoji: winner.emoji, votes: winner.votes || 0, photo: winner.photo || null } : null,
      podium, totalEntries: entries.length
    };
    io.to(`guest:${party.code}`).emit('costume:closed', closedData);
    io.to(`host:${party.code}`).emit('costume:closed', closedData);
    console.log(`🎭🏆 [${party.code}] Costume CLOSED! Winner: ${winner?.guestName || 'None'}`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // HOST VOTE
  // ═══════════════════════════════════════════════════════════════════

  socket.on('host:vote', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const trackTitle = data.trackTitle || party.currentTrack?.title || 'Titre en cours';
    const { hostSecret: _hs, ...cleanData } = data;
    const voteData = { ...cleanData, trackTitle, trackId: trackTitle };
    io.to(`guest:${party.code}`).emit('vote:received', voteData);
    if (!party.guestVotes['host']) party.guestVotes['host'] = {};
    party.guestVotes['host'][trackTitle] = data.type;
    addPoints(party, 'host', data.guestName || 'DJ', 10, `vote ${data.type}`);
    const vibeMap = { meh: -1, like: 1, fire: 3 };
    party.vibeScore = Math.max(0, party.vibeScore + (vibeMap[data.type] || 0));
    io.to(`guest:${party.code}`).emit('votes:update', { genreVotes: party.genreVotes, vibeScore: party.vibeScore });
  });

  // ═══════════════════════════════════════════════════════════════════
  // END PARTY
  // ═══════════════════════════════════════════════════════════════════

  socket.on('host:endParty', async (data) => {
    const party = getMutableParty(socket); if (!party) return;
    if (party.hostSocketId !== socket.id) {
      console.warn(`⚠️ [${party.code}] Unauthorized endParty attempt from ${socket.id}`);
      return;
    }
    io.to(`guest:${party.code}`).emit('party:ended', {
      reason: 'La soirée est terminée ! Merci d\'avoir participé 🎉',
      scores: party.participantScores, trackHistory: party.trackHistory,
      photos: party.photos, participants: party.participants
    });
    console.log(`🎉 [${party.code}] Party ended by host`);
    await flushEndedParty(party);
    parties.delete(party.code);
    cancelCleanup(party.code);
  });

  socket.on('host:deletePhoto', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const idx = data && data.index;
    if (typeof idx === 'number' && idx >= 0 && idx < party.photos.length) {
      party.photos.splice(idx, 1);
      io.to(`host:${party.code}`).emit('photos:update', party.photos);
      io.to(`guest:${party.code}`).emit('photos:update', party.photos);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // DISCONNECT
  // ═══════════════════════════════════════════════════════════════════

  socket.on('disconnect', (reason) => {
    const code = socket.partyCode;
    const party = code ? parties.get(code) : null;
    if (party) {
      const participant = party.participants.find(p => p.id === socket.id);
      const pName = participant?.name || 'unknown';
      console.log(`🔌 [${code}] DISCONNECT: ${pName} (socket: ${socket.id}, reason: ${reason})`);

      if (participant && participant.sessionToken) {
        // ── GUEST with session token: grace period (4h) ──
        participant.connected = false;
        io.to(`host:${code}`).emit('guest:disconnected', { name: participant.name, id: socket.id });

        const GRACE_MS = 6 * 60 * 60 * 1000; // 6 hours
        party.disconnectTimers[participant.name] = setTimeout(() => {
          // Final removal after grace period
          delete party.sessionTokens[participant.sessionToken];
          party.participants = party.participants.filter(p => p.name !== participant.name);
          delete party.disconnectTimers[participant.name];
          if (party.guestGenreVotes[participant.name]) {
            delete party.guestGenreVotes[participant.name];
            const totals = recomputeGenreVotes(party);
            io.to(`host:${code}`).emit('votes:update', { genreVotes: totals });
            io.to(`guest:${code}`).emit('votes:update', { genreVotes: totals });
          }
          io.to(`guest:${code}`).emit('participants:update', party.participants);
          // CR1 FIX: Send both id AND name so host can match by either
          io.to(`host:${code}`).emit('guest:left', { id: socket.id, name: participant.name });
          party.isDirty = true;
          console.log(`🗑️ [${code}] Guest ${participant.name} removed after grace period`);
        }, GRACE_MS);
        console.log(`⏸️ [${code}] Grace period started for ${participant.name}`);
      } else {
        // ── HOST or guest without token: immediate removal ──
        if (participant && party.guestGenreVotes[participant.name]) {
          delete party.guestGenreVotes[participant.name];
          const totals = recomputeGenreVotes(party);
          io.to(`host:${code}`).emit('votes:update', { genreVotes: totals });
          io.to(`guest:${code}`).emit('votes:update', { genreVotes: totals });
        }
        party.participants = party.participants.filter(p => p.id !== socket.id);
        io.to(`guest:${code}`).emit('participants:update', party.participants);
        // CR1 FIX: Send both id AND name so host can match by either
        io.to(`host:${code}`).emit('guest:left', { id: socket.id, name: pName });
        console.log(`❌ [${code}] Removed immediately: ${pName} (${socket.id})`);
      }

      // Schedule party cleanup if no sockets remain
      const hostRoom = io.sockets.adapter.rooms.get(`host:${code}`);
      const guestRoom = io.sockets.adapter.rooms.get(`guest:${code}`);
      if (!hostRoom?.size && !guestRoom?.size) {
        partyCleanupTimers.set(code, setTimeout(() => {
          parties.delete(code);
          partyCleanupTimers.delete(code);
          console.log(`🗑️ Party ${code} cleaned up (10min timeout)`);
        }, 10 * 60 * 1000));
      }
    } else {
      console.log(`❌ Disconnected: ${socket.id} (party: ${code || 'none'})`);
    }
  });
});

// ─── Boot Sequence ──────────────────────────────────────────────────
async function boot() {
  // 1. Connect to MongoDB (optional)
  await connectDB();

  // 2. Restore active parties from DB
  await restoreParties(parties);

  // 3. Seed editorial catalog (no-op if already seeded)
  await seedEditorialCatalog();

  // 4. Start flush loop
  startFlushLoop(parties);

  // ★ Phase 3: Start debounced rating flush (every 10 seconds)
  setInterval(async () => {
    for (const [partyCode, trackMap] of pendingRatings.entries()) {
      if (trackMap.size === 0) continue;
      
      for (const [trackKey, r] of trackMap.entries()) {
        try {
          const filter = r.isrc ? { isrc: r.isrc } : { fallbackHash: trackKey };
          const totalNew = r.feu + r.cool + r.bof;
          if (totalNew === 0) continue;
          
          const track = await Track.findOne(filter);
          if (track) {
            const oldFeu = track.performance?.ratings?.feu || 0;
            const oldCool = track.performance?.ratings?.cool || 0;
            const oldBof = track.performance?.ratings?.bof || 0;
            const newFeu = oldFeu + r.feu;
            const newTotal = newFeu + oldCool + r.cool + oldBof + r.bof;
            
            await Track.updateOne(filter, {
              $inc: {
                'performance.ratings.feu': r.feu,
                'performance.ratings.cool': r.cool,
                'performance.ratings.bof': r.bof,
              },
              $set: {
                'performance.feuRatio': newTotal > 0 ? newFeu / newTotal : 0,
              }
            });
          }
        } catch (err) {
          console.error(`[RatingFlush] ❌ ${trackKey}: ${err.message}`);
        }
      }
      
      const count = trackMap.size;
      trackMap.clear();
      if (count > 0) console.log(`[RatingFlush] ✅ Flushed ${count} track ratings for party ${partyCode}`);
    }
  }, 10000);

  // 4. Start HTTP server
  server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('');
    console.log('  🎧 ═══════════════════════════════════════════');
    console.log('  ║   SOCIAL MIX — Relay Server v14 (mongo)    ║');
    console.log('  ═══════════════════════════════════════════════');
    console.log(`  ║  Local:   http://localhost:${PORT}`);
    console.log(`  ║  Network: http://${ip}:${PORT}`);
    console.log(`  ║  Guest:   http://${ip}:${PORT} (same URL!)`);
    console.log('  ═══════════════════════════════════════════════');
    console.log('');

    // Optional server metrics — activated only with STRESS_METRICS=1
    // No-op in production (zero cost, zero log noise).
    startMetrics(io, parties);
  });
}

// ─── Graceful Shutdown ──────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received — flushing parties...');
  await stopFlushLoop(parties);
  process.exit(0);
});
process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received — flushing parties...');
  await stopFlushLoop(parties);
  process.exit(0);
});

boot().catch(err => { console.error('Boot failed:', err); process.exit(1); });

// ─── Genre Vote Purge Job (toutes les 5 min) ─────────────────────────
// Supprime les votes expirés (TTL 30 min) et broadcast les mises à jour.
// Si tous les votes expirent → retombe sur le dernier genre dominant.
setInterval(() => {
  const now = Date.now();
  for (const [code, party] of parties) {
    if (party.endedAt) continue; // Ignorer les soirées terminées
    const expiry = party.guestGenreVoteExpiry || {};
    let changed = false;

    for (const [voterKey, exp] of Object.entries(expiry)) {
      if (voterKey === '__HOST__') continue; // L'hôte n'expire pas
      if (now > exp) {
        const expiredGenre = party.guestGenreVotes[voterKey];
        delete party.guestGenreVotes[voterKey];
        delete party.guestGenreVoteExpiry[voterKey];
        changed = true;
        console.log(`⏰ [${code}] Genre vote expiré: ${voterKey} → ${expiredGenre} (après 30min)`);
      }
    }

    if (changed) {
      const totals = recomputeGenreVotes(party);
      party.isDirty = true;

      // Broadcast la mise à jour à tout le monde
      io.to(`guest:${code}`).emit('votes:update', {
        genreVotes: totals,
        fallbackGenre: party._lastDominantGenre || null
      });
      io.to(`host:${code}`).emit('votes:update', {
        genreVotes: totals,
        fallbackGenre: party._lastDominantGenre || null
      });

      const activeVotes = Object.keys(totals).length;
      if (activeVotes === 0) {
        console.log(`🎵 [${code}] Plus de votes actifs → fallback genre: ${party._lastDominantGenre || 'aucun'}`);
      } else {
        console.log(`✅ [${code}] Votes restants après purge: ${JSON.stringify(totals)}`);
      }
    }
  }
}, 5 * 60 * 1000); // Toutes les 5 minutes
