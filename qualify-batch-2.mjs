/**
 * qualify-batch-2.mjs — Photos 3, 4, 5 de la bibliothèque DJ
 * 60 titres · BPM 121–131 · adminQualified: true · tags: ['dancefloor']
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

const GENRE_MAP = {
  'House': 'House', 'Deep House': 'House', 'Tribal House': 'House',
  'Progressive House': 'House', 'Tech House': 'House',
  'Electro': 'Electro', 'Dance-pop': 'Electro', 'Hands Up': 'Electro',
  'Leftfield': 'Electro', 'Trance': 'Electro', 'Alternative Rock': 'Electro',
  'Synth-pop': 'Disco', 'Jazz': 'House', 'Disco': 'Disco',
  'Pop': 'Pop', 'Latin': 'Latin', 'Reggaeton': 'Reggaeton',
  'Guaracha': 'Latin', 'Rock': 'Latin',
};
function normalizeGenre(g) { return GENRE_MAP[g] || g || 'House'; }

function estimateEnergy(bpm) {
  if (bpm >= 129) return 9;
  if (bpm >= 125) return 9;
  if (bpm >= 121) return 8;
  return 8;
}
function estimateMoment(bpm) {
  return bpm >= 125 ? 'peak' : 'all';
}
function parseDuration(s) {
  if (!s) return 0;
  const [m, sec] = s.split(':').map(Number);
  return (m * 60) + (sec || 0);
}

const tracks = [
  // ── Photo 3 (121–122 BPM) ─────────────────────────────────────────
  { title: 'Later Bitches',         artist: 'The Prince Karma',    genre: 'House',    bpm: 121,   duration: '04:08', year: 2018, deezerId: 510287882 },
  { title: 'Reborn',                artist: 'arodes',              genre: 'House',    bpm: 121,   duration: '07:10', year: 2022, deezerId: 1594457231 },
  { title: 'Famax',                 artist: 'RAFFA GUIDO',         genre: 'House',    bpm: 121,   duration: '05:35', year: 2024, deezerId: 2642151722 },
  { title: 'Your Body',             artist: 'Marten Lou',          genre: 'Electro',  bpm: 121,   duration: '03:48', year: 2022, deezerId: 3230816611 },
  { title: 'Résiste',               artist: 'Yann Muller',         genre: 'Electro',  bpm: 122,   duration: '02:41', year: null, deezerId: 2339030005 },
  { title: 'Belsunce',              artist: 'Mont Rouge',          genre: 'House',    bpm: 122,   duration: '03:09', year: null, deezerId: 3311117271 },
  { title: 'Ven Pa Ca',             artist: 'Joezi',               genre: 'House',    bpm: 122,   duration: '03:25', year: null, deezerId: 2877290402 },
  { title: 'Innerbloom',            artist: 'RÜFÜS DU SOL',        genre: 'House',    bpm: 122,   duration: '09:38', year: 2023, deezerId: 113475002 },
  { title: 'Moth To A Flame',       artist: 'Swedish House Mafia', genre: 'Electro',  bpm: 122,   duration: '07:17', year: 2022, deezerId: 1787557067 },
  { title: 'More Love',             artist: 'Moderat',             genre: 'House',    bpm: 122,   duration: '06:12', year: 2023, deezerId: 2486813731 },
  { title: 'Pushing On',            artist: 'Oliver $',            genre: 'House',    bpm: 122,   duration: '02:43', year: 2014, deezerId: 3155635951 },
  { title: 'Baianá',                artist: 'Bakermat',            genre: 'House',    bpm: 122,   duration: '03:02', year: 2019, deezerId: 798382542 },
  { title: 'I Follow Rivers',       artist: 'Lykke Li',            genre: 'House',    bpm: 122,   duration: '04:40', year: 2011, deezerId: 15165360 },
  { title: 'Forms Of Love',         artist: 'Adam Port',           genre: 'House',    bpm: 122,   duration: '06:04', year: 2022, deezerId: 1746618207 },
  { title: 'My Love for You',       artist: 'Marten Lou',          genre: 'House',    bpm: 122,   duration: '03:26', year: 2002, deezerId: 2477781041 },
  { title: 'Seventh Street',        artist: 'Zac',                 genre: 'House',    bpm: 122,   duration: '07:07', year: 1985, deezerId: 1923908287 },
  { title: 'Another Song To Myself',artist: 'Picture This',        genre: 'Pop',      bpm: 122,   duration: '02:46', year: 1993, deezerId: 2274284527 },
  { title: 'Voyage Voyage',         artist: 'Francis Mercier',     genre: 'House',    bpm: 122,   duration: '03:15', year: 1998, deezerId: 2562451692 },
  { title: 'Bullit',                artist: 'Watermät',            genre: 'House',    bpm: 122,   duration: '03:15', year: 2014, deezerId: 468390352 },
  { title: 'Supernature',           artist: 'Cerrone',             genre: 'Disco',    bpm: 122.8, duration: '04:22', year: 1986, deezerId: 445812132 },

  // ── Photo 4 (123–125 BPM) ─────────────────────────────────────────
  { title: 'We Are Your Friends',   artist: 'Justice',             genre: 'Electro',  bpm: 123,   duration: '04:23', year: 2006, deezerId: 2100102627 },
  { title: 'Horny',                 artist: 'Mousse T.',           genre: 'House',    bpm: 123,   duration: '09:10', year: 2000, deezerId: 3639536972 },
  { title: 'Favourite Game',        artist: 'Rae & Christian',     genre: 'Disco',    bpm: 123,   duration: '09:23', year: 2015, deezerId: 2428475985 },
  { title: 'Gimme Gimme Gimme',     artist: 'Syzz',               genre: 'Electro',  bpm: 123,   duration: '02:33', year: 2020, deezerId: 1484242262 },
  { title: 'Contigo',               artist: 'REBRN',               genre: 'House',    bpm: 123,   duration: '04:02', year: null, deezerId: 2692106502 },
  { title: 'Je dois m\'en aller',   artist: 'Yann Muller',         genre: 'House',    bpm: 123,   duration: '03:19', year: null, deezerId: 3409146481 },
  { title: 'Verona',                artist: 'Mili',                genre: 'House',    bpm: 123,   duration: '03:48', year: null, deezerId: 2569218732 },
  { title: 'Because You Move Me',   artist: 'Tinlicker',           genre: 'House',    bpm: 123,   duration: '03:16', year: 2017, deezerId: 1489933842 },
  { title: 'Introduction',          artist: 'Aaron Baron',         genre: 'House',    bpm: 123,   duration: '08:51', year: 1971, deezerId: 365770611 },
  { title: 'Intro',                 artist: 'Alan Braxe',          genre: 'House',    bpm: 123.9, duration: '04:55', year: 2000, deezerId: 1702170497 },
  { title: 'Opera',                 artist: 'Marasi',              genre: 'House',    bpm: 124,   duration: '02:38', year: 2024, deezerId: 2670522762 },
  { title: 'Tout le monde est fou', artist: 'Jain',                genre: 'Electro',  bpm: 124,   duration: '06:36', year: null, deezerId: 3190936781 },
  { title: 'Adore',                 artist: 'Bob Sinclar',         genre: 'House',    bpm: 124,   duration: '03:29', year: 2000, deezerId: 2680113092 },
  { title: 'All Stars',             artist: 'Martin Solveig',      genre: 'House',    bpm: 124,   duration: '02:50', year: 2017, deezerId: 373219601 },
  { title: 'Spacer',                artist: 'Mooglie',             genre: 'House',    bpm: 124,   duration: '07:08', year: 2023, deezerId: 2233638217 },
  { title: 'Paris',                 artist: 'Mont Rouge',          genre: 'House',    bpm: 124,   duration: '07:00', year: 1965, deezerId: 2405566435 },
  { title: 'Change This Pain For Ecstasy', artist: 'Rex the Dog', genre: 'House',    bpm: 124,   duration: '06:45', year: 2023, deezerId: 2515453531 },
  { title: 'Proper Education',      artist: 'Eric Prydz',          genre: 'House',    bpm: 125,   duration: '06:09', year: 2006, deezerId: 920549062 },
  { title: 'You See the Trouble with Me', artist: 'Black Legend',  genre: 'House',    bpm: 125,   duration: '03:22', year: 2000, deezerId: 414594022 },
  { title: 'More Amor Por Favor',   artist: 'Dylan Linde',         genre: 'House',    bpm: 125,   duration: '03:52', year: null, deezerId: 2570206672 },

  // ── Photo 5 (125–131 BPM) ─────────────────────────────────────────
  { title: 'Seven Nation Army',     artist: 'Dance Fruits Music',  genre: 'Electro',  bpm: 125,   duration: '02:13', year: 2020, deezerId: 1372670872 },
  { title: 'Make Me Feel',          artist: 'oskar med k',         genre: 'Electro',  bpm: 125,   duration: '03:06', year: 2025, deezerId: 3408657731 },
  { title: 'Pretty Baby',           artist: 'Redondo',             genre: 'House',    bpm: 125,   duration: '02:54', year: 2019, deezerId: 671464512 },
  { title: 'Welcome To St. Tropez', artist: 'DJ Antoine',          genre: 'House',    bpm: 125,   duration: '03:16', year: 2010, deezerId: 14405161 },
  { title: 'Hung Up',               artist: 'Madonna',             genre: 'House',    bpm: 125,   duration: '05:38', year: 2005, deezerId: 679217 },
  { title: 'Sete',                  artist: 'Blond:ish',           genre: 'House',    bpm: 125,   duration: '03:45', year: 2015, deezerId: 2101999797 },
  { title: 'Intoxicated',           artist: 'Martin Solveig',      genre: 'House',    bpm: 125,   duration: '02:39', year: 2015, deezerId: 3808859012 },
  { title: 'Faded',                 artist: 'Zhu',                 genre: 'House',    bpm: 125,   duration: '03:43', year: 2014, deezerId: 77542036 },
  { title: 'La Tarde Se Ha Puesto Triste', artist: 'Dr. Kucho!',  genre: 'House',    bpm: 125,   duration: '07:45', year: 2010, deezerId: 2422118875 },
  { title: 'Miss You',              artist: 'Oliver Tree',         genre: 'Pop',      bpm: 125,   duration: '05:40', year: 2023, deezerId: 2099670727 },
  { title: 'Yakalongo',             artist: 'Ugo Banchi',          genre: 'House',    bpm: 125,   duration: '04:18', year: 2023, deezerId: 2184848677 },
  { title: 'Palomar',               artist: 'Monkey Safari',       genre: 'House',    bpm: 125,   duration: '06:45', year: 2020, deezerId: 1915841017 },
  { title: 'The Bomb!',             artist: 'The Bucketheads',     genre: 'House',    bpm: 125.9, duration: '03:23', year: 1994, deezerId: 78115474 },
  { title: 'My Paradise',           artist: 'Jamie Jones',         genre: 'House',    bpm: 128,   duration: '02:51', year: 2022, deezerId: 3155984871 },
  { title: 'We Are Perfect',        artist: 'Cristian Marchi',     genre: 'Electro',  bpm: 129,   duration: '05:06', year: 2007, deezerId: 517144922 },
  { title: 'DESPECHÁ',              artist: 'ROSALÍA',             genre: 'Latin',    bpm: 130,   duration: '02:37', year: 2025, deezerId: 1841999507 },
  { title: 'Glue',                  artist: 'Bicep',               genre: 'House',    bpm: 130,   duration: '04:01', year: 2019, deezerId: 795642332 },
  { title: 'Exotica',               artist: 'Gabry Ponte',         genre: 'Electro',  bpm: 130,   duration: '02:01', year: 2021, deezerId: 3175052941 },
  { title: 'Pepas',                 artist: 'Farruko',             genre: 'Latin',    bpm: 130,   duration: '04:47', year: 2021, deezerId: 1411181832 },
  { title: 'Freed From Desire',     artist: 'Gala',                genre: 'Electro',  bpm: 131,   duration: '03:31', year: 2024, deezerId: 2855541182 },
];

// ── Batch update ───────────────────────────────────────────────────
let updated = 0, notFound = 0, errors = 0;

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
        adminQualified: true,
        tags:           ['dancefloor'],
        partyMoment:    moment,
        energy,
        'providers.deezer.trackId': t.deezerId,
        ...(t.year ? { releaseYear: t.year } : {}),
      }
    };

    // 1. Deezer ID
    let result = await TrackModel.findOneAndUpdate(
      { 'providers.deezer.trackId': t.deezerId },
      payload, { upsert: false }
    );
    // 2. Fallback hash
    if (!result) {
      result = await TrackModel.findOneAndUpdate(
        { fallbackHash: hash }, payload, { upsert: false }
      );
    }

    if (result) {
      console.log(`✅ [${t.bpm} BPM | ⚡${energy}] ${t.title} — ${t.artist}`);
      updated++;
    } else {
      console.log(`⚠️  NOT FOUND: ${t.title} — ${t.artist} (dz${t.deezerId})`);
      notFound++;
    }
  } catch (err) {
    console.error(`❌ ${t.title}: ${err.message}`);
    errors++;
  }
}

console.log(`\n── Résultat batch 2 ──────────────────────`);
console.log(`✅ Mis à jour : ${updated}`);
console.log(`⚠️  Non trouvés : ${notFound}`);
console.log(`❌ Erreurs     : ${errors}`);
console.log(`──────────────────────────────────────────`);

await mongoose.disconnect();
process.exit(0);
