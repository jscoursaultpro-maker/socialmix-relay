/**
 * qualify-batch-4.mjs — Photos 7→10 — Section warm-up + mid BPM (72–113)
 * ~62 nouveaux titres · energy 4→7 · partyMoment: warm-up / all
 */
import mongoose from 'mongoose';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI non défini'); process.exit(1); }
await mongoose.connect(MONGO_URI);
const TrackModel = (await import('./models/Track.js')).default;
console.log('✅ MongoDB connecté\n');

function normalizeStr(s) {
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi,'')
    .replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'')
    .replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
}
function fallbackHash(t,a) { return `${normalizeStr(t)}_${normalizeStr(a)}`; }
function parseDuration(s) {
  if (!s) return 0; const [m,sec]=s.split(':').map(Number); return (m*60)+(sec||0);
}

const GENRE_MAP = {
  'Hip Hop':'Hip-Hop','Trap':'Hip-Hop','Jazzy Hip-Hop':'Hip-Hop',
  'Drum n Bass':'Electro','Dance-pop':'Electro','Dance':'Electro','Synth-pop':'Electro',
  'Synthwave':'Pop',
  'Tech House':'House','Deep House':'House',
  'Funk / Soul':'Disco','Funk/Soul':'Disco','Jazz':'Disco','Italodance':'R&B',
  'Reggae':'Reggaeton','Dancehall':'Afro','Rock':'Années 80',
  'Rock & Roll':'Années 80','Eurodance':'Années 90',
  'Chanson':'COCOVARIET','Vocal':'Pop','Latin':'Latin',
  'Electro':'Electro','House':'House','Pop':'Pop','Disco':'Disco','R&B':'R&B',
};
function normalizeGenre(g,overrideMap) { return overrideMap?.[g] || GENRE_MAP[g] || g || 'Pop'; }

function estimateEnergy(bpm) {
  if (bpm < 78)  return 4;
  if (bpm < 86)  return 5;
  if (bpm < 96)  return 5;
  if (bpm < 103) return 6;
  if (bpm < 110) return 6;
  return 7;
}
function estimateMoment(bpm) {
  if (bpm < 95)  return 'warm-up';
  if (bpm < 113) return 'all';
  return 'all';
}

const tracks = [
  // ── Photo 7 — 72–92 BPM (warm-up) ────────────────────────────────
  { title:'TTU (Too Turnt Up)',  artist:'Flosstradamus',    genre:'Hip-Hop',     bpm:72.5,  duration:'04:02', year:2014, deezerId:79592282 },
  { title:'Booty Time',          artist:'Aazar',            genre:'Hip-Hop',     bpm:75,    duration:'02:59', year:2017, deezerId:435346702 },
  { title:'Surf the Wave',       artist:'Tambour Battant',  genre:'Electro',     bpm:75,    duration:'04:50', year:2017, deezerId:2553607922 },
  { title:'Majesty',             artist:'Apashe',           genre:'Hip-Hop',     bpm:80,    duration:'04:28', year:2018, deezerId:460807092 },
  { title:'You Got Me',          artist:'The Roots',        genre:'Hip-Hop',     bpm:81.1,  duration:'04:19', year:1999, deezerId:88476275 },
  { title:'Fake',                artist:'The Tech Thieves', genre:'House',       bpm:85,    duration:'02:21', year:2007, deezerId:629562252 },
  { title:'The Drop',            artist:'Bro Safari',       genre:'Hip-Hop',     bpm:85,    duration:'03:50', year:2015, deezerId:71547032 },
  { title:'Blinding Lights',     artist:'The Weeknd',       genre:'Pop',         bpm:85.5,  duration:'03:20', year:2020, deezerId:908604612 },
  { title:'Lose Yourself',       artist:'Eminem',           genre:'Hip-Hop',     bpm:85.7,  duration:'05:26', year:2002, deezerId:1109731 },
  { title:'Price Tag',           artist:'Jessie J',         genre:'Pop',         bpm:87.5,  duration:'03:43', year:2011, deezerId:14405185 },
  { title:'Angela',              artist:'Saïan Supa Crew',  genre:'Hip-Hop',     bpm:88,    duration:'03:47', year:1999, deezerId:3135183 },
  { title:'No Diggity',          artist:'Blackstreet',      genre:'R&B',         bpm:88.6,  duration:'05:06', year:1996, deezerId:916496 },
  { title:'Despacito',           artist:'Luis Fonsi',       genre:'Latin',       bpm:89,    duration:'03:49', year:2017, deezerId:143783500 },
  { title:'Hey Mama',            artist:'David Guetta',     genre:'Electro',     bpm:90,    duration:'03:24', year:2015, deezerId:99469540 },
  { title:'Cheap Thrills',       artist:'Sia',              genre:'Pop',         bpm:90,    duration:'03:45', year:2016, deezerId:118986142 },
  { title:'Bailando',            artist:'Enrique Iglesias', genre:'Latin',       bpm:91,    duration:'04:03', year:2014, deezerId:84097475 },
  { title:'Ma Benz',             artist:'Suprême NTM',      genre:'Hip-Hop',     bpm:91,    duration:'04:07', year:1998, deezerId:7741557 },
  { title:'Diamonds',            artist:'Rihanna',          genre:'Pop',         bpm:92,    duration:'03:45', year:2012, deezerId:60978718 },
  { title:'Family Affair',       artist:'Mary J. Blige',    genre:'R&B',         bpm:92.9,  duration:'04:26', year:2001, deezerId:1161679 },
  { title:'Creep',               artist:'TLC',              genre:'R&B',         bpm:92.9,  duration:'04:24', year:1994, deezerId:574778 },

  // ── Photo 8 — 93–100 BPM ──────────────────────────────────────────
  { title:'love nwantiti',       artist:'CKay',             genre:'Afro',        bpm:93,    duration:'02:26', year:2022, deezerId:752155092 },
  { title:'Still D.R.E.',        artist:'Dr. Dre',          genre:'Hip-Hop',     bpm:93.4,  duration:'04:31', year:1999, deezerId:128743581 },
  { title:'Hypnotize',           artist:'The Notorious B.I.G.', genre:'Hip-Hop', bpm:93.9,  duration:'03:50', year:2020, deezerId:3616651 },
  { title:'Con Calma',           artist:'Daddy Yankee',     genre:'Reggaeton',   bpm:94,    duration:'03:01', year:2019, deezerId:667792262 },
  { title:'Thrift Shop',         artist:'Macklemore & Ryan Lewis', genre:'Hip-Hop', bpm:95, duration:'03:56', year:2013, deezerId:61424045 },
  { title:'La Gozadera',         artist:'Gente De Zona',    genre:'Latin',       bpm:95,    duration:'03:23', year:2015, deezerId:123345682 },
  { title:"Oops!...I Did It Again", artist:'Britney Spears', genre:'Pop',        bpm:95,    duration:'03:31', year:2000, deezerId:13142617 },
  { title:'The Next Episode',    artist:'Dr. Dre',          genre:'Hip-Hop',     bpm:95.4,  duration:'02:42', year:1999, deezerId:128743595 },
  { title:'Regulate',            artist:'Warren G',         genre:'Hip-Hop',     bpm:95.4,  duration:'04:11', year:1994, deezerId:2463406 },
  { title:'Loco Contigo',        artist:'DJ Snake',         genre:'Afro',        bpm:96,    duration:'03:05', year:2019, deezerId:716383902 },
  { title:'Ai Se Eu Te Pego',    artist:'Michel Teló',      genre:'Latin',       bpm:96,    duration:'02:46', year:2012, deezerId:2266742737 },
  { title:'Zouka',               artist:'Bang La Decks',    genre:'Electro',     bpm:97,    duration:'03:47', year:2015, deezerId:82398692 },
  { title:"You Can't Hurry Love",artist:'Phil Collins',     genre:'Années 80',   bpm:97.5,  duration:'02:54', year:2016, deezerId:134036220 },
  { title:'Para Que Llorar',     artist:'Santi Sanz',       genre:'Latin',       bpm:98,    duration:'03:11', year:null, deezerId:671285982 },
  { title:'Wild Thoughts',       artist:'DJ Khaled',        genre:'Hip-Hop',     bpm:98,    duration:'03:24', year:2017, deezerId:375689861 },
  { title:'Djadja',              artist:'Aya Nakamura',     genre:'Hip-Hop',     bpm:98,    duration:'02:51', year:2018, deezerId:576851222 },
  { title:'Pookie',              artist:'Aya Nakamura',     genre:'Hip-Hop',     bpm:98,    duration:'03:01', year:2018, deezerId:576851252 },
  { title:'Crazy In Love',       artist:'Beyoncé',          genre:'R&B',         bpm:99.3,  duration:'03:56', year:2003, deezerId:609244 },
  { title:'Doo Wop',             artist:'Ms. Lauryn Hill',  genre:'Hip-Hop',     bpm:99.9,  duration:'05:20', year:1998, deezerId:15586242 },
  { title:'Ma philosophie',      artist:'Amel Bent',        genre:'Hip-Hop',     bpm:100,   duration:'03:23', year:2004, deezerId:565420 },

  // ── Photo 9 — 100–107 BPM (nouveaux seulement) ───────────────────
  { title:'La Haine',            artist:'Cut Killer',       genre:'Hip-Hop',     bpm:100,   duration:'02:20', year:1996, deezerId:870821062 },
  { title:'Be Faithful',         artist:'Fatman Scoop',     genre:'Electro',     bpm:101,   duration:'02:42', year:2003, deezerId:9849814 },
  { title:'Jump',                artist:'Kris Kross',       genre:'Hip-Hop',     bpm:102,   duration:'03:15', year:1992, deezerId:1056838 },
  { title:'No Lie',              artist:'Sean Paul',        genre:'Reggaeton',   bpm:102,   duration:'03:41', year:2016, deezerId:136341512 },
  { title:'Who Mad Again',       artist:'Jahyanai',         genre:'Afro',        bpm:102,   duration:'03:22', year:2018, deezerId:428558022 },
  { title:'Bella',               artist:'GIMS',             genre:'Hip-Hop',     bpm:103,   duration:'03:47', year:2013, deezerId:72717420 },
  { title:"Somebody Else's Guy", artist:'Jocelyn Brown',    genre:'Disco',       bpm:103.1, duration:'03:45', year:1984, deezerId:1138085562 },
  { title:'La groupie du pianiste', artist:'Michel Berger', genre:'COCOVARIET',  bpm:103.3, duration:'04:43', year:2020, deezerId:46280411 },
  { title:"Let's Get It Started",artist:'Black Eyed Peas',  genre:'Electro',     bpm:105,   duration:'03:38', year:2004, deezerId:2435238 },
  { title:'Il jouait du piano debout', artist:'France Gall',genre:'COCOVARIET',  bpm:106.3, duration:'04:34', year:1980, deezerId:46300831 },
  { title:'Jump Around',         artist:'House of Pain',    genre:'Hip-Hop',     bpm:106.9, duration:'03:35', year:1992, deezerId:1584589772 },
  { title:'24K Magic',           artist:'Bruno Mars',       genre:'Disco',       bpm:107,   duration:'03:46', year:2016, deezerId:136336110 },

  // ── Photo 10 — 107–113 BPM (nouveaux seulement) ──────────────────
  { title:'Going Back to My Roots', artist:'Odyssey',       genre:'Disco',       bpm:107.2, duration:'05:26', year:1999, deezerId:559415 },
  { title:"(I've Had) The Time Of My Life", artist:'Bill Medley', genre:'Années 80', bpm:108.5, duration:'04:50', year:1987, deezerId:13128250 },
  { title:"Last Night a D.J. Saved My Life", artist:'Indeep',genre:'Disco',       bpm:109.9, duration:'05:41', year:1982, deezerId:62960815 },
  { title:'Nice Flow',           artist:'Smookie Illson',   genre:'House',       bpm:110,   duration:'03:34', year:2015, deezerId:99506140 },
  { title:'disco tits',          artist:'Tove Lo',          genre:'Pop',         bpm:110,   duration:'03:44', year:2017, deezerId:427253282 },
  { title:'Cette année-là',      artist:'Claude François',  genre:'COCOVARIET',  bpm:110.3, duration:'03:13', year:1976, deezerId:743689 },
  { title:'Changes',             artist:'2Pac',             genre:'Hip-Hop',     bpm:111.1, duration:'04:29', year:1998, deezerId:910693 },
  { title:'Lovefool',            artist:'The Cardigans',    genre:'Années 90',   bpm:111.6, duration:'03:17', year:1996, deezerId:1088389 },
  { title:'Not Butter',          artist:'Dillon Francis',   genre:'Electro',     bpm:112,   duration:'04:02', year:2014, deezerId:88253063 },
];

let updated = 0, notFound = 0;

for (const t of tracks) {
  try {
    const hash = fallbackHash(t.title, t.artist);
    const energy = estimateEnergy(t.bpm);
    const moment = estimateMoment(t.bpm);
    const tags   = t.bpm < 95 ? ['dancefloor', 'warm-up'] : ['dancefloor'];

    const payload = {
      $set: {
        bpm:            Math.round(t.bpm * 10) / 10,
        genre:          t.genre,
        duration:       parseDuration(t.duration),
        adminQualified: true, energy, tags, partyMoment: moment,
        'providers.deezer.trackId': t.deezerId,
        ...(t.year ? { releaseYear: t.year } : {}),
      }
    };

    let result = await TrackModel.findOneAndUpdate(
      { 'providers.deezer.trackId': t.deezerId }, payload, { upsert: false }
    );
    if (!result) result = await TrackModel.findOneAndUpdate(
      { fallbackHash: hash }, payload, { upsert: false }
    );

    if (result) { console.log(`✅ [${t.bpm} BPM | ⚡${energy}] ${t.title} — ${t.artist}`); updated++; }
    else { console.log(`⚠️  NOT FOUND: ${t.title} — ${t.artist} (dz${t.deezerId})`); notFound++; }
  } catch(err) { console.error(`❌ ${t.title}: ${err.message}`); }
}

console.log(`\n── Batch 4 ────────────────────────────────`);
console.log(`✅ Mis à jour : ${updated}  ⚠️  Non trouvés : ${notFound}`);
console.log(`──────────────────────────────────────────`);
await mongoose.disconnect();
process.exit(0);
