import express from 'express';
import cors from 'cors';
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
import { uploadPhoto } from './services/cloudinaryService.js';
import { cappedPush, cappedUnshift } from './utils/cappedPush.js';
import adminUsersRouter from './routes/admin/users.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

process.on('uncaughtException', (err) => {
  if (err.code === 'UND_ERR_SOCKET' || err.message === 'terminated') {
    console.error('⚠️ Caught undici fetch socket error (ignoring to prevent crash):', err.message);
  } else {
    console.error('🔥 Uncaught Exception:', err);
  }
});

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
  let token = req.headers['x-admin-token'] || req.query.token;
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
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

const corsOptions = {
  origin: [
    'https://ahouai.com',
    'https://www.ahouai.com',
    'https://join.ahouai.com',
    'https://admin.ahouai.com',
    'https://api.ahouai.com',
    'https://socialmix-relay.onrender.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
};
app.use(cors(corsOptions));

const server = createServer(app);
const PORT = process.env.PORT || 3069;

const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    credentials: true,
    methods: ['GET', 'POST']
  },
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

// TODO (Universal Links AASA):
// - Créer relay-server/public/.well-known/apple-app-site-association
// - Configurer servir static files /.well-known/ via Express
// - Récupérer TEAMID Apple Developer auprès de Jean-Sé
// - Configurer Associated Domains dans Xcode

// ─── Bug 4 fix — admin.ahouai.com redirect ──────────────────────────
// When a request arrives on admin.ahouai.com without an /admin prefix
// (i.e. the bare root "/"), redirect to /admin so Express serves the
// admin SPA instead of the guest SPA from public/.
// This relies on Render propagating the Host header correctly, which it
// does when admin.ahouai.com is registered as a Custom Domain on Render.
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (host.startsWith('admin.') && (req.path === '/' || req.path === '')) {
    console.log(`[Admin Redirect] ${host}${req.path} → /admin`);
    return res.redirect(301, '/admin');
  }
  next();
});

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
app.get('/admin/classify-prelive', (req, res) => res.sendFile(join(__dirname, 'admin', 'classify.html')));
app.get('/admin/setup', (req, res) => res.sendFile(join(__dirname, 'admin', 'setup.html')));
app.get('/admin/hub', (req, res) => res.sendFile(join(__dirname, 'admin', 'hub.html')));
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
app.use('/api/admin/users', adminAuth, adminUsersRouter);

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
    const { genre, bpm, energy, tags, adminQualified, partyMoment, coverArtURL, phase, style } = req.body;
    const update = { $set: {} };
    if (genre        !== undefined) update.$set.genre         = normalizeGenre(genre);
    if (bpm          !== undefined) update.$set.bpm           = Number(bpm);
    if (energy       !== undefined) update.$set.energy        = Math.min(10, Math.max(0, Number(energy)));
    if (tags         !== undefined) update.$set.tags          = tags;
    if (adminQualified !== undefined) update.$set.adminQualified = Boolean(adminQualified);
    if (partyMoment  !== undefined) update.$set.partyMoment   = partyMoment;
    if (phase        !== undefined) update.$set.phase         = phase;
    if (style        !== undefined) update.$set.style         = style;
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
    const [total, qualified, noEnergy, noBpm, byGenre, topFeu, recentParties, novelties] = await Promise.all([
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
        .lean(),
      Track.find({
        $or: [
          { suggestCount: { $gt: 0 } },
          { source: { $in: ['guest_suggestion', 'host_suggestion', 'exploration'] } },
          { importedAt: { $exists: true } }
        ]
      })
      .sort({ createdAt: -1 })
      .limit(15)
      .select('title artist genre bpm phase energy performance source suggestCount')
      .lean()
    ]);

    res.json({ total, qualified, noEnergy, noBpm, byGenre, topFeu, recentParties, novelties });
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
      res.json({ preview: data.results[0].previewUrl });
    } else {
      res.json({ preview: null });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Setup API (Curation Complete/Platine) ──────────────────────────────

app.get('/api/admin/setup/stats', adminAuth, async (req, res) => {
  try {
    const stats = await Track.aggregate([
      { $match: { qualityLevel: { $in: ['platine', 'complete'] } } },
      { $group: {
          _id: "$phase",
          total: { $sum: 1 },
          in: { $sum: { $cond: ["$isBanger", 1, 0] } },
          filler: { $sum: { $cond: ["$isFiller", 1, 0] } },
          backlog: { $sum: { $cond: [ { $and: [ { $ne: ["$isBanger", true] }, { $ne: ["$isFiller", true] } ] }, 1, 0 ] } }
      }}
    ]);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/setup/tracks', adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const skip = (page - 1) * limit;
    
    let filter = { qualityLevel: { $in: ['platine', 'complete'] } };
    
    if (req.query.phase && req.query.phase !== 'all') {
      filter.phase = req.query.phase === 'none' ? null : req.query.phase;
    }
    if (req.query.prio && req.query.prio !== 'all') {
      if (req.query.prio === 'in') filter.isBanger = true;
      if (req.query.prio === 'filler') filter.isFiller = true;
      if (req.query.prio === 'backlog') {
        filter.isBanger = { $ne: true };
        filter.isFiller = { $ne: true };
      }
    }
    
    if (req.query.search) {
      filter.$or = [
        { title: { $regex: req.query.search, $options: 'i' } },
        { artist: { $regex: req.query.search, $options: 'i' } }
      ];
    }
    
    let sortObj = { phase: 1, energy: -1 };
    if (req.query.sort === 'bpm_asc') sortObj = { bpm: 1 };
    if (req.query.sort === 'bpm_desc') sortObj = { bpm: -1 };
    if (req.query.sort === 'title') sortObj = { title: 1 };
    if (req.query.sort === 'artist') sortObj = { artist: 1 };
    
    const total = await Track.countDocuments(filter);
    const tracks = await Track.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean();
      
    res.json({
      tracks,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/setup/tracks/:id', adminAuth, async (req, res) => {
  try {
    const { phase, phaseAlt, isBanger, isFiller, bpm } = req.body;
    let updateFields = {};
    if (phase !== undefined && phase !== null) updateFields.phase = phase;
    else if (phase === null) updateFields.phase = null;
    
    if (phaseAlt !== undefined && phaseAlt !== null) updateFields.phaseAlternate = phaseAlt;
    else if (phaseAlt === null) updateFields.phaseAlternate = null;
    
    if (isBanger !== undefined) updateFields.isBanger = isBanger;
    if (isFiller !== undefined) updateFields.isFiller = isFiller;
    if (bpm !== undefined && bpm !== null && !isNaN(bpm)) updateFields.bpm = Number(bpm);
    
    const track = await Track.findByIdAndUpdate(req.params.id, { $set: updateFields }, { new: true }).lean();
    if (!track) return res.status(404).json({ error: 'Track not found' });
    res.json(track);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Deduplication API ────────────────────────────────────────────────────

const QUALITY_ORDER = { platine: 4, complete: 3, partielle: 2, vide: 1 };

app.get('/api/admin/dedup/stats', adminAuth, async (req, res) => {
  try {
    const total = await Track.countDocuments();
    const dupes = await Track.aggregate([
      { $group: { _id: "$fallbackHash", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 }, _id: { $ne: null } } }
    ]);
    const dupeGroups = dupes.length;
    const extraTracks = dupes.reduce((acc, d) => acc + d.count - 1, 0);
    res.json({ total, dupeGroups, extraTracks });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/dedup/list', adminAuth, async (req, res) => {
  try {
    const dupeGroups = await Track.aggregate([
      { $group: { _id: "$fallbackHash", count: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 }, _id: { $ne: null } } }
    ]);
    
    const groups = [];
    for (const g of dupeGroups) {
      const tracks = await Track.find({ _id: { $in: g.ids } }).lean();
      // Sort best quality first
      tracks.sort((a, b) => (QUALITY_ORDER[b.qualityLevel] || 0) - (QUALITY_ORDER[a.qualityLevel] || 0));
      groups.push({ tracks });
    }
    res.json({ groups });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/dedup/resolve', adminAuth, async (req, res) => {
  try {
    const { keepId, deleteIds } = req.body;
    if (!keepId || !deleteIds || !deleteIds.length) return res.status(400).json({ error: 'Missing keepId or deleteIds' });
    
    // Merge relevant fields from dupes into keeper before deleting
    const keeper = await Track.findById(keepId).lean();
    const dupes = await Track.find({ _id: { $in: deleteIds } }).lean();
    
    // Merge: if keeper is missing phase/priority/bpm, inherit from dupe
    const mergedFields = {};
    for (const d of dupes) {
      if (!keeper.phase && d.phase) mergedFields.phase = d.phase;
      if (!keeper.isBanger && d.isBanger) mergedFields.isBanger = true;
      if (!keeper.isFiller && d.isFiller) mergedFields.isFiller = true;
      if (!keeper.bpm && d.bpm) mergedFields.bpm = d.bpm;
    }
    if (Object.keys(mergedFields).length) {
      await Track.findByIdAndUpdate(keepId, { $set: mergedFields });
    }
    
    await Track.deleteMany({ _id: { $in: deleteIds } });
    res.json({ success: true, deleted: deleteIds.length, merged: mergedFields });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/dedup', (req, res) => {
  res.sendFile(join(__dirname, 'admin', 'dedup.html'));
});

// ─── Classification Pre-Live API ──────────────────────────────────────────

app.get('/api/admin/classify/tracks', adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const skip = (page - 1) * limit;
    
    let filter = {};
    if (req.query.phase === 'missing') {
      filter.$or = [{ phase: null }, { phase: '' }];
    }
    if (req.query.genre && req.query.genre !== 'all') {
      filter.genre = req.query.genre;
    }
    
    // Sort by genre, then title
    const tracks = await Track.find(filter)
      .sort({ genre: 1, title: 1 })
      .skip(skip)
      .limit(limit)
      .exec();
      
    const total = await Track.countDocuments(filter);
    
    res.json({
      tracks,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/classify/suggest', adminAuth, async (req, res) => {
  try {
    const { title, artist, genre } = req.body;
    
    if (!process.env.GEMINI_API_KEY) {
      return res.json({
        suggestion: {
          phase: "party",
          danceability: 8,
          energy: 7,
          reason: "(MOCK) Pas de clé Gemini."
        }
      });
    }

    const prompt = `Pour la track "${title}" de "${artist}" (genre actuel: ${genre}), propose au format JSON STRICTEMENT (sans markdown) :
{
  "phase": "arrival" ou "ambiance" ou "takeoff" ou "groove" ou "party" ou "closing",
  "energy": nombre entier de 1 à 10,
  "danceability": nombre entier de 1 à 10 (1 = très dur à danser, 10 = irresistible),
  "reason": "Justifie en 1 ligne courte"
}`;

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    
    const data = await r.json();
    if (data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text) {
      const contentText = data.candidates[0].content.parts[0].text;
      const content = JSON.parse(contentText);
      res.json({ suggestion: content });
    } else {
      res.status(500).json({ error: "No completion from Gemini", details: data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/sync-ios — run sync-ios script from Monitor button
app.post('/api/admin/sync-ios', adminAuth, async (req, res) => {
  const { exec } = await import('child_process');
  exec('node --env-file=.env scripts/sync-ios.mjs', { cwd: __dirname, timeout: 30000 }, (error, stdout, stderr) => {
    if (error) {
      console.error('[Sync iOS] ❌', error.message);
      return res.status(500).json({ error: error.message, stdout, stderr });
    }
    console.log('[Sync iOS] ✅', stdout);
    res.json({ success: true, message: "Sync iOS terminée !", stdout, stderr });
  });
});

app.post('/api/admin/export/rebuild', adminAuth, (req, res) => {
  const { exec } = require('child_process');
  exec('node scripts/rebuild-metadata.mjs', { cwd: __dirname }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json({ message: "Export réussi.", stdout, stderr });
  });
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

// GET /api/monitor/batch-status
app.get('/api/monitor/batch-status', adminAuth, (req, res) => {
  const path = require('path');
  const fs = require('fs');
  const dirIn = path.join(__dirname, 'batches_in');
  const dirOut = path.join(__dirname, 'batches_out');
  const dirDone = path.join(__dirname, 'batches_done');
  const dirRej = path.join(__dirname, 'batches_rejected');
  
  const countIn = fs.existsSync(dirIn) ? fs.readdirSync(dirIn).filter(f => f.endsWith('.json')).length : 0;
  const countOut = fs.existsSync(dirOut) ? fs.readdirSync(dirOut).filter(f => f.endsWith('.json')).length : 0;
  const countDone = fs.existsSync(dirDone) ? fs.readdirSync(dirDone).filter(f => f.endsWith('.json')).length : 0;
  const countRej = fs.existsSync(dirRej) ? fs.readdirSync(dirRej).filter(f => f.endsWith('.json')).length : 0;
  
  res.json({
    in: countIn,
    out: countOut,
    done: countDone,
    rejected: countRej,
    total: 40
  });
});

// GET /api/monitor/tracks — liste paginée avec filtres
app.get('/api/monitor/tracks', adminAuth, async (req, res) => {
  try {
    const filter = req.query.filter || 'needs_review';
    const genre = req.query.genre || '';
    const search = req.query.search || '';
    const phase = req.query.phase || '';
    const sort = req.query.sort || 'default';
    const source = req.query.source || 'all';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    // ★ Special filter: duplicates — uses aggregation pipeline
    if (filter === 'duplicates') {
      const dupeGroups = await Track.aggregate([
        { $group: { 
          _id: { $toLower: '$title' }, 
          count: { $sum: 1 }, 
          ids: { $push: '$_id' } 
        }},
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } }
      ]);
      
      // Flatten all duplicate IDs
      const allDupeIds = dupeGroups.flatMap(g => g.ids);
      const dupeTracks = await Track.find({ _id: { $in: allDupeIds } })
        .sort({ title: 1, deezerRank: -1 })
        .lean();
      
      return res.json({
        tracks: dupeTracks,
        total: dupeTracks.length,
        page: 1,
        limit: dupeTracks.length,
        pages: 1,
        _dupeGroups: dupeGroups.length
      });
    }

    let query = {};
    if (filter === 'ql_vide') { query.qualityLevel = 'vide'; }
    if (filter === 'ql_partielle') { query.qualityLevel = 'partielle'; }
    if (filter === 'ql_complete') { query.qualityLevel = 'complete'; }
    if (filter === 'ql_platine') { query.qualityLevel = 'platine'; }
    // ★ Complètes sans phase — tracks qualifiées avec genre/BPM/energy mais pas de phase
    if (filter === 'complete_no_phase') {
      query.adminQualified = true;
      query.genre = { $nin: ['', null] };
      query.bpm = { $gt: 0 };
      query.energy = { $gt: 0 };
      query.$or = [{ phase: null }, { phase: '' }, { phase: { $exists: false } }];
    }

    if (filter === 'no_gpt') { query.isLabeled = { $ne: true }; query.gptSuggestion = null; }
    if (filter === 'no_bpm') query.$or = [{ bpm: null }, { bpm: 0 }];
    if (filter === 'no_energy') query.$or = [{ energy: null }, { energy: 0 }];
    if (filter === 'incomplete') query.$or = [{ bpm: null }, { bpm: 0 }, { energy: null }, { energy: 0 }];

    // ★ Ghost Tracks filters (E2B)
    const HIGH_ENERGY_PHASES = ['takeoff', 'groove', 'party'];
    if (filter === 'incoherent_arrival_high') {
      // arrival/ambiance + energy>7 AND phaseAlternate NOT a high-energy phase
      query.phase = { $in: ['arrival', 'ambiance'] };
      query.energy = { $gt: 7 };
      query.$and = [{
        $or: [
          { phaseAlternate: null },
          { phaseAlternate: '' },
          { phaseAlternate: { $exists: false } },
          { phaseAlternate: { $nin: HIGH_ENERGY_PHASES } }
        ]
      }];
    }
    if (filter === 'incoherent_groove_low') {
      // groove/party + energy < 4
      query.phase = { $in: ['groove', 'party'] };
      query.energy = { $lt: 4, $gt: 0 };
    }
    if (filter === 'incoherent_closing_electro') {
      // closing + electro hard genres + bpm>150 AND phaseAlternate != party
      const ELECTRO_HARD = ['electro hard', 'hardstyle', 'hardcore', 'industrial', 'techno hard', 'hard techno'];
      query.phase = 'closing';
      query.genre = { $in: ELECTRO_HARD.map(g => new RegExp(g, 'i')) };
      query.bpm = { $gt: 150 };
      query.phaseAlternate = { $ne: 'party' };
    }
    if (filter === 'ghost_no_phase') {
      // Orphelines — aucune phase assignée
      query.$or = [{ phase: null }, { phase: '' }, { phase: { $exists: false } }];
    }
    if (filter === 'ghost_no_bpm') {
      query.$or = [{ bpm: null }, { bpm: 0 }];
    }
    if (filter === 'ghost_no_rank') {
      query.$or = [{ deezerRank: null }, { deezerRank: 0 }];
    }

    if (phase && phase !== 'all') {
      if (phase === 'unclassified') query.phase = null;
      else query.phase = phase;
    }
    
    if (genre && genre !== 'all') {
      query.genre = genre;
    }

    if (source && source !== 'all') {
      query.source = source;
    }

    if (search) {
      const q = search.toLowerCase();
      query.$or = [
        { title: new RegExp(q, 'i') },
        { artist: new RegExp(q, 'i') }
      ];
    }

    let sortObj = {};
    if (sort === 'bpm_asc') sortObj.bpm = 1;
    else if (sort === 'bpm_desc') sortObj.bpm = -1;
    else if (sort === 'energy_asc') sortObj.energy = 1;
    else if (sort === 'energy_desc') sortObj.energy = -1;
    else if (sort === 'rank_desc') sortObj.deezerRank = -1;
    else if (sort === 'rank_asc') sortObj.deezerRank = 1;
    else sortObj.deezerRank = -1; // Default

    const tracks = await Track.find(query).sort(sortObj).skip((page - 1) * limit).limit(limit).lean();
    const total = await Track.countDocuments(query);

    res.json({
      tracks: tracks,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/ghost/dashboard — live counts par catégorie ghost (E2B)
app.get('/api/admin/ghost/dashboard', adminAuth, async (req, res) => {
  try {
    const HIGH_ENERGY_PHASES = ['takeoff', 'groove', 'party'];
    const ELECTRO_HARD = ['electro hard', 'hardstyle', 'hardcore', 'industrial', 'techno hard', 'hard techno'];

    const [total, blocked, missing_bpm, missing_rank, missing_phase, incoherent_groove_low, incoherent_closing_electro, byGenre] = await Promise.all([
      Track.countDocuments(),
      Track.countDocuments({ isBlocked: true }),
      Track.countDocuments({ $or: [{ bpm: null }, { bpm: 0 }] }),
      Track.countDocuments({ $or: [{ deezerRank: null }, { deezerRank: 0 }] }),
      Track.countDocuments({ $or: [{ phase: null }, { phase: '' }, { phase: { $exists: false } }] }),
      Track.countDocuments({ phase: { $in: ['groove', 'party'] }, energy: { $lt: 4, $gt: 0 } }),
      Track.countDocuments({
        phase: 'closing',
        genre: { $in: ELECTRO_HARD.map(g => new RegExp(g, 'i')) },
        bpm: { $gt: 150 },
        phaseAlternate: { $ne: 'party' }
      }),
      Track.aggregate([
        { $group: { _id: '$genre', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    // Cat 2A requires server-side filtering for phaseAlternate exclusion
    const incoherent_arrival_raw = await Track.find({
      phase: { $in: ['arrival', 'ambiance'] },
      energy: { $gt: 7 }
    }).select('phaseAlternate').lean();
    const incoherent_arrival_high = incoherent_arrival_raw.filter(t => {
      const alt = (t.phaseAlternate || '').toLowerCase();
      return !alt || !HIGH_ENERGY_PHASES.includes(alt);
    }).length;

    // Duplicate groups (same normalized title, different artists) via aggregation
    const dupeAgg = await Track.aggregate([
      { $project: {
        normTitle: {
          $trim: { input:
            { $replaceAll: { input:
              { $toLower: { $regexFind: { input: '$title', regex: /^[^([]+/ } }.match || '$title' },
              find: '  ', replacement: ' ' }
            }
          }
        },
        artist: 1
      }},
      { $group: { _id: '$normTitle', artists: { $addToSet: '$artist' }, count: { $sum: 1 } } },
      { $match: { $expr: { $gte: [{ $size: '$artists' }, 2] } } },
      { $count: 'groups' }
    ]);
    const duplicates_groups = dupeAgg[0]?.groups ?? 0;

    const ghost = missing_phase + incoherent_arrival_high + incoherent_groove_low + incoherent_closing_electro + missing_bpm;
    // Deduplicated estimate (many tracks fall in multiple categories)
    const ghost_estimated = Math.min(ghost, Math.round(total * 0.37)); // rough dedup

    res.json({
      total,
      safe: total - Math.min(missing_phase, total),
      ghost: ghost,
      updatedAt: new Date().toISOString(),
      categories: {
        orphan:                   missing_phase,
        incoherent_arrival_high:  incoherent_arrival_high,
        incoherent_groove_low:    incoherent_groove_low,
        incoherent_closing_electro: incoherent_closing_electro,
        missing_bpm:              missing_bpm,
        missing_rank:             missing_rank,
        duplicates_groups:        duplicates_groups,
        blocked:                  blocked
      },
      topGenres: byGenre
    });
  } catch (err) {
    console.error('[Admin] ❌ ghost/dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/ghost.html
app.get('/admin/ghost.html', (req, res) => {
  res.sendFile(join(__dirname, 'admin', 'ghost.html'));
});

// GET /api/monitor/track/:id — un track par ID
app.get('/api/monitor/track/:id', adminAuth, async (req, res) => {
  try {
    const id = req.params.id;
    let query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { "providers.deezer.trackId": Number(id) };
    const t = await Track.findOne(query).lean();
    if (!t) return res.status(404).json({ error: "Track not found" });
    
    res.json({
      ...t,
      id: t.providers?.deezer?.trackId || t._id.toString(),
      is_labeled: t.isLabeled,
      gpt_suggestion: t.gptSuggestion
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/monitor/track/:id — sauvegarder les modifications
app.patch('/api/monitor/track/:id', adminAuth, async (req, res) => {
  try {
    const id = req.params.id;
    let query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { "providers.deezer.trackId": Number(id) };
    const t = await Track.findOne(query);
    if (!t) return res.status(404).json({ error: "Track not found" });

    const body = req.body;
    if (body.genre !== undefined) t.genreBDD = body.genre;
    if (body.phase !== undefined) t.phase = body.phase;
    if (body.energy !== undefined) t.energy = Math.min(10, Math.max(1, Number(body.energy)));
    if (body.danceability !== undefined) t.danceability = Math.min(1, Math.max(0, Number(body.danceability)));
    if (body.uiCategoryPrimary !== undefined) t.uiCategoryPrimary = body.uiCategoryPrimary;
    if (body.uiCategoriesSecondary !== undefined) t.uiCategoriesSecondary = body.uiCategoriesSecondary;
    if (body.phaseAlternate !== undefined) t.phaseAlternate = body.phaseAlternate;
    if (body.era !== undefined) t.era = body.era;
    if (body.mood !== undefined) t.mood = body.mood;
    if (body.language !== undefined) t.language = body.language;
    if (body.isBanger !== undefined) t.isBanger = Boolean(body.isBanger);
    if (body.isSingalong !== undefined) t.isSingalong = Boolean(body.isSingalong);
    if (body.isEmotional !== undefined) t.isEmotional = Boolean(body.isEmotional);
    if (body.isCaliente !== undefined) t.isCaliente = Boolean(body.isCaliente);
    if (body.isHardcore !== undefined) t.isHardcore = Boolean(body.isHardcore);
    if (body.isFiller !== undefined) t.isFiller = Boolean(body.isFiller);
    if (body.needs_review !== undefined) t.needs_review = Boolean(body.needs_review);
    if (body.isVerified !== undefined) t.isVerified = Boolean(body.isVerified);
    if (body.hasLyrics !== undefined) t.hasLyrics = Boolean(body.hasLyrics);
    if (body.explicit !== undefined) t.explicit = Boolean(body.explicit);
    if (body.notes !== undefined) t.notes = body.notes;
    
    t.isLabeled = body.is_labeled !== undefined ? Boolean(body.is_labeled) : true;
    
    if (t.isLabeled) {
      t.gptSuggestion = null;
      t.chatgptQueueId = null;
    }
    
    if (body.bpm !== undefined && body.bpm > 0) t.bpm = Number(body.bpm);
    
    t.lastReviewedAt = new Date();

    await t.save();
    res.json(t);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/import-gpt
app.post('/api/admin/import-gpt', adminAuth, async (req, res) => {
  try {
    const arr = req.body.tracks;
    if (!Array.isArray(arr)) return res.status(400).json({ error: "Invalid array" });

    // Patch défensif : Anti-Template (Détection stricte ChatGPT mode fichier)
    if (arr.length >= 20) {
      const uniqueGenres = new Set(arr.map(t => t.genreBDD));
      const uniquePhases = new Set(arr.map(t => t.phase));
      const uniqueEras = new Set(arr.map(t => t.era));
      const uniqueBpms = new Set(arr.map(t => t.bpm));
      const uniqueEnergies = new Set(arr.map(t => t.energy));

      const onesCount = [uniqueGenres, uniquePhases, uniqueEras, uniqueBpms, uniqueEnergies]
        .filter(s => s.size <= 1).length;

      if (onesCount === 5) {
        return res.status(400).json({
          error: "Template fabriqué détecté",
          message: "Les " + arr.length + " tracks ont exactement les mêmes valeurs. C'est un comportement de GPT-4o mode 'fichier'. Utilise Claude Opus 4.8 (claude.ai) et demande une réponse JSON directement dans le chat.",
          diversity: { genres: uniqueGenres.size, phases: uniquePhases.size, eras: uniqueEras.size }
        });
      }
    }

    let updated = 0;
    const queueId = 'gpt_' + Date.now();
    
    for (const up of arr) {
      const id = up.id || up.deezerID;
      if (!id) continue;
      
      let query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { "providers.deezer.trackId": Number(id) };
      const track = await Track.findOne(query);
      
      if (track) {
        track.gptSuggestion = {
          genreBDD: up.genreBDD || null,
          uiCategoryPrimary: up.uiCategoryPrimary || null,
          uiCategoriesSecondary: up.uiCategoriesSecondary || [],
          phase: up.phase || null,
          phaseAlternate: up.phaseAlternate || null,
          energy: up.energy ? Math.min(10, Math.max(1, Number(up.energy))) : null,
          bpm: up.bpm || null,
          danceability: up.danceability ? Math.min(10, Math.max(1, Number(up.danceability))) : null,
          isBanger: up.isBanger || false,
          isSingalong: up.isSingalong || false,
          isEmotional: up.isEmotional || false,
          isCaliente: up.isCaliente || false,
          isHardcore: up.isHardcore || false,
          era: up.era || null,
          mood: up.mood || null,
          language: up.language || null,
          hasLyrics: up.hasLyrics || false,
          explicit: up.explicit || false,
          notes: up.notes || null,
          justification: up.justification || null
        };
        track.isLabeled = false;
        track.needs_review = true;
        track.chatgptQueueId = queueId;
        await track.save();
        updated++;
      }
    }

    res.json({ success: true, updated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/generate-prompt
app.get('/api/admin/generate-prompt', adminAuth, async (req, res) => {
  try {
    const count = parseInt(req.query.count) || 50;
    const wave = req.query.wave || 'V1';
    
    const targets = await Track.find({
      isLabeled: { $ne: true },
      gptSuggestion: null,
      $or: [{ energy: null }, { energy: 0 }]
    }).sort({ deezerRank: -1 }).limit(count).lean();

    if (targets.length === 0) {
      return res.json({ prompt: null, message: "Aucun titre à traiter !" });
    }

    let prompt = `[INSTRUCTION POUR CHATGPT : Lis l'intégralité de ce message (qui peut t'apparaître sous forme de fichier texte joint si le texte est long). Classe les ${targets.length} tracks de la liste à la fin du document en suivant strictement les règles ci-dessous. Tu dois me renvoyer DIRECTEMENT et UNIQUEMENT le JSON Array complet des ${targets.length} objets.]

Tu es un DJ professionnel expert qui aide à classer des tracks pour l'app SocialMix, qui pilote des soirées privées en temps réel.

CONTEXTE SOIRÉE TYPE
- 40-80 invités | 6h à 7h de soirée (20h-2h30 type)
- Public mixte, souvent 25-65 ans
- Soirées privées (anniversaires, mariages, fêtes amis)
- Forte demande de COCOVARIET (chanson française populaire qui se chante : Goldman, Maître Gims, Aya Nakamura, Stromae, Sardou, Cabrel, Souchon, Indila)
- Arrivals tendres et closings émotionnels sont des moments importants

DESCRIPTION DES 6 PHASES (utilise pour calibrer)
🌅 ARRIVAL (apéro chic, energy 3.5-5.0, BPM 70-110)
   Exemples : Sade "Smooth Operator", Norah Jones, Goldman "Encore un matin", Cabrel "Petite Marie", Bossa, Lounge, Soul slow.
   À éviter : House, Electro hard, Rap hardcore

🥂 AMBIANCE (warm-up, energy 5.0-6.5, BPM 80-115)
   Exemples : Pop douce (Sheeran), Disco classics mid-tempo (EWF), R&B old (Marvin Gaye), COCOVARIET (Souchon, Goldman dansants).
   À éviter : House peak, Electro hard

🚀 TAKEOFF (la montée, energy 6.5-7.5, BPM 100-125)
   Exemples : Disco (Donna Summer), Funk (Kool & The Gang), COCOVARIET dansants, Hip-Hop modéré (Drake).

💃 GROOVE (vraiment lancé, energy 7.5-8.5, BPM 115-130)
   Exemples : House mainstream (Calvin Harris), Disco upbeat (Sister Sledge), Pop dance (Bruno Mars), Latin (Shakira).

🔥 PARTY (peak time, energy 8.5-10, BPM 120-135)
   Exemples : House peak (Avicii, Guetta), Electro (Justice), hymnes (Sapés Comme Jamais, Single Ladies, Dancing Queen), bangers Hip-Hop.

🌙 CLOSING (descente émotionnelle, energy 4.5-6.0, BPM 90-115)
   Exemples : Disco classics fin, Soul slow (Bill Withers), COCOVARIET émotionnels (Goldman "Là-bas", Sardou "Le France").

DISTINCTIONS GENRES BDD
- Chill : ambient, lo-fi, acoustic doux (Norah Jones)
- Soul : classics 60s-70s (Marvin Gaye, Aretha)
- Pop : mainstream international (Lady Gaga, Sheeran)
- COCOVARIET : chanson FR populaire (Goldman, Maître Gims, Aya, Stromae, Sardou, Cabrel, Indila, Calogero)
- Rock : classic + indie + pop-rock (Foo Fighters, Oasis)
- Hip-Hop : Rap US + FR + Trap (Drake, Kendrick, PNL, Booba)
- R&B : moderne dansant (Beyoncé) ou groove 90s/2000s (TLC)
- Latin : pop latin, salsa, bachata (Shakira, Bad Bunny)
- Afro : Afrobeat (Burna Boy), Afro House
- Disco : Disco 70s pur (Donna Summer, Bee Gees, EWF)
- Funk : Funk classic + Nu-Funk (Kool & Gang, Bruno Mars)
- House : Deep, Vocal, Tech, Funky House (Avicii, Guetta)
- Electro : EDM, Big Room, Synthwave (Daft Punk, Justice)

FORMAT JSON STRICT
{
  "id": "<string> (l'ID retourné peut être un entier deezerID ou un string MongoDB ObjectId. Conserve-le tel quel en sortie)",
  "genreBDD": "<un parmi : Chill / Soul / Pop / COCOVARIET / Rock / Hip-Hop / R&B / Latin / Afro / Disco / Funk / House / Electro>",
  "uiCategoryPrimary": "<un parmi : Chill / Pop / Rock / Rap / Latin / Old school / Urban Groove / Dance / Électro>",
  "uiCategoriesSecondary": [<0 à 2 catégories UI additionnelles, ne contenant JAMAIS uiCategoryPrimary>],
  "phase": "<arrival / ambiance / takeoff / groove / party / closing>",
  "phaseAlternate": "<phase adjacente ou null>",
  "energy": <entier 1-10>,
  "bpm": <entier 60-220, devine si manquant>,
  "danceability": <float 0.0-1.0>,
  "isBanger": <true si hymne qui fait monter la salle, false>,
  "isSingalong": <true si refrain repris en chœur, false>,
  "isEmotional": <true si émouvant/larme à l'œil, false>,
  "isCaliente": <true si chaleur latine/salsa/reggaeton hot, false>,
  "isHardcore": <true si titre très agressif/extrême/hardcore, false>,
  "era": "<50s / 60s / 70s / 80s / 90s / 2000s / 2010s / 2020s>",
  "mood": "<fun / emotional / aggressive / chill>",
  "language": "<FR / EN / ES / PT / autre>",
  "hasLyrics": <true/false>,
  "explicit": <true/false>,
  "notes": "<note DJ courte ou ''>",
  "justification": "<1 ligne expliquant tes choix>"
}

RÈGLES DE COHÉRENCE STRICTES (auto-vérifier avant réponse)
1. uiCategoriesSecondary NE CONTIENT JAMAIS uiCategoryPrimary
2. phaseAlternate adjacente : arrival↔ambiance, ambiance↔takeoff, takeoff↔groove, groove↔party, party↔closing
3. Track BPM 80 ne peut PAS être en party (party = 120-135 min)
4. Track energy <= 4 ne peut PAS être en groove/party
5. isBanger=true → phase IMPÉRATIVEMENT groove ou party
6. COCOVARIET tendre (Goldman ballade) → JAMAIS party
7. Hip-Hop hardcore moderne (Booba, NLE Choppa) → JAMAIS arrival
8. era cohérent avec artiste (Daft Punk = 90s-2010s pas 70s)

CALIBRATION — 5 EXEMPLES VARIÉS

EXEMPLE 1 - Banger FR dansant
Track : Sapés Comme Jamais — Maître Gims
{
  "genreBDD": "COCOVARIET", "uiCategoryPrimary": "Dance",
  "uiCategoriesSecondary": ["Rap", "Pop"], "phase": "party",
  "phaseAlternate": "groove", "energy": 9, "bpm": 115,
  "danceability": 0.92, "isBanger": true, "isSingalong": true,
  "isEmotional": false, "isCaliente": false, "isHardcore": false, "era": "2010s",
  "mood": "fun", "language": "FR", "hasLyrics": true,
  "explicit": false, "notes": "Banger universel public FR",
  "justification": "Hit FR moderne, fait chanter et danser"
}

EXEMPLE 2 - Ballade COCOVARIET tendre
Track : Encore un matin — Goldman
{
  "genreBDD": "COCOVARIET", "uiCategoryPrimary": "Pop",
  "uiCategoriesSecondary": [], "phase": "arrival",
  "phaseAlternate": "closing", "energy": 4, "bpm": 88,
  "danceability": 0.32, "isBanger": false, "isSingalong": true,
  "isEmotional": true, "isCaliente": false, "isHardcore": false, "era": "90s",
  "mood": "emotional", "language": "FR", "hasLyrics": true,
  "explicit": false, "notes": "Apéro ou closing émotionnel",
  "justification": "Ballade FR universelle"
}

EXEMPLE 3 - R&B 2000s multi-tag
Track : Single Ladies — Beyoncé
{
  "genreBDD": "R&B", "uiCategoryPrimary": "Old school",
  "uiCategoriesSecondary": ["Dance", "Urban Groove"],
  "phase": "party", "phaseAlternate": "groove", "energy": 9,
  "bpm": 97, "danceability": 0.85, "isBanger": true,
  "isSingalong": true, "isEmotional": false, "isCaliente": false, "isHardcore": false,
  "era": "2000s", "mood": "fun", "language": "EN",
  "hasLyrics": true, "explicit": false,
  "notes": "Hit transversal", 
  "justification": "Banger 2000s classique multi-vibe"
}

EXEMPLE 4 - House banger moderne
Track : Levels — Avicii
{
  "genreBDD": "House", "uiCategoryPrimary": "Dance",
  "uiCategoriesSecondary": ["Électro"], "phase": "party",
  "phaseAlternate": "groove", "energy": 9, "bpm": 126,
  "danceability": 0.95, "isBanger": true, "isSingalong": false,
  "isEmotional": false, "isCaliente": false, "era": "2010s",
  "mood": "fun", "language": "EN", "hasLyrics": true,
  "explicit": false, "notes": "Hymne dancefloor 2010s",
  "justification": "Banger House mainstream"
}

EXEMPLE 5 - Soul/Pop lounge pour arrival
Track : Smooth Operator — Sade
{
  "genreBDD": "Soul", "uiCategoryPrimary": "Chill",
  "uiCategoriesSecondary": [], "phase": "arrival",
  "phaseAlternate": "ambiance", "energy": 4, "bpm": 86,
  "danceability": 0.55, "isBanger": false, "isSingalong": false,
  "isEmotional": false, "isCaliente": false, "isHardcore": false, "era": "80s",
  "mood": "chill", "language": "EN", "hasLyrics": true,
  "explicit": false, "notes": "Apéro classy",
  "justification": "Soul/Pop 80s lounge"
}

AVANT DE RÉPONDRE - AUTO-CHECK OBLIGATOIRE
Pour chaque track classifiée, vérifie SILENCIEUSEMENT :
1. phase cohérente avec energy et BPM
2. phaseAlternate adjacente à phase
3. uiCategoriesSecondary n'inclut PAS uiCategoryPrimary
4. Si isBanger=true, phase ∈ [groove, party]
5. era cohérent avec l'artiste
Si tu trouves une incohérence, AJUSTE avant de finaliser.

INSTRUCTIONS FINALES
- Si tu hésites, propose ton meilleur guess
- Si tu ne connais pas la track : devine à partir du titre/artiste/BPM/genre historique
- Réponds STRICTEMENT en JSON Array, sans markdown, sans préambule

LISTE DES ${targets.length} TRACKS À TRAITER
`;
    targets.forEach((t, i) => {
      let artistName = typeof t.artist === 'object' ? t.artist.name : t.artist;
      const did = (t.providers?.deezer?.trackId && t.providers?.deezer?.trackId > 0) ? t.providers?.deezer?.trackId : t._id.toString();
      prompt += `${i+1}. ID ${did} | "${t.title}" — ${artistName} | BPM:${t.bpm || '?'} | genreBDD historique: ${t.genreBDD || t.genre || '?'} | phase historique: ${t.phase || t._legacyPhase || '?'} | rank: ${t.deezerRank || '?'}\n`;
    });
    
    prompt += `\nRÉPONSE ATTENDUE :\nArray JSON de ${targets.length} objets, dans l'ordre des tracks.`;

    res.json({ prompt, count: targets.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/monitor/live-stats
app.get('/api/monitor/live-stats', adminAuth, async (req, res) => {
  try {
    const total = await Track.countDocuments({});
    
    const byQuality = {
      complete: await Track.countDocuments({ qualityLevel: 'complete' }),
      platine: await Track.countDocuments({ qualityLevel: 'platine' }),
      partielle: await Track.countDocuments({ qualityLevel: 'partielle' }),
      vide: await Track.countDocuments({ qualityLevel: 'vide' })
    };
    
    const startOfDay = new Date();
    startOfDay.setHours(0,0,0,0);
    
    const todayComplete = await Track.countDocuments({ lastReviewedAt: { $gte: startOfDay }, qualityLevel: 'complete' });
    const todayPlatine = await Track.countDocuments({ lastReviewedAt: { $gte: startOfDay }, qualityLevel: 'platine' });
    const sessionClassified = await Track.countDocuments({ lastReviewedAt: { $gte: startOfDay } });
    
    let speedPerMin = 0;
    const firstReviewedToday = await Track.findOne({ lastReviewedAt: { $gte: startOfDay } }).sort({ lastReviewedAt: 1 }).lean();
    if (firstReviewedToday && sessionClassified > 0) {
      const minSinceStart = Math.max(1, Math.round((new Date() - firstReviewedToday.lastReviewedAt) / 60000));
      speedPerMin = Math.round(sessionClassified / minSinceStart);
    }
    
    if (speedPerMin === 0 && (todayComplete + todayPlatine) > 0) speedPerMin = 2;
    
    const remaining = (byQuality.vide || 0) + (byQuality.partielle || 0);
    const etaMinutes = speedPerMin > 0 ? Math.round(remaining / speedPerMin) : 0;
    
    const chatgptQueue = await Track.countDocuments({ chatgptQueueId: { $ne: null } });
    
    res.json({
      total,
      byQuality,
      today: { complete: todayComplete, platine: todayPlatine },
      speedPerMin,
      etaMinutes,
      chatgptQueue
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/monitor/export — télécharge curated_base_v3.json depuis le serveur
app.get('/api/monitor/export', adminAuth, (req, res) => {
  try {
    const db = loadCuratedDB();
    const filename = `curated_base_v3_${new Date().toISOString().slice(0,10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(db);
    console.log(`[Monitor] ⬇️ Export: ${db.tracks?.length || 0} tracks téléchargés`);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', details: err.message });
  }
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

app.post('/api/party/schedule', express.json({limit: '5mb'}), async (req, res) => {
  const { code, hostSecret, scheduledFor, welcomeText, coverPhoto, profile } = req.body;
  if (!code || !hostSecret) return res.status(400).json({ error: 'Missing code or hostSecret' });
  
  try {
    const newParty = {
      code: code.toUpperCase(),
      hostSecret,
      scheduledFor,
      welcomeText,
      coverPhoto,
      isPreParty: true,
      hostProfile: profile
    };
    const savedParty = await Party.findOneAndUpdate({ code: newParty.code }, newParty, { upsert: true, new: true });
    console.log(`[HTTP] 📅 Scheduled Pre-Party ${savedParty.code}`);
    res.json({ success: true, party: { code: savedParty.code } });
  } catch (e) {
    console.error('[HTTP] ❌ Schedule error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/party/:code/suggestion/:suggId/boost ─────────────────────────
// Permet à un guest de booster la suggestion d'un autre guest
// Règles : anti-auto-boost, anti-double-boost, status actif seulement
app.post('/api/party/:code/suggestion/:suggId/boost', async (req, res) => {
  const code   = (req.params.code || '').toUpperCase();
  const suggId = req.params.suggId;
  const { guestId, guestName } = req.body || {};

  if (!guestId || !guestName) return res.status(400).json({ error: 'guestId + guestName requis' });

  let party = parties.get(code);
  if (!party) {
    const dbParty = await Party.findOne({ code }).lean();
    if (!dbParty) return res.status(404).json({ error: 'Soirée introuvable' });
    party = dbParty;
  }

  // Trouver la suggestion par UUID
  const sugg = (party.suggestions || []).find(s => s.id === suggId);
  if (!sugg) return res.status(404).json({ error: 'Suggestion introuvable' });

  // Guard 1 : status actif seulement
  if (!['pending', 'queued', 'next'].includes(sugg.status)) {
    return res.status(409).json({ error: 'Suggestion déjà jouée ou rejetée' });
  }

  // Guard 2 : anti-auto-boost (pas sa propre suggestion)
  if (sugg.guestId === guestId || sugg.socketId === guestId) {
    return res.status(409).json({ error: 'Tu ne peux pas booster ta propre suggestion' });
  }

  // Guard 3 : anti-double-boost
  if (!sugg.boostedBy) sugg.boostedBy = [];
  if (sugg.boostedBy.includes(guestId)) {
    return res.status(409).json({ error: 'Tu as déjà boosté cette suggestion' });
  }

  // Appliquer le boost
  sugg.boostCount = (sugg.boostCount || 0) + 1;
  sugg.boostedBy.push(guestId);
  party.isDirty = true;

  // Gamification :
  // - Guest boost  → +3 pts au boosteur, +1 pt au suggéreur
  // ★ Z7: Host boost → 0 pts au host (DJ), +3 pts au suggéreur (validation DJ = signal fort)
  const isHostBoost = (guestId || '').startsWith('host:') || guestId === 'host';
  if (!isHostBoost) {
    addPoints(party, guestId, guestName, 3, `boost: ${sugg.title}`);
  }
  const suggesterPoints = isHostBoost ? 3 : 1; // Host boost = +3 au suggéreur (signal fort)
  if (sugg.guestId && sugg.guestId !== 'host' && !sugg.guestId.startsWith('host:')) {
    addPoints(party, sugg.guestId, sugg.guestName || 'Guest', suggesterPoints, `boost reçu: ${sugg.title}`);
  }

  // Broadcast à toute la soirée (host room + guest room)
  const updatedState = buildLightState(party);
  io.to(code).emit('party:state', updatedState);
  io.to(`host:${code}`).emit('party:state', updatedState);

  const boostLabel = isHostBoost ? '🎧 Host-boost' : '🔥 Boost';
  console.log(`[${code}] ${boostLabel}: "${sugg.title}" → ${sugg.boostCount} boost(s) par ${guestName}`);
  res.json({ ok: true, boostCount: sugg.boostCount, suggId });
});

app.get('/api/party/:code/meta', async (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  let party = parties.get(code);
  
  if (!party) {
    // Check DB
    try {
      const dbParty = await Party.findOne({ code });
      if (!dbParty) {
        return res.status(404).json({ error: 'Party not found' });
      }
      party = dbParty;
    } catch (e) {
      return res.status(500).json({ error: 'Database error' });
    }
  }
  if (party.lifecycle && party.lifecycle.status === 'archived') {
    return res.status(403).json({ error: 'Party archived' });
  }

  // MVP Pre-Party meta fields
  res.json({
    status: party.lifecycle ? party.lifecycle.status : 'live',
    coverPhoto: party.coverPhoto,
    welcomeText: party.welcomeText,
    scheduledFor: party.scheduledFor,
    isPreParty: party.isPreParty,
    guestsWaitingCount: party.participants ? party.participants.length : 0,
    guests: party.participants || [],
    hostProfile: party.hostProfile || null,
    hostName: party.hostProfile ? party.hostProfile.name : 'DJ'
  });
});

app.get('/api/party/:code/explore', async (req, res) => {
  const code = req.params.code;

  try {
    const partyState = parties.get(code);
    if (partyState && partyState.lifecycle && partyState.lifecycle.status === 'archived') {
      return res.status(403).json({ error: 'Party archived' });
    }

    // ★ Phase 4B — Phase-aware explore (7 current + 3 neighbor)
    const PHASE_ORDER = ['arrival', 'ambiance', 'takeoff', 'groove', 'party', 'closing'];
    const currentPhase = (partyState?.currentPhase || 'ambiance').toLowerCase();
    const currentEnergy = partyState?.vibeScore || 5;
    const idx = PHASE_ORDER.indexOf(currentPhase);

    // Neighbor phase: next phase forward, except closing → party (memory lane)
    let neighborPhase = null;
    if (currentPhase === 'closing') {
      neighborPhase = 'party';
    } else if (idx >= 0 && idx < PHASE_ORDER.length - 1) {
      neighborPhase = PHASE_ORDER[idx + 1];
    }

    // Build exclusion sets (played + already suggested)
    const playedTitles = new Set();
    const suggestedTitles = new Set();
    if (partyState) {
      if (partyState.currentTrack?.title) playedTitles.add((partyState.currentTrack.title).toLowerCase());
      (partyState.trackHistory || []).forEach(t => { if (t.title) playedTitles.add(t.title.toLowerCase()); });
      (partyState.suggestions || []).forEach(s => { if (s.title) suggestedTitles.add(s.title.toLowerCase()); });
    }

    // Fisher-Yates shuffle
    const shuffle = arr => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    // Track formatter (compatible with existing web guest renderSuggestResults)
    const formatTrack = t => ({
      id: t.providers?.deezer?.trackId || t.id,
      title: t.title,
      artist: { name: typeof t.artist === 'object' ? t.artist.name : t.artist },
      album: { cover_medium: t.coverArtURL || (t.providers?.deezer?.albumId ? `https://api.deezer.com/album/${t.providers.deezer.albumId}/image` : null) },
      duration: t.duration || 0,
      bpm: Math.round(t.bpm || 0),
      genre: t.genre,
      uiCategoryPrimary: t.uiCategoryPrimary,
      energy: t.energy || 5,
      _phaseSource: t.phase || t.phaseAlternate || currentPhase
    });

    // Filter helper: exclude played/suggested, require deezerID
    const isEligible = t => {
      const deezerID = t.providers?.deezer?.trackId;
      if (!deezerID) return false;
      const titleLow = (t.title || '').toLowerCase();
      return !playedTitles.has(titleLow) && !suggestedTitles.has(titleLow);
    };

    let currentPool = [], neighborPool = [];

    if (typeof Track !== 'undefined' && Track.find) {
      try {
        // 7 tracks from current phase (energy ±2)
        const rawCurrent = await Track.find({
          $or: [{ phase: currentPhase }, { phaseAlternate: currentPhase }],
          isBlocked: { $ne: true },
          adminQualified: true,
          'providers.deezer.trackId': { $gt: 0 },
          energy: { $gte: Math.max(1, currentEnergy - 2), $lte: Math.min(10, currentEnergy + 2) }
        }).limit(40).lean();

        currentPool = shuffle(rawCurrent.filter(isEligible)).slice(0, 7).map(formatTrack);

        // 3 tracks from neighbor phase
        if (neighborPhase) {
          const rawNeighbor = await Track.find({
            $or: [{ phase: neighborPhase }, { phaseAlternate: neighborPhase }],
            isBlocked: { $ne: true },
            adminQualified: true,
            'providers.deezer.trackId': { $gt: 0 }
          }).limit(25).lean();

          neighborPool = shuffle(rawNeighbor.filter(isEligible)).slice(0, 3).map(formatTrack);
        }
      } catch (e) {
        console.log('[Explore] MongoDB error, falling back to generic logic:', e.message);
      }
    }

    // Fallback: if MongoDB returned nothing, use generic curated JSON (no phase filter)
    if (currentPool.length === 0 && fs.existsSync(CURATED_DB_PATH)) {
      const db = JSON.parse(fs.readFileSync(CURATED_DB_PATH, 'utf-8'));
      const allTracks = (db.tracks || []).filter(t => t.providers?.deezer?.trackId && !playedTitles.has((t.title||'').toLowerCase()));
      const fmt = t => ({
        id: t.providers.deezer.trackId,
        title: t.title,
        artist: { name: t.artist },
        album: { cover_medium: t.coverArtURL || null },
        duration: t.duration || 0,
        bpm: Math.round(t.bpm || 0),
        genre: t.genre,
        uiCategoryPrimary: t.uiCategoryPrimary,
        energy: t.energy || 5,
        _phaseSource: currentPhase
      });
      currentPool = shuffle([...allTracks]).slice(0, 7).map(fmt);
      neighborPool = shuffle([...allTracks]).slice(7, 10).map(fmt);
    }

    const data = [...currentPool, ...neighborPool];

    res.json({
      data,
      meta: {
        currentPhase,
        neighborPhase,
        currentEnergy,
        counts: { current: currentPool.length, neighbor: neighborPool.length }
      }
    });
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
  party.photos = cappedPush(party.photos, photo, 200);
  return true;
}

function updateActivity(party) {
  if (party && party.lifecycle) {
    party.lifecycle.lastActivityAt = new Date().toISOString();
  }
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
    playedKeys: party.playedKeys || [],  // ★ Phase 3: anti-replay keys
    createdAt: party.createdAt,          // ★ Phase 4: restore DJBrain session start date
    scheduledFor: party.scheduledFor,    // ★ MVP Pre-Party
    welcomeText: party.welcomeText,      // ★ MVP Pre-Party
    coverPhoto: party.coverPhoto,        // ★ MVP Pre-Party
    isPreParty: party.isPreParty,        // ★ MVP Pre-Party
    // ★ Phase 4A — Phase Indicator: expose current phase + energy to web guest
    currentPhase: party.currentPhase || null,
    vibeScore: party.vibeScore || 5,
    nextTrack: party.nextTrack || null   // ★ Phase 4: next track preview
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
        // host:startParty and host:scheduleParty set the secret — skip validation
        if (event === 'host:startParty' || event === 'host:scheduleParty') {
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

  socket.on('host:scheduleParty', async (data) => {
    const code = (data.code || '').toUpperCase();
    if (!code) return;
    
    socket.partyCode = code;
    socket.join(`host:${code}`);
    cancelCleanup(code);

    const newParty = {
      code,
      hostSecret: data.hostSecret,
      partyType: 'hosted',
      scheduledFor: data.scheduledFor,
      welcomeText: data.welcomeText || '',
      coverPhoto: data.coverPhoto || null,
      isPreParty: true,
      createdAt: new Date(),
      isDirty: true
    };
    
    let partyState = parties.get(code);
    if (!partyState) {
      partyState = createPartyState(code);
      parties.set(code, partyState);
    }
    
    Object.assign(partyState, newParty);
    partyState.hostSocketId = socket.id;
    partyState.hostProfile = data.profile || null;
    
    // Initial host participant
    partyState.participants = [{
      id: socket.id,
      userId: 'host',
      name: data.profile?.name || 'Hôte',
      emoji: data.profile?.emoji || '🎧',
      connected: true,
      isHost: true
    }];

    try {
      await Party.findOneAndUpdate({ code }, newParty, { upsert: true, new: true });
    } catch (e) {
      console.error('[MongoDB] Error saving scheduled party:', e);
    }
    
    socket.emit('party:scheduled', { code, success: true });
  });

  socket.on('host:startParty', async (data) => {
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
      existing.lifecycle.status = 'live';
      existing.lifecycle.lastActivityAt = new Date().toISOString();
      existing.isPreParty = false;

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

    // ── FIX FAILLE 6: Try to recover from MongoDB before creating a blank party ──
    // This handles the case where: server RAM was cleared (restart/crash) AND
    // the iOS host reconnects later with the same code + hostSecret.
    // Without this, a blank party would be flushed to MongoDB, erasing all history.
    if (data.hostSecret) {
      try {
        const dbParty = await Party.findOne({ code, endedAt: null }).lean();
        if (dbParty && dbParty.hostSecret === data.hostSecret) {
          // ✅ Found matching party in DB — restore it to RAM and resume
          // createPartyState is already imported at top of file
          const restoredParty = createPartyState(code);
          restoredParty.mode = dbParty.mode || 'appMix';
          restoredParty.currentTrack = dbParty.currentTrack || null;
          restoredParty.nextTrack = dbParty.nextTrack || null;
          restoredParty.trackHistory = dbParty.trackHistory || [];
          restoredParty.genreVotes = dbParty.genreVotes || {};
          restoredParty.vibeScore = dbParty.vibeScore || 0;
          restoredParty.participants = dbParty.participants || [];
          restoredParty.guestVotes = dbParty.guestVotes || {};
          restoredParty.suggestions = dbParty.suggestions || [];
          restoredParty.hostProfile = data.profile || dbParty.hostProfile || null;
          restoredParty.photos = dbParty.photos || [];
          restoredParty.costumeEntries = dbParty.costumeEntries || [];
          restoredParty.costumeOpen = dbParty.costumeOpen !== false;
          restoredParty.costumeVoters = dbParty.costumeVoters || {};
          restoredParty.participantScores = dbParty.participantScores || {};
          restoredParty.guestGenreVotes = dbParty.guestGenreVotes || {};
          restoredParty.hostSecret = dbParty.hostSecret;
          restoredParty.partyType = dbParty.partyType || 'hosted';
          restoredParty.sessionTokens = dbParty.sessionTokens || {};
          restoredParty.createdAt = dbParty.createdAt ? new Date(dbParty.createdAt).toISOString() : restoredParty.createdAt;
          restoredParty.isDirty = false;
          restoredParty.hostSocketId = socket.id;
          restoredParty.isPreParty = false;
          restoredParty.lifecycle.status = 'live';
          restoredParty.lifecycle.lastActivityAt = new Date().toISOString();

          // Update or insert host participant entry
          const hostIdx = restoredParty.participants.findIndex(p => p.isHost);
          if (hostIdx >= 0) {
            restoredParty.participants[hostIdx].id = socket.id;
            restoredParty.participants[hostIdx].connected = true;
          } else {
            restoredParty.participants.unshift({
              id: socket.id, name: hostName, emoji: hostEmoji,
              photo: data.profile?.photo || null,
              phone: data.profile?.phone || '', email: data.profile?.email || '', instagram: data.profile?.instagram || '',
              partyCode: code, joinedAt: new Date().toISOString(), isHost: true, connected: true
            });
          }

          parties.set(code, restoredParty);
          const guestCount = restoredParty.participants.filter(p => !p.isHost).length;
          console.log(`🔄 Party RECOVERED from MongoDB: ${code} (host: "${hostName}", tracks: ${restoredParty.trackHistory.length}, guests: ${guestCount})`);

          socket.emit('party:state', buildLightState(restoredParty));
          io.to(`guest:${code}`).emit('party:started', { code, profile: restoredParty.hostProfile });
          io.to(`guest:${code}`).emit('participants:update', restoredParty.participants);
          return;
        }
      } catch (dbErr) {
        console.error(`[${code}] ⚠️ MongoDB recovery attempt failed — creating new party:`, dbErr.message);
      }
    }

    // ── NEW party (no existing in RAM, no matching DB record, or recovery failed) ──
    const party = createPartyState(code);
    party.hostSocketId = socket.id;
    party.hostProfile = data.profile || null;
    party.isPreParty = false;

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

      let historySource = track.source || 'dj_brain_auto';
      if (requestedBy.source === 'suggestion') {
          historySource = 'guest_suggestion_fulfilled';
      } else if (party.mode === 'jukebox' && !track.fromSuggestion) { // Rough check for manual Jukebox vs Brain
          // If it was host choosing, maybe we want 'host_jukebox_manual'
          // We will use dj_brain_auto as default fallback
      }

      party.trackHistory = cappedUnshift(party.trackHistory, {
        ...track,
        playedAt: new Date().toISOString(),
        requestedBy,
        source: historySource,
        phase: party.currentPhase || 'unknown'  // ★ Bug 6 fix — persist phase for audit
      }, 500);
      addPoints(party, 'host', 'DJ', 15, 'nouveau titre : ' + track.title);

      // Si c'est une suggestion acceptée, bonus de points au guest
      if (requestedBy.source === 'suggestion' && requestedBy.guestId) {
        addPoints(party, requestedBy.guestId, requestedBy.guestName || 'Guest', 20, `suggestion jouée: ${track.title}`);
      }
    } // end if (isNewTrack)
    } // end if (track)

    // ★ D2 — Sync phase auto DJBrain → serveur → guests web
    // currentPhase est dans track (pas dans un sous-objet) — vérification directe
    if (track && track.currentPhase && track.currentPhase !== party.currentPhase) {
      const newPhase = track.currentPhase.toLowerCase();
      const VALID_PHASES = ['arrival','ambiance','takeoff','groove','party','closing'];
      if (VALID_PHASES.includes(newPhase)) {
        party.currentPhase = newPhase;
        party.isDirty = true;
        const phaseState = buildLightState(party);
        io.to(`guest:${party.code}`).emit('party:state', phaseState);
        io.to(`host:${party.code}`).emit('party:state', phaseState);
        console.log(`[${party.code}] 🎯 Phase auto-sync DJBrain -> ${newPhase}`);
      }
    }

    // ★ R5 fix: requestedBy inclus dans le payload — les guests voient l'attribution en temps réel
    io.to(`guest:${party.code}`).emit('track:update', { ...stripSecret(track), requestedBy });
    console.log(`🎵 [${party.code}] Track: ${track?.title} — ${track?.artist} (by: ${requestedBy.guestName || 'DJ Brain'})`);
  });

  socket.on('host:liveTrackDetected', (payload) => {
    const party = getMutableParty(socket); if (!party) return;
    
    const liveTrack = {
      title: payload.title,
      artist: payload.artist,
      isrc: payload.isrc,
      appleMusicID: payload.appleMusicID,
      artworkURL: payload.artworkURL,
      startedAt: payload.detectedAt || new Date().toISOString(),
      source: 'live_dj_shazam',
      votes: { bof: 0, cool: 0, feu: 0 },
      phase: party.currentPhase || 'unknown'  // ★ Bug 6 fix — persist phase for audit
    };
    
    // Normalize title to prevent adding identical tracks repeatedly
    const normTitle = (t) => (t || '').toLowerCase().replace(/^[^-]+ - /, '').trim();
    const isNewTrack = !party.trackHistory.length ||
      normTitle(party.trackHistory[0]?.title) !== normTitle(liveTrack.title);
      
    if (isNewTrack) {
      // 1. Chercher dans les suggestions récentes (match Levenshtein > 0.85 ou simple sub-match)
      let requestedBy = { source: 'live_dj', guestName: null };
      const identifiedTitle = (liveTrack.title || '').toLowerCase();
      const identifiedArtist = (liveTrack.artist || '').toLowerCase();
      
      const matchIdx = party.suggestions.findIndex(s => {
          const sTitle = (s.title || '').toLowerCase();
          const sArtist = (s.artist || '').toLowerCase();
          return s.status !== 'played' && 
                 (sTitle.includes(identifiedTitle) || identifiedTitle.includes(sTitle)) &&
                 (sArtist.includes(identifiedArtist) || identifiedArtist.includes(sArtist));
      });
      
      if (matchIdx !== -1) {
          const match = party.suggestions[matchIdx];
          requestedBy = { source: 'suggestion', guestName: match.guestName, guestId: match.guestId };
          party.suggestions[matchIdx].status = 'played';
          party.suggestions[matchIdx].playedAt = new Date().toISOString();
          liveTrack.source = 'guest_suggestion_fulfilled';
          
          if (match.guestId) {
             addPoints(party, match.guestId, match.guestName, 50, `suggestion Shazam jouée: ${liveTrack.title}`);
          }
      }
      
      liveTrack.requestedBy = requestedBy;
      
      // Append to trackHistory (at index 0)
      party.trackHistory = cappedUnshift(party.trackHistory, liveTrack, 500);
      addPoints(party, 'host', 'DJ', 20, 'Mix Live Track: ' + liveTrack.title);
    }
    
    party.currentTrack = liveTrack;
    
    // Broadcast
    io.to(`guest:${party.code}`).emit('track:update', liveTrack);
    
    // Emit the enriched history to guests (including votes)
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
    const enrichedHistory = party.trackHistory.map(t => ({
      ...t,
      fireCount: trackVotes[t.title]?.fire || 0,
      likeCount: trackVotes[t.title]?.like || 0,
      mehCount: trackVotes[t.title]?.meh || 0
    }));
    io.to(`guest:${party.code}`).emit('history:update', enrichedHistory);
    console.log(`🎧 [${party.code}] Shazam Live: ${liveTrack.title} — ${liveTrack.artist} (source: ${liveTrack.source})`);
  });


  socket.on('host:modeChange', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    party.mode = data.mode;
    io.to(`guest:${party.code}`).emit('mode:change', stripSecret(data));
    console.log(`🎛️ [${party.code}] Mode: ${data.mode}`);
  });

  // Phase update from host — fired when DJ changes phase in CockpitView
  socket.on('host:phaseUpdate', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    party.currentPhase = data.phase || 'arrival';
    party.isDirty = true;
    console.log(`[${party.code}] Phase -> ${party.currentPhase}`);
    // ★ Fix 2 — broadcaster party:state aux guests + host pour sync widget phase indicator
    const phaseState = buildLightState(party);
    io.to(`guest:${party.code}`).emit('party:state', phaseState);
    io.to(`host:${party.code}`).emit('party:state', phaseState);
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
    party.vibeScore = Math.round(Number(data.vibeScore) || 0); // fix(bug3-B): defensive round — iOS energyLevel is Double
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

  socket.on('guest:join', async (data) => {
    const code = (data.partyCode || '').toUpperCase();
    let party = parties.get(code);
    
    if (!party) {
      // MVP Pre-Party: Try loading from MongoDB
      try {
        const dbParty = await Party.findOne({ code, isPreParty: true });
        if (dbParty) {
          party = createPartyState(code);
          party.hostSecret = dbParty.hostSecret;
          party.scheduledFor = dbParty.scheduledFor;
          party.welcomeText = dbParty.welcomeText;
          party.coverPhoto = dbParty.coverPhoto;
          party.isPreParty = true;
          party.createdAt = dbParty.createdAt;
          party.participants = dbParty.participants || [];
          parties.set(code, party);
        } else {
          socket.emit('party:wrongCode', { message: 'Aucune soirée active. Le DJ doit lancer la soirée depuis l\'app.' });
          return;
        }
      } catch (e) {
        socket.emit('party:wrongCode', { message: 'Erreur serveur.' });
        return;
      }
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

    // ★ Bug 5 fix — Hydrate pending suggestion on fresh join (covers rapid deconnect/reconnect)
    const pendingSuggJoin = (party.suggestions || []).find(s =>
      s.guestName === guestName &&
      ['queued', 'next', 'pending'].includes(s.status)
    );
    if (pendingSuggJoin) {
      const queuePosJoin = party.suggestions
        .filter(s => ['queued', 'next', 'pending'].includes(s.status))
        .indexOf(pendingSuggJoin) + 1;
      socket.emit('suggestion:confirmed', {
        title: pendingSuggJoin.title,
        artist: pendingSuggJoin.artist,
        coverURL: pendingSuggJoin.coverURL || null,
        deezerID: pendingSuggJoin.deezerID || null,
        position: queuePosJoin,
        status: pendingSuggJoin.status,
        sentAt: pendingSuggJoin.sentAt || pendingSuggJoin.queuedAt,
        fromReconnect: true
      });
      console.log(`🔄 [${code}] Hydrated pending suggestion (join) for ${guestName}: "${pendingSuggJoin.title}" (pos:${queuePosJoin})`);
    }
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

    // ★ Bug 5 fix — Hydrate pending suggestion after reconnect
    const pendingSugg = (party.suggestions || []).find(s =>
      s.guestName === guestName &&
      ['queued', 'next', 'pending'].includes(s.status)
    );
    if (pendingSugg) {
      const queuePos = party.suggestions
        .filter(s => ['queued', 'next', 'pending'].includes(s.status))
        .indexOf(pendingSugg) + 1;
      socket.emit('suggestion:confirmed', {
        title: pendingSugg.title,
        artist: pendingSugg.artist,
        coverURL: pendingSugg.coverURL || null,
        deezerID: pendingSugg.deezerID || null,
        position: queuePos,
        status: pendingSugg.status,
        sentAt: pendingSugg.sentAt || pendingSugg.queuedAt,
        fromReconnect: true
      });
      console.log(`🔄 [${code}] Hydrated pending suggestion for ${guestName}: "${pendingSugg.title}" (pos:${queuePos})`);
    }

    // ★ Bug 5 fix — Hydrate guest’s own votes after reconnect
    const myVotes = party.guestVotes?.[participant.id] ||
                    party.guestVotes?.[participant.userId] || {};
    if (Object.keys(myVotes).length > 0) {
      socket.emit('votes:hydrate', { myVotes });
    }

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
    updateActivity(party);
    if (!party.guestVotes[data.guestId]) party.guestVotes[data.guestId] = {};
    party.guestVotes[data.guestId][data.trackId || 'current'] = data.type;
    io.to(`host:${party.code}`).emit('guest:voted', data);
    io.to(`guest:${party.code}`).emit('guest:voted', data);
    if (data.guestId) addPoints(party, data.guestId, data.guestName || 'Guest', 10, `vote ${data.type}`);
    
    // ★ Bug 7 fix — persist vote counters directly in trackHistory
    if (data.trackTitle) {
      const voted = party.trackHistory.find(t =>
        (t.title || '').toLowerCase() === (data.trackTitle || '').toLowerCase()
      );
      if (voted) {
        if (data.type === 'fire') voted.votesFeu = (voted.votesFeu || 0) + 1;
        else if (data.type === 'like') voted.votesTop = (voted.votesTop || 0) + 1;
        else if (data.type === 'meh')  voted.votesBof  = (voted.votesBof  || 0) + 1;
        party.isDirty = true;  // déclenche flush MongoDB
      }
    }

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
    updateActivity(party);
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

  // Phase adjacency — a track is OK if its phase OR phaseAlternate is in this list
  const PHASE_ADJACENCY = {
    arrival:  ['arrival', 'ambiance'],
    ambiance: ['ambiance', 'arrival', 'groove'],
    groove:   ['groove', 'ambiance', 'takeoff', 'party'],
    takeoff:  ['takeoff', 'groove', 'party'],
    party:    ['party', 'groove', 'takeoff'],
    closing:  ['closing', 'ambiance', 'arrival']
  };

  socket.on('guest:suggest', async (data) => {
    const party = getMutableParty(socket); if (!party) return;
    updateActivity(party);

    const title    = data.title  || data.query || '';
    const artist   = data.artist || '';
    const deezerID = data.deezerID || 0;

    // 1. Deja joue ce soir ?
    const alreadyPlayed = (party.playedKeys || []).some(k =>
      k === String(deezerID)
    ) || party.trackHistory.some(t =>
      (t.title || '').toLowerCase() === title.toLowerCase()
    );
    if (alreadyPlayed) {
      socket.emit('suggestion:status', {
        title, artist, status: 'already_played',
        message: 'Ce titre a déjà été joué ce soir !'
      });
      if (data.guestId || data.guestName)
        addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 2, `suggest (deja joue): ${title}`);
      return;
    }

    // 2. Deja en queue ?
    const alreadyQueued = party.suggestions.some(s =>
      (s.title || '').toLowerCase() === title.toLowerCase() &&
      ['pending', 'queued', 'next'].includes(s.status)
    );
    if (alreadyQueued) {
      socket.emit('suggestion:status', {
        title, artist, status: 'duplicate',
        message: "Quelqu'un l'a déjà demandé — ça monte dans la liste !"
      });
      if (data.guestId || data.guestName)
        addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 2, `suggest (doublon): ${title}`);
      return;
    }

    // 3. Enregistrer la suggestion
    const suggestion = {
      ...data,
      id: randomUUID(),       // ★ boost: identifiant pérenne
      status: 'pending',
      sentAt: new Date().toISOString(),
      queuedAt: null, playingAt: null, playedAt: null, dismissedAt: null,
      socketId: socket.id,
      boostCount: 0,          // ★ boost: compteur
      boostedBy: []           // ★ boost: [guestId] anti-double/auto
    };
    party.suggestions = cappedPush(party.suggestions, suggestion, 200);
    const hostRoom = `host:${party.code}`;
    io.to(hostRoom).emit('guest:suggested', suggestion);
    
    // ★ Fix Z3: broadcast to other guests so they see cross-guest suggestions in real-time
    // Exclude the suggester (they get suggestion:confirmed) and the host (gets guest:suggested)
    socket.to(`guest:${party.code}`).emit('suggestion:added', {
      id:        suggestion.id,
      title:     suggestion.title,
      artist:    suggestion.artist,
      guestId:   suggestion.guestId,
      guestName: suggestion.guestName,
      status:    suggestion.status,
      boostCount: 0,
      boostedBy:  [],
      sentAt:    suggestion.sentAt,
      isHost:    false
    });
    
    if (data.guestId || data.guestName)
      addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 5, `suggestion: ${title}`);

    // 4. Verifier la coherence de phase via MongoDB (async, non-bloquant)
    const currentPhase = party.currentPhase || 'arrival';
    const compatible   = PHASE_ADJACENCY[currentPhase] || [currentPhase];

    if (deezerID) {
      try {
        const track = await Track.findOne(
          { 'providers.deezer.trackId': deezerID, adminQualified: true },
          { phase: 1, phaseAlternate: 1 }
        ).lean();

        if (track) {
          const trackPhase = track.phase || '';
          const trackAlt   = track.phaseAlternate || '';
          const isOK = !trackPhase ||
            compatible.includes(trackPhase) ||
            compatible.includes(trackAlt);

          if (!isOK) {
            socket.emit('suggestion:status', {
              title, artist, status: 'phase_wait',
              message: 'Pas le bon moment — on la garde pour plus tard !'
            });
            console.log(`[${party.code}] SUGGEST PHASE MISMATCH: "${title}" (track:${trackPhase} vs party:${currentPhase})`);
            return;
          }
        }

        // Track OK ou pas en DB => feedback selon taille queue
        const pendingCount = party.suggestions.filter(s => s.status === 'pending').length;
        const msg = pendingCount <= 3
          ? 'Le DJ a bien reçu ta suggestion !'
          : 'Suggestion notée, le DJ gère la playlist !';
        socket.emit('suggestion:status', { title, artist, status: 'received', message: msg });

      } catch (_) {
        socket.emit('suggestion:status', {
          title, artist, status: 'received',
          message: 'Suggestion reçue ! Le DJ va évaluer'
        });
      }
    } else {
      socket.emit('suggestion:status', {
        title, artist, status: 'received',
        message: 'Suggestion reçue ! Le DJ va évaluer'
      });
    }

    const hostSockets = io.sockets.adapter.rooms.get(hostRoom);
    console.log(`[${party.code}] SUGGEST: "${title}" by ${data.guestName || '?'} -> host has ${hostSockets ? hostSockets.size : 0} socket(s)`);
  });

  // FIX FAILLE 3 — Host self-suggestion sync to MongoDB
  // Mirrors guest:suggest but authenticated via hostSecret.
  // Allows host suggestions to be persisted in MongoDB and broadcast to the guest web app.
  socket.on('host:suggest', async (data) => {
    const party = getMutableParty(socket); if (!party) return;

    // 1. Authenticate: hostSecret must match
    if (!data.hostSecret || data.hostSecret !== party.hostSecret) {
      console.warn(`[${party.code}] ⛔ host:suggest REJECTED — invalid hostSecret`);
      return;
    }

    updateActivity(party);

    const title    = data.title  || data.query || '';
    const artist   = data.artist || '';
    const deezerID = data.deezerID || 0;
    const hostDisplayName = data.guestName || party.hostProfile?.name || 'Hôte';

    // 2. Déjà joué ce soir ? (log seulement, on n'empêche pas l'hôte de suggérer)
    const alreadyPlayed = party.trackHistory.some(t =>
      (t.title || '').toLowerCase() === title.toLowerCase()
    );
    if (alreadyPlayed) {
      console.log(`[${party.code}] host:suggest: "${title}" déjà joué — suggestion enregistrée quand même`);
    }

    // 3. Enregistrer la suggestion avec marqueur isHost
    const suggestion = {
      ...data,
      id: randomUUID(),       // ★ boost: identifiant pérenne
      guestId:   'host',
      guestName: hostDisplayName,
      isHost:    true,
      status:    'pending',
      sentAt:    new Date().toISOString(),
      queuedAt: null, playingAt: null, playedAt: null, dismissedAt: null,
      socketId:  socket.id,
      boostCount: 0,          // ★ boost: compteur
      boostedBy: []           // ★ boost: [guestId] anti-double/auto
    };
    party.suggestions = cappedPush(party.suggestions, suggestion, 200);
    party.isDirty = true;

    // 4. Broadcast to guest web app (isHost=true → affichage icône 🎧 côté guest)
    const guestRoom = `guest:${party.code}`;
    io.to(guestRoom).emit('suggestion:added', {
      title,
      artist,
      deezerID,
      suggestedBy:     'host',
      suggestedByName: hostDisplayName,
      isHost:          true,
      status:          'pending',
      sentAt:          suggestion.sentAt
    });

    console.log(`[${party.code}] HOST SUGGEST: "${title}" — ${artist} → broadcast to ${guestRoom}`);
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
          'performance.avgVibeAtPlay': Math.round(Number(vibeScore) || 0), // fix(bug3-B2): round Double vibeScore before Mongo storage
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
        message: `🎉 Bien joué ! "${match.title || match.query}" a été jouée ! +10 pts`
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
        message: `🎶 "${match.title || match.query}" est en file d'attente !`
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
        message: `🔥 C'est la prochaine ! "${match.title || match.query}" arrive !`
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
        message: `Peut-être plus tard ! Le DJ garde ta suggestion en tête 😉`
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

  socket.on('guest:photo', async (data) => {
    const party = getMutableParty(socket); if (!party) return;
    updateActivity(party);
    
    // Payload size guard — reject > 500KB base64 (~375KB raw)
    const payloadSize = (data.dataURL || '').length;
    if (payloadSize > 500 * 1024) {
      console.warn(`📸 [${party.code}] Photo REJECTED: ${Math.round(payloadSize/1024)} KB from ${data.guestName} (cap: 500KB)`);
      socket.emit('photo:error', { error: 'PHOTO_TOO_LARGE', message: '📸 Photo trop volumineuse même après compression. Essayez une photo plus simple.' });
      return;
    }
    
    // Per-guest photo cap (costume photos excluded)
    const GUEST_PHOTO_CAP = 6;
    const guestPhotoCount = party.photos.filter(p => p.guestName === data.guestName && !p.isCostume).length;
    if (guestPhotoCount >= GUEST_PHOTO_CAP) {
      console.warn(`📸 [${party.code}] Photo cap reached for ${data.guestName} (${guestPhotoCount}/${GUEST_PHOTO_CAP})`);
      socket.emit('photo:error', { error: 'PHOTO_LIMIT', message: '📷 Limite atteinte ! Tu as déjà ' + GUEST_PHOTO_CAP + ' photos.' });
      return;
    }
    
    try {
      let photoMeta;
      
      // ★ Fix bonus: if client already uploaded to Cloudinary and sends data.url → skip re-upload
      if (data.url && data.url.startsWith('https://')) {
        console.log(`📸 [${party.code}] Photo already on Cloudinary — skip re-upload`);
        photoMeta = { url: data.url, publicId: null, width: null, height: null };
      } else {
        // 1. Upload Cloudinary (base64 path)
        const uploaded = await uploadPhoto(data.dataURL, party.code);
        photoMeta = { url: uploaded.url, publicId: uploaded.publicId, width: uploaded.width, height: uploaded.height };
      }
      
      const photo = { 
        url: photoMeta.url,
        publicId: photoMeta.publicId,
        width: photoMeta.width,
        height: photoMeta.height,
        guestName: data.guestName || 'Guest', 
        guestId: data.guestId || socket.id,
        caption: data.caption || null, 
        sentAt: new Date().toISOString() 
      };
      
      // 2. Add to party (using cappedPush)
      party.photos = cappedPush(party.photos, photo, 200);
      
      const hostRoom = `host:${party.code}`;
      const hostSockets = io.sockets.adapter.rooms.get(hostRoom);
      socket.broadcast.to(`guest:${party.code}`).emit('photo:shared', photo);
      io.to(hostRoom).emit('guest:photo', photo);
      addPoints(party, data.guestId || socket.id, data.guestName || 'Guest', 20, 'photo');
      console.log(`📸 [${party.code}] Photo ACCEPTED & UPLOADED: ${data.guestName} (${guestPhotoCount + 1}/${GUEST_PHOTO_CAP}, host sockets: ${hostSockets ? hostSockets.size : 0})`);
    } catch (err) {
      console.error(`📸 [${party.code}] Photo UPLOAD FAILED`, err);
      socket.emit('photo:error', { error: 'UPLOAD_FAILED', message: '📸 Échec du téléchargement de la photo.' });
    }
  });

  socket.on('guest:deletePhoto', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const { dataURL, guestName } = data || {};
    if (!dataURL) return;
    
    // We match both dataURL and guestName to ensure they only delete their own
    const idx = party.photos.findIndex(p => p.dataURL === dataURL && p.guestName === guestName);
    if (idx !== -1) {
      party.photos.splice(idx, 1);
      io.to(`host:${party.code}`).emit('photos:update', party.photos);
      io.to(`guest:${party.code}`).emit('photos:update', party.photos);
      console.log(`📸 [${party.code}] Photo DELETED by guest: ${guestName}`);
    }
  });

  socket.on('guest:message', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    updateActivity(party);
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
    
    // ★ Bug 7 fix — persist host vote counters in trackHistory
    if (trackTitle) {
      const voted = party.trackHistory.find(t =>
        (t.title || '').toLowerCase() === (trackTitle || '').toLowerCase()
      );
      if (voted) {
        if (data.type === 'fire') voted.votesFeu = (voted.votesFeu || 0) + 1;
        else if (data.type === 'like') voted.votesTop = (voted.votesTop || 0) + 1;
        else if (data.type === 'meh')  voted.votesBof  = (voted.votesBof  || 0) + 1;
        party.isDirty = true;  // déclenche flush MongoDB
      }
    }
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
    party.lifecycle.status = 'ended';
    party.lifecycle.endedBy = 'host';
    party.lifecycle.lastActivityAt = new Date().toISOString();
    party.endedAt = new Date().toISOString();

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

  socket.on('host:deleteMessage', (data) => {
    const party = getMutableParty(socket); if (!party) return;
    const msgId = data && data.id;
    if (msgId && party.messages) {
      party.messages = party.messages.filter(m => m.id !== msgId);
      io.to(`host:${party.code}`).emit('messages:update', party.messages);
      io.to(`guest:${party.code}`).emit('messages:update', party.messages);
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
  // Run seeding asynchronously so server starts instantly
  seedEditorialCatalog().catch(console.error);

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

// Auto-end after 12h of inactivity
setInterval(() => {
  const now = Date.now();
  for (const party of parties.values()) {
    if (party.lifecycle && party.lifecycle.status === 'live') {
      const lastActivity = new Date(party.lifecycle.lastActivityAt || party.createdAt).getTime();
      if (now - lastActivity > 12 * 60 * 60 * 1000) {
        party.lifecycle.status = 'ended';
        party.lifecycle.endedBy = 'auto_timeout';
        party.endedAt = new Date().toISOString();
        console.log(`⏱️ [${party.code}] Auto-ended after 12h of inactivity`);
        io.to(`host:${party.code}`).emit('party:auto_ended');
        io.to(`guest:${party.code}`).emit('party:ended');
        flushEndedParty(party.code);
        parties.delete(party.code);
      }
    }
  }
}, 30 * 60 * 1000); // Check every 30 minutes
