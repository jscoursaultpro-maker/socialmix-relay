// scripts/curation/lib.mjs
// Helpers partagés du pipeline de curation automatique (export → Claude → import).
// Aucun secret n'est jamais loggé ici. MONGODB_URI vient de process.env (GitHub Actions secret)
// ou, en local, du fichier .env à la racine du relay-server.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
export const RELAY_ROOT = path.resolve(__dirname, '..', '..');

// ─── Env ──────────────────────────────────────────────────────────────
export function loadMongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
  const envPath = path.join(RELAY_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^(MONGODB_URI|MONGO_URI)=(.*)$/);
      if (m) return m[2].replace(/^"|"$/g, '').trim();
    }
  }
  return null;
}

export async function connectMongo() {
  const uri = loadMongoUri();
  if (!uri) {
    console.error('❌ MONGODB_URI manquant (secret GitHub Actions ou .env local)');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  return mongoose.connection.db;
}

// ─── Dates ────────────────────────────────────────────────────────────
export function todayStamp(d = new Date()) {
  // YYYY-MM-DD en heure de Paris (la routine tourne la nuit, on veut la date "humaine")
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// ─── Normalisation titres / artistes (identité) ───────────────────────
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')      // accents
    .replace(/\((feat|ft|featuring)[^)]*\)/g, ' ')          // (feat. X)
    .replace(/\s(feat|ft|featuring)\.?\s.*$/, ' ')          // feat. X en fin
    .replace(/\[[^\]]*\]/g, ' ')                            // [Remaster 2011]
    .replace(/\((remaster(ed)?|mono|stereo|live|version|edit|mix|radio|original|album|single)[^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeArtist(s) {
  return normalize(String(s || '').split(/\s(?:&|and|,|x|feat\.?|ft\.?)\s/i)[0]);
}

/** Similarité simple (Jaccard sur tokens) — suffisant pour titre/artiste. */
export function similarity(a, b) {
  const A = new Set(normalize(a).split(' ').filter(Boolean));
  const B = new Set(normalize(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// ─── Deezer public API (sans clé) — throttle strict 1 req/s ───────────
const DEEZER_MIN_INTERVAL_MS = Number(process.env.DEEZER_MIN_INTERVAL_MS || 1000);
let lastDeezerCall = 0;

export async function deezerGet(url) {
  const wait = DEEZER_MIN_INTERVAL_MS - (Date.now() - lastDeezerCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastDeezerCall = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': 'AhOuai-curation/1.0 (private use)' } });
  if (res.status === 429) {
    // Quota Deezer : on attend 10 s et on réessaie une seule fois
    await new Promise(r => setTimeout(r, 10000));
    lastDeezerCall = Date.now();
    const retry = await fetch(url);
    return retry.json();
  }
  return res.json();
}

/**
 * Vérifie l'identité d'un track contre Deezer.
 * Retour : { status: 'verified'|'mismatch'|'not_found'|'error', match?: {...}, reason? }
 * - verified : titre+artiste cohérents ET durée à ±DURATION_TOLERANCE s (si durée BDD connue)
 * - mismatch : un id Deezer existe en BDD mais pointe sur un autre titre/artiste/durée
 * - not_found : aucun id Deezer et la recherche ne donne rien de convaincant
 */
export const DURATION_TOLERANCE_S = Number(process.env.DURATION_TOLERANCE_S || 4);

export function compareIdentity(track, dz) {
  const titleSim = similarity(track.title, dz.title);
  const artistSim = Math.max(similarity(track.artist, dz.artist?.name), similarity(normalizeArtist(track.artist), normalizeArtist(dz.artist?.name)));
  const dbDur = Number(track.duration || 0);
  const dzDur = Number(dz.duration || 0);
  const durationKnown = dbDur > 0 && dzDur > 0;
  const durationOk = !durationKnown || Math.abs(dbDur - dzDur) <= DURATION_TOLERANCE_S;
  const ok = titleSim >= 0.5 && artistSim >= 0.5 && durationOk;
  return { ok, titleSim: +titleSim.toFixed(2), artistSim: +artistSim.toFixed(2), durationDelta: durationKnown ? dzDur - dbDur : null };
}

export function pickDeezerFields(dz) {
  return {
    id: dz.id,
    title: dz.title,
    artist: dz.artist?.name || null,
    album: dz.album?.title || null,
    duration: dz.duration || null,
    isrc: dz.isrc || null,
    release_date: dz.release_date || null,
    bpm: dz.bpm || null,
    rank: dz.rank || null,
    explicit_lyrics: dz.explicit_lyrics ?? null,
    link: dz.link || null
  };
}

export async function verifyWithDeezer(track) {
  try {
    const deezerId = track.providers?.deezer?.trackId;
    if (deezerId && deezerId > 0) {
      const dz = await deezerGet(`https://api.deezer.com/track/${deezerId}`);
      if (dz && !dz.error && dz.id) {
        const cmp = compareIdentity(track, dz);
        return cmp.ok
          ? { status: 'verified', via: 'deezer_id', match: pickDeezerFields(dz), cmp }
          : { status: 'mismatch', via: 'deezer_id', match: pickDeezerFields(dz), cmp, reason: 'deezer_id_points_to_other_track' };
      }
      // id invalide → on retombe sur la recherche
    }
    const q = `artist:"${String(track.artist || '').replace(/"/g, '')}" track:"${String(track.title || '').replace(/"/g, '')}"`;
    const search = await deezerGet(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`);
    const candidates = Array.isArray(search?.data) ? search.data : [];
    let best = null;
    for (const c of candidates) {
      const cmp = compareIdentity(track, c);
      const score = cmp.titleSim + cmp.artistSim + (cmp.durationDelta === null ? 0.5 : (Math.abs(cmp.durationDelta) <= DURATION_TOLERANCE_S ? 1 : 0));
      if (cmp.ok && (!best || score > best.score)) best = { c, cmp, score };
    }
    if (best) return { status: 'verified', via: 'deezer_search', match: pickDeezerFields(best.c), cmp: best.cmp };
    return { status: 'not_found', via: 'deezer_search', candidates: candidates.slice(0, 3).map(pickDeezerFields) };
  } catch (err) {
    return { status: 'error', reason: err.message };
  }
}

// ─── JSON helpers ─────────────────────────────────────────────────────
export function readJson(p, fallback = null) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
export function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── Enums doctrine (source : models/Track.js + DOCTRINE_PREMIUM_V2) ──
export const PHASES = ['arrival', 'ambiance', 'takeoff', 'groove', 'party', 'closing'];
export const GENRES_BDD = ['Chill', 'Pop', 'COCOVARIET', 'Rock', 'Hip-Hop', 'R&B', 'Latin', 'Afro', 'Disco', 'House', 'Electro'];
export const UI_CATEGORIES = ['Chill', 'Pop', 'Rock', 'Rap', 'Latin', 'Old school', 'Urban Groove', 'Dance', 'Électro',
  'House', 'Tech House', 'Deep House', 'Afro House', 'Melodic House', 'Techno', 'Amapiano', 'Disco', 'Afro', 'COCOVARIET'];
export const ERAS = ['50s', '60s', '70s', '80s', '90s', '2000s', '2010s', '2020s'];
export const MOODS = ['fun', 'emotional', 'aggressive', 'chill'];
export const LANGUAGES = ['FR', 'EN', 'ES', 'PT', 'instrumental', 'autre'];
export const PARTY_MOMENTS = ['warm-up', 'peak', 'closing', 'all'];
export const CONFIDENCES = ['high', 'medium', 'low'];
