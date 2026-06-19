/**
 * export-editorial-seed.mjs
 * Exporte TOUS les titres qualifiés de MongoDB vers editorial_seed.json
 * Format exact attendu par EditorialSeedLoader.swift
 */
import mongoose from 'mongoose';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const MONGO_URI = process.env.MONGO_URI;
const SEED_PATH = process.env.SEED_PATH;
if (!MONGO_URI) { console.error('❌ MONGO_URI manquant'); process.exit(1); }
if (!SEED_PATH) { console.error('❌ SEED_PATH manquant'); process.exit(1); }

await mongoose.connect(MONGO_URI);
const db = mongoose.connection.db;
const col = db.collection('tracks');

function ns(s) {
  return (s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi,'')
    .replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'')
    .replace(/[^a-z0-9\s]/g,'')
    .replace(/\s+/g,' ').trim();
}
function fallbackHash(title, artist) { return `${ns(title)}_${ns(artist)}`; }

// On exporte TOUS les titres qualifiés, SAUF les doublons flaggés
const tracks = await col.find({
  isDuplicate: { $ne: true },
  $or: [
    { adminQualified: true },
    { bpm: { $gt: 0 } },
    { energy: { $gt: 0 } }
  ]
}).toArray();

console.log(`📀 ${tracks.length} titres à exporter`);

// Normalisation des genres pour le seed
const GENRE_MAP = {
  'deep house':'House','progressive house':'House','tech house':'House',
  'tropical house':'House','future house':'House','tribal house':'House',
  'dance-pop':'Electro','eurobeat':'Electro','eurodance':'Electro',
  'trance':'Electro','techno':'Electro','hi nrg':'Electro','hands up':'Electro',
  'electro house':'Electro','progressive breaks':'Electro',
  'hip hop':'Hip-Hop','r&b':'Hip-Hop','trap':'Hip-Hop',
  'drum n bass':'Hip-Hop','contemporary r&b':'Hip-Hop','vocal':'Hip-Hop',
  'funk / soul':'Disco','funk/soul':'Disco','funk':'Disco','nu-disco':'Disco',
  'reggaeton':'Latin','bachata':'Latin','guaracha':'Latin','dancehall':'Latin',
  'chanson':'COCOVARIET','années 80':'COCOVARIET','années 90':'COCOVARIET',
  'folk, world, & country':'COCOVARIET',
  'afrobeat':'Afro','afro house':'Afro',
  'pop rock':'Pop','synth-pop':'Pop','k-pop':'Pop',
  'alternative rock':'Rock',
  'ambient':'Chill','jazz':'Chill',
  'reggae':'Latin',
};
function normalizeGenre(g) {
  const key = (g||'').trim().toLowerCase();
  return GENRE_MAP[key] || (g||'Pop');
}

const seedTracks = tracks.map(t => {
  const hash = t.fallbackHash || fallbackHash(t.title || '', t.artist || '');
  const deezerTrackId = t.providers?.deezer?.trackId || null;
  return {
    isrc: t.isrc || null,
    fallbackHash: hash,
    title: t.title || '',
    artist: t.artist || '',
    album: t.album || null,
    genre: normalizeGenre(t.genre),
    bpm: Math.round(t.bpm || 0),
    energy: t.energy || 0,
    releaseYear: t.releaseYear || null,
    phase: t.phase || null,
    phaseAlternate: t.phaseAlternate || null,
    uiCategoryPrimary: t.uiCategoryPrimary || null,
    uiCategoriesSecondary: t.uiCategoriesSecondary || [],
    danceability: t.danceability || null,
    deezerRank: t.deezerRank || null,
    duration: t.duration || null,
    era: t.era || null,
    mood: t.mood || null,
    language: t.language || null,
    isBanger: t.isBanger || false,
    isSingalong: t.isSingalong || false,
    isEmotional: t.isEmotional || false,
    isCaliente: t.isCaliente || false,
    isHardcore: t.isHardcore || false,
    isFiller: t.isFiller || false,
    providers: deezerTrackId ? {
      deezer: { trackId: deezerTrackId, albumId: null }
    } : null,
    source: 'mongodb',
  };
}).filter(t => t.title && t.artist);  // Exclut les orphelins

const now = new Date().toISOString();
const seedFile = {
  version: 2,
  generatedAt: now,
  trackCount: seedTracks.length,
  tracks: seedTracks,
};

writeFileSync(SEED_PATH, JSON.stringify(seedFile, null, 2), 'utf-8');

// Stats genres
const genres = {};
seedTracks.forEach(t => genres[t.genre] = (genres[t.genre]||0)+1);
const sorted = Object.entries(genres).sort((a,b)=>b[1]-a[1]);

console.log(`\n✅ Exporté ${seedTracks.length} titres → ${SEED_PATH}`);
console.log(`📅 Generated: ${now}`);
console.log('\n── Genres ──');
sorted.forEach(([g,c]) => console.log(`  ${g.padEnd(16)} ${c}`));

await mongoose.disconnect();
process.exit(0);
