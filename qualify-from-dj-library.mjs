/**
 * qualify-from-dj-library.mjs
 * Qualification batch depuis les captures Rekordbox/DJ library.
 * 
 * Logique :
 *  - PATCH uniquement (upsert: false) — ne crée JAMAIS de nouveau document
 *  - Lookup par providers.deezer.trackId en priorité → fallbackHash ensuite
 *  - Tous ces titres sont DJ-sélectionnés comme dansants → adminQualified: true
 *  - Energy estimée depuis BPM (conservative, tous dancefloor)
 *  - Genre normalisé vers la taxonomie SocialMix
 */

import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── MongoDB ────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI non défini'); process.exit(1); }

await mongoose.connect(MONGO_URI);
const Track = mongoose.model('Track', (await import('./models/Track.js')).default.schema);
console.log('✅ MongoDB connecté\n');

// ─── Normalisation ─────────────────────────────────────────────────
function normalizeStr(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi, '')
    .replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}
function fallbackHash(title, artist) {
  return `${normalizeStr(title)}_${normalizeStr(artist)}`;
}

const GENRE_MAP = {
  'Hip Hop': 'Hip-Hop', 'Hip-Hop': 'Hip-Hop', 'Rap': 'Hip-Hop',
  'Pop Rap': 'Hip-Hop', 'Trap': 'Hip-Hop',
  'Reggae': 'Reggaeton', 'Reggae-Pop': 'Pop',
  'Latin': 'Latin', 'Reggaeton': 'Reggaeton',
  'Chanson': 'COCOVARIET', 'Funk / Soul': 'Disco', 'Funk/Soul': 'Disco',
  'Nu-Disco': 'Disco', 'Jazz': 'Disco', 'Soul': 'Disco',
  'Drum n Bass': 'Electro', 'Euro House': 'Electro', 'Electro': 'Electro',
  'Vocal': 'Electro', 'Deep Techno': 'Electro',
  'House': 'House', 'Tribal House': 'House', 'Deep House': 'House',
  'Eurodance': 'Années 90', 'Alternative Rock': 'Pop',
  'Rock': 'Rock', 'Nu-Disco': 'Disco',
  'Pop': 'Pop', 'Disco': 'Disco',
};
function normalizeGenre(g) { return GENRE_MAP[g] || g || 'Electro'; }

// Energy depuis BPM (tous sont dansants, baseline = 6)
function estimateEnergy(bpm) {
  if (bpm >= 125) return 9;
  if (bpm >= 120) return 8;
  if (bpm >= 113) return 7;
  if (bpm >= 107) return 7;
  if (bpm >= 102) return 6;
  return 6;
}

// Moment soirée depuis BPM
function estimateMoment(bpm) {
  if (bpm >= 120) return 'peak';
  if (bpm >= 108) return 'all';
  return 'warm-up';
}

// Durée "MM:SS" → secondes
function parseDuration(s) {
  if (!s) return 0;
  const [m, sec] = s.split(':').map(Number);
  return (m * 60) + (sec || 0);
}

// ─── Données extraites des photos DJ library ────────────────────────
// Tous ces titres = sélection DJ dansante → adminQualified: true
const tracks = [
  // ── Photo 1 ──────────────────────────────────────────────────────
  { title: 'Magenta Riddim',        artist: 'DJ Snake',          genre: 'Electro',    bpm: 102,   duration: '03:14', year: 2018, deezerId: 716383932 },
  { title: 'One Dance',             artist: 'Drake',             genre: 'Hip-Hop',    bpm: 104,   duration: '02:54', year: 2016, deezerId: 124603270 },
  { title: 'La Vida Es Un Carnaval',artist: 'Celia Cruz',        genre: 'Latin',      bpm: 104,   duration: '04:37', year: 1999, deezerId: 429989292 },
  { title: 'MAMACITA',              artist: 'Black Eyed Peas',   genre: 'Hip-Hop',    bpm: 105,   duration: '04:11', year: 2020, deezerId: 923495502 },
  { title: 'RITMO',                 artist: 'Black Eyed Peas',   genre: 'Hip-Hop',    bpm: 105,   duration: '03:42', year: 2019, deezerId: 772603752 },
  { title: 'Dancing On Dangerous',  artist: 'Sean Paul',         genre: 'Hip-Hop',    bpm: 105,   duration: '02:04', year: 2021, deezerId: 1298490012 },
  { title: 'Mi Gente',              artist: 'J Balvin',          genre: 'Reggaeton',  bpm: 105,   duration: '03:09', year: 2017, deezerId: 373362011 },
  { title: 'Iko Iko (My Bestie)',   artist: 'Justin Wellington', genre: 'Reggaeton',  bpm: 105,   duration: '03:03', year: 2021, deezerId: 1324559462 },
  { title: 'Havana',                artist: 'Camila Cabello',    genre: 'Latin',      bpm: 105,   duration: '03:37', year: 2017, deezerId: 447098092 },
  { title: 'Yeah!',                 artist: 'Usher',             genre: 'R&B',        bpm: 105,   duration: '04:10', year: 2004, deezerId: 837914 },
  { title: 'Calm Down',             artist: 'Rema',              genre: 'Afro',       bpm: 107,   duration: '03:40', year: 2022, deezerId: 1644464022 },
  { title: 'Stand on the Word',     artist: 'Keedz',             genre: 'House',      bpm: 108,   duration: '03:25', year: 2008, deezerId: 104595916 },
  { title: 'Going Back To My Roots',artist: 'Odyssey',           genre: 'Disco',      bpm: 108,   duration: '03:52', year: 1981, deezerId: 5231814 },
  { title: 'Chocolat',              artist: 'Lartiste',          genre: 'COCOVARIET', bpm: 109,   duration: '03:55', year: 2017, deezerId: 135203382 },
  { title: 'DÁKITI',               artist: 'Bad Bunny',          genre: 'Reggaeton',  bpm: 110,   duration: '03:25', year: 2020, deezerId: 1122450992 },
  { title: 'No Rhyme No Reason',    artist: 'LTJ XPerience',     genre: 'House',      bpm: 110,   duration: '05:52', year: 2004, deezerId: 721269682 },
  { title: 'Wannabe',               artist: 'Spice Girls',       genre: 'Années 90',  bpm: 110,   duration: '02:53', year: 1996, deezerId: 3133738 },
  { title: 'Say So',                artist: 'Doja Cat',          genre: 'Hip-Hop',    bpm: 110,   duration: '03:58', year: 2019, deezerId: 797228462 },
  { title: "Tu m'oublieras",        artist: 'Larusso',           genre: 'COCOVARIET', bpm: 111,   duration: '03:40', year: 1979, deezerId: 3528163 },
  { title: 'Get Down On It',        artist: 'Kool & The Gang',   genre: 'Disco',      bpm: 111.8, duration: '04:54', year: 1981, deezerId: 94556154 },

  // ── Photo 2 ──────────────────────────────────────────────────────
  { title: 'Robot Rock',            artist: 'Daft Punk',         genre: 'House',      bpm: 111.9, duration: '04:48', year: 2005, deezerId: 3155977 },
  { title: 'Loca',                  artist: 'Shakira',           genre: 'COCOVARIET', bpm: 112,   duration: '03:04', year: 2010, deezerId: 79589178 },
  { title: 'Without Me',            artist: 'Eminem',            genre: 'Hip-Hop',    bpm: 112.3, duration: '04:50', year: 2002, deezerId: 916424 },
  { title: "CAN'T STOP THE FEELING!",artist: 'Justin Timberlake',genre: 'Electro',    bpm: 113,   duration: '03:56', year: 2016, deezerId: 124237488 },
  { title: 'D.A.N.C.E',            artist: 'Justice',           genre: 'House',      bpm: 113,   duration: '04:02', year: 2007, deezerId: 10284909 },
  { title: 'Summer Days',           artist: 'Martin Garrix',     genre: 'Electro',    bpm: 114,   duration: '02:44', year: 2019, deezerId: 669567072 },
  { title: 'Femme Like U',          artist: 'K-Maro',            genre: 'Hip-Hop',    bpm: 117,   duration: '04:09', year: 2004, deezerId: 613093802 },
  { title: 'SexyBack',              artist: 'Justin Timberlake', genre: 'Pop',        bpm: 117,   duration: '04:03', year: 2006, deezerId: 565127 },
  { title: 'Murder On The Dancefloor', artist: 'Sophie Ellis-Bextor', genre: 'Disco', bpm: 117.3, duration: '03:50', year: 2001, deezerId: 4181750 },
  { title: 'Cheerleader',           artist: 'OMI',               genre: 'Pop',        bpm: 118,   duration: '03:00', year: 2015, deezerId: 78098991 },
  { title: 'Sea, Sex And Sun',      artist: 'Serge Gainsbourg',  genre: 'COCOVARIET', bpm: 119,   duration: '03:50', year: 1996, deezerId: 1728081337 },
  { title: 'Gimme! Gimme! Gimme!', artist: 'ABBA',              genre: 'Années 80',  bpm: 119.5, duration: '04:49', year: 1982, deezerId: 884041 },
  { title: 'Paradon',               artist: 'Denis Horvat',      genre: 'Electro',    bpm: 120,   duration: '08:43', year: 2018, deezerId: 487281862 },
  { title: 'Waves & Wavs',          artist: 'Ahmed Spins',       genre: 'House',      bpm: 120,   duration: '05:28', year: 2022, deezerId: 2161608057 },
  { title: 'The Rapture Pt.III',    artist: '&ME',               genre: 'House',      bpm: 120,   duration: '06:58', year: 2023, deezerId: 2285438237 },
  { title: 'Paris',                 artist: '&ME',               genre: 'House',      bpm: 120,   duration: '07:23', year: 1980, deezerId: 1668422912 },
  { title: 'Secret ID',             artist: 'Moojo',             genre: 'House',      bpm: 120,   duration: '06:56', year: 2023, deezerId: 2343066935 },
  { title: 'Alors on danse',        artist: 'Stromae',           genre: 'Electro',    bpm: 120,   duration: '03:26', year: 2009, deezerId: 6297555 },
  { title: 'Sarà perché ti amo',   artist: 'Ricchi e Poveri',   genre: 'COCOVARIET', bpm: 120,   duration: '03:10', year: 1981, deezerId: 636405 },
  { title: 'You Are My High',       artist: 'Demon',             genre: 'House',      bpm: 120.9, duration: '03:49', year: 2024, deezerId: 15583799 },
];

// ─── Mise à jour batch ──────────────────────────────────────────────
let updated = 0, notFound = 0, errors = 0;

const TrackModel = mongoose.connection.model('Track');

for (const t of tracks) {
  try {
    const hash = fallbackHash(t.title, t.artist);
    const energy = estimateEnergy(t.bpm);
    const moment = estimateMoment(t.bpm);

    const payload = {
      $set: {
        bpm:            Math.round(t.bpm),
        genre:          normalizeGenre(t.genre),
        duration:       parseDuration(t.duration),
        releaseYear:    t.year,
        adminQualified: true,
        tags:           ['dancefloor'],
        partyMoment:    moment,
        energy,                          // Estimé depuis BPM — à ajuster dans le back-office
        'providers.deezer.trackId': t.deezerId,
      }
    };

    // 1. Cherche par Deezer ID (plus précis)
    let result = await TrackModel.findOneAndUpdate(
      { 'providers.deezer.trackId': t.deezerId },
      payload,
      { upsert: false, new: true }
    );

    // 2. Fallback : cherche par title+artist (fallbackHash)
    if (!result) {
      result = await TrackModel.findOneAndUpdate(
        { fallbackHash: hash },
        payload,
        { upsert: false, new: true }
      );
    }

    if (result) {
      console.log(`✅ [${t.bpm} BPM | energy:${energy}] ${t.title} — ${t.artist}`);
      updated++;
    } else {
      console.log(`⚠️  NOT FOUND: ${t.title} — ${t.artist} (dz${t.deezerId})`);
      notFound++;
    }
  } catch (err) {
    console.error(`❌ ERROR: ${t.title}: ${err.message}`);
    errors++;
  }
}

console.log(`\n── Résultat ──────────────────────────────────`);
console.log(`✅ Mis à jour : ${updated}`);
console.log(`⚠️  Non trouvés : ${notFound}  (à ajouter manuellement si besoin)`);
console.log(`❌ Erreurs     : ${errors}`);
console.log(`─────────────────────────────────────────────`);

await mongoose.disconnect();
process.exit(0);
