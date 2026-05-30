/**
 * qualify-batch-10.mjs — Photos finales — 28 nouveaux titres
 */
import mongoose from 'mongoose';
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI non défini'); process.exit(1); }
await mongoose.connect(MONGO_URI);
const T = (await import('./models/Track.js')).default;
console.log('✅ MongoDB connecté\n');

function ns(s) {
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi,'').replace(/\([^)]*\)/g,'')
    .replace(/\[[^\]]*\]/g,'').replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
}
function fh(t,a){ return `${ns(t)}_${ns(a)}`; }
function pd(s){ if(!s)return 0; const[m,sec]=s.split(':').map(Number); return(m*60)+(sec||0); }
function en(b){ if(b>=129)return 9; if(b>=124)return 9; if(b>=120)return 8; return 8; }
function mo(b){ return b>=120?'peak':'all'; }

const tracks = [
  // ── Photo 21 — nouveaux ──────────────────────────────────────────
  { t:'Les Oies Sauvages',           a:'Yann Muller',             g:'House',       b:121,   d:'02:25', y:null, id:2901697491 },
  { t:"Let's All Chant",             a:'Michael Zager Band',      g:'Disco',       b:121.9, d:'03:04', y:null, id:129771348 },

  // ── Photo 22 — nouveaux ──────────────────────────────────────────
  { t:"Don't Leave Me This Way",     a:'Thelma Houston',          g:'Disco',       b:124.9, d:'05:35', y:1976, id:76282634 },
  { t:'Paroles',                     a:'Yann Muller',             g:'Pop',         b:125,   d:'04:15', y:null, id:928969372 },
  { t:'Mr. Saxobeat',                a:'Alexandra Stan',          g:'Electro',     b:127,   d:'03:15', y:null, id:1077700822 },
  { t:'Saturday Hustle',             a:'DiscoGalactiX',           g:'Disco',       b:127.1, d:'05:50', y:null, id:1629769072 },
  { t:"It's Not Right But It's Okay",a:'Mr. Belt & Wezol',        g:'House',       b:128,   d:'02:32', y:2025, id:2589549242 },
  { t:'Bailar',                      a:'Deorro',                  g:'Electro',     b:128,   d:'02:40', y:2016, id:123373232 },
  { t:'Si Antes Te Hubiera Conocido',a:'KAROL G',                 g:'Latin',       b:128,   d:'03:16', y:2024, id:2846442802 },
  { t:'Outro Lugar',                 a:'Salomé de Bahia',         g:'Latin',       b:128,   d:'03:02', y:null, id:2716896732 },
  { t:"Don't Stop The Party",        a:'Black Eyed Peas',         g:'Electro',     b:128,   d:'06:07', y:2007, id:7706008 },

  // ── Photo 23 — 128–136 BPM (tous nouveaux) ───────────────────────
  { t:'Balada',                      a:'Gusttavo Lima',           g:'Latin',       b:128,   d:'03:22', y:2013, id:767383202 },
  { t:'Je ne suis pas un héros',     a:'Daniel Balavoine',        g:'COCOVARIET',  b:128.8, d:'05:15', y:1980, id:886322 },
  { t:'Dis-moi',                     a:'BB Brunes',               g:'Pop',         b:129.6, d:'02:25', y:2007, id:714554 },
  { t:'La goffa Lolita',             a:'Vincè la petite culotte', g:'Pop',         b:130,   d:'03:41', y:null, id:1619126272 },
  { t:'I Kissed A Girl',             a:'Katy Perry',              g:'Pop',         b:130,   d:'03:00', y:2008, id:3169161 },
  { t:"Ça m'énerve",                 a:'Helmut Fritz',            g:'House',       b:130,   d:'03:38', y:2009, id:2862281 },
  { t:'Danza Kuduro',                a:'Don Omar',                g:'Reggaeton',   b:130,   d:'03:19', y:2010, id:14948701 },
  { t:'Ateo',                        a:'C. Tangana',              g:'Latin',       b:130,   d:'04:00', y:2022, id:1507773472 },
  { t:'When Love Takes Over',        a:'David Guetta',            g:'House',       b:130,   d:'03:11', y:2009, id:3445820 },
  { t:'Danza Kuduro',                a:'Lucenzo',                 g:'Reggaeton',   b:130,   d:'03:36', y:2012, id:1161020382 },
  { t:'Fuck You',                    a:'Lily Allen',              g:'Pop',         b:130,   d:'03:41', y:2009, id:3148168 },
  { t:'Place des grands hommes',     a:'Patrick Bruel',           g:'COCOVARIET',  b:130.7, d:'04:29', y:1989, id:600886 },
  { t:'Bum Bum Tam Tam',             a:'MC Fioti',                g:'Latin',       b:132,   d:'03:34', y:2017, id:438850292 },
  { t:'Obsesion',                    a:'Aventura',                g:'Latin',       b:133.6, d:'04:15', y:2002, id:64848628 },
  { t:"Beggin'",                     a:'Måneskin',                g:'Pop',         b:134,   d:'03:32', y:2017, id:437046332 },
  { t:'Monday, Tuesday... Laissez-moi danser', a:'Dalida',        g:'COCOVARIET',  b:134,   d:'02:40', y:1979, id:1149273 },
  { t:'Cobrastyle',                  a:'Teddybears STHLM',        g:'Electro',     b:134.4, d:'03:00', y:2004, id:7860278 },
  { t:'LA FAMA',                     a:'ROSALÍA',                 g:'Latin',       b:136,   d:'03:08', y:2022, id:1685337397 },
];

let updated=0, notFound=0;
for (const t of tracks) {
  try {
    const hash=fh(t.t,t.a), energy=en(t.b), moment=mo(t.b);
    const tags = t.b >= 125 ? ['dancefloor','peak-time'] : ['dancefloor'];
    const payload={ $set:{
      bpm:t.b, genre:t.g, duration:pd(t.d),
      adminQualified:true, energy, tags, partyMoment:moment,
      'providers.deezer.trackId':t.id, ...(t.y?{releaseYear:t.y}:{}),
    }};
    let r = await T.findOneAndUpdate({'providers.deezer.trackId':t.id}, payload, {upsert:false});
    if(!r) r = await T.findOneAndUpdate({fallbackHash:hash}, payload, {upsert:false});
    if(r){console.log(`✅ [${t.b} | ⚡${energy}] ${t.t} — ${t.a}`); updated++;}
    else{console.log(`⚠️  NOT FOUND: ${t.t} — ${t.a} (dz${t.id})`); notFound++;}
  } catch(e){console.error(`❌ ${t.t}: ${e.message}`);}
}
console.log(`\n── Batch 10 ──  ✅ ${updated}  ⚠️  ${notFound}`);
await mongoose.disconnect(); process.exit(0);
