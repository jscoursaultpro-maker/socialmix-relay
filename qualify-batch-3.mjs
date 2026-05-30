/**
 * qualify-batch-3.mjs — Photo 6 (fin de liste, BPM élevés)
 * 7 titres · BPM 131–151 · energy 9 · partyMoment: peak
 */
import mongoose from 'mongoose';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI non défini'); process.exit(1); }

await mongoose.connect(MONGO_URI);
const TrackModel = (await import('./models/Track.js')).default;
console.log('✅ MongoDB connecté\n');

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
function parseDuration(s) {
  if (!s) return 0;
  const [m, sec] = s.split(':').map(Number);
  return (m * 60) + (sec || 0);
}

// Tous à energy 9 — peak time / closing anthems
const tracks = [
  { title: 'Boogie Wonderland', artist: 'Earth, Wind & Fire', genre: 'Disco',    bpm: 131.4, duration: '04:49', year: 1992, deezerId: 611346 },
  { title: 'Basique',           artist: 'Orelsan',            genre: 'Hip-Hop',  bpm: 132,   duration: '02:44', year: 2017, deezerId: 414838122 },
  { title: 'Madrid City',       artist: 'Ana Mena',           genre: 'Latin',    bpm: 132,   duration: '02:53', year: 2019, deezerId: 2454933765 },
  { title: 'Beat It',           artist: 'Michael Jackson',    genre: 'Années 80',bpm: 138.8, duration: '04:18', year: 1983, deezerId: 555640 },
  { title: 'Toxic',             artist: 'Britney Spears',     genre: 'Pop',      bpm: 143,   duration: '03:19', year: 2004, deezerId: 15391618 },
  { title: 'Boyz In Paris',     artist: 'Marnik',             genre: 'Electro',  bpm: 149,   duration: '02:32', year: 2023, deezerId: 2365023705 },
  { title: 'Pedro',             artist: 'Jaxomy',             genre: 'Electro',  bpm: 151,   duration: '02:25', year: 2024, deezerId: 2712128861 },
];

let updated = 0, notFound = 0;

for (const t of tracks) {
  try {
    const hash = fallbackHash(t.title, t.artist);
    const payload = {
      $set: {
        bpm:            Math.round(t.bpm),
        genre:          t.genre,
        duration:       parseDuration(t.duration),
        releaseYear:    t.year,
        adminQualified: true,
        energy:         9,
        tags:           ['dancefloor', 'peak-time'],
        partyMoment:    'peak',
        'providers.deezer.trackId': t.deezerId,
      }
    };
    let result = await TrackModel.findOneAndUpdate({ 'providers.deezer.trackId': t.deezerId }, payload, { upsert: false });
    if (!result) result = await TrackModel.findOneAndUpdate({ fallbackHash: hash }, payload, { upsert: false });

    if (result) { console.log(`✅ [${t.bpm} BPM | ⚡9] ${t.title} — ${t.artist}`); updated++; }
    else { console.log(`⚠️  NOT FOUND: ${t.title} — ${t.artist} (dz${t.deezerId})`); notFound++; }
  } catch (err) { console.error(`❌ ${t.title}: ${err.message}`); }
}

console.log(`\n── Batch 3 ────────────────────────────────`);
console.log(`✅ Mis à jour : ${updated}  ⚠️  Non trouvés : ${notFound}`);
console.log(`───────────────────────────────────────────`);
await mongoose.disconnect();
process.exit(0);
