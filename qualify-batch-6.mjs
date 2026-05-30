/**
 * qualify-batch-6.mjs — Nouveaux titres extraits des photos 16→20
 * Inclut : Dana Dana, Down The Road, Bulanga, Call on Me, Animals,
 *          et la série 128 BPM (Showtek, Guetta, BEP, etc.)
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
function fh(t,a) { return `${ns(t)}_${ns(a)}`; }
function pd(s) { if(!s)return 0; const[m,sec]=s.split(':').map(Number); return(m*60)+(sec||0); }
function en(b) { if(b>=129)return 9; if(b>=125)return 9; if(b>=120)return 8; return 7; }
function mo(b) { return b>=120?'peak':'all'; }

const tracks = [
  // ── Nouveaux de l'image 16 ───────────────────────────────────────
  { t:'Dana Dana',                 a:'Rima',                   g:'Hip-Hop',     b:103,   d:'04:06', y:null, id:2689621452 },
  { t:'Down The Road',             a:'C2C',                    g:'Electro',     b:111,   d:'03:27', y:null, id:54519711 },
  { t:'Bulanga',                   a:'Felipe Allenn',          g:'House',       b:120,   d:'02:47', y:null, id:3507123471 },

  // ── Nouveaux de l'image 18 ───────────────────────────────────────
  { t:'Call on Me',                a:'Eric Prydz',             g:'House',       b:126.3, d:'02:51', y:null, id:144203048 },

  // ── Nouveaux de l'image 19 ───────────────────────────────────────
  { t:'Animals',                   a:'Martin Garrix',          g:'House',       b:128,   d:'05:04', y:2013, id:2102633427 },

  // ── Image 20 — 128–129 BPM (nouveaux) ────────────────────────────
  { t:'Just a Little More Love',   a:'David Guetta',           g:'House',       b:128,   d:'03:24', y:2025, id:553056812 },
  { t:'Rock This Party',           a:'Bob Sinclar',            g:'House',       b:128,   d:'04:05', y:2006, id:2634178712 },
  { t:'I Think I Like It',         a:'Fake Blood',             g:'House',       b:128,   d:'03:04', y:null, id:576187922 },
  { t:'I Gotta Feeling',           a:'Black Eyed Peas',        g:'Electro',     b:128,   d:'04:49', y:2009, id:4619466 },
  { t:'Rattle',                    a:'Bingo Players',          g:'Electro',     b:128,   d:'04:47', y:2011, id:466013612 },
  { t:'Good Feeling',              a:'Flo Rida',               g:'Electro',     b:128,   d:'04:08', y:2011, id:65232772 },
  { t:'Love Is Gone',              a:'David Guetta',           g:'House',       b:128,   d:'03:19', y:2012, id:3107326 },
  { t:'Pursuit of Happiness',      a:'InstaHit Crew',          g:'House',       b:128,   d:'06:18', y:2012, id:68133053 },
  { t:'Booyah',                    a:'Showtek',                g:'Electro',     b:128,   d:'03:35', y:2013, id:1451459162 },
  { t:"I'm an Albatraoz",          a:'AronChupa',              g:'Electro',     b:128,   d:'02:47', y:2014, id:82564724 },
  { t:'Pursuit Of Happiness',      a:'Kid Cudi',               g:'House',       b:128,   d:'06:14', y:2016, id:18181530 },
  { t:'Rasputin',                  a:'Majestic',               g:'Disco',       b:128,   d:'03:06', y:2021, id:1242670642 },
  { t:'Magnolias for Ever',        a:'Claude François',        g:'COCOVARIET',  b:128,   d:'05:32', y:2022, id:1984836197 },
  { t:'Hello',                     a:'Martin Solveig',         g:'House',       b:128,   d:'04:41', y:null, id:3803035232 },
  { t:'One Day (Vandaag)',          a:'Bakermat',              g:'House',       b:128,   d:'03:39', y:2014, id:75819429 },
  { t:'Put Your Hands Up For Detroit', a:'Fedde Le Grand',     g:'House',       b:128,   d:'06:33', y:2006, id:1134280762 },
  { t:'Pump It Up',                a:'Endor',                  g:'Electro',     b:129,   d:'02:31', y:2025, id:3156101171 },
  { t:'Somebody That I Used To Know', a:'Gotye',               g:'Pop',         b:129,   d:'07:15', y:null, id:38194901 },
];

let updated=0, notFound=0;
for (const t of tracks) {
  try {
    const hash=fh(t.t,t.a), energy=en(t.b), moment=mo(t.b);
    const payload={ $set:{
      bpm:Math.round(t.b*10)/10, genre:t.g, duration:pd(t.d),
      adminQualified:true, energy, tags:['dancefloor'], partyMoment:moment,
      'providers.deezer.trackId':t.id, ...(t.y?{releaseYear:t.y}:{}),
    }};
    let r = await T.findOneAndUpdate({'providers.deezer.trackId':t.id}, payload, {upsert:false});
    if(!r) r = await T.findOneAndUpdate({fallbackHash:hash}, payload, {upsert:false});
    if(r){console.log(`✅ [${t.b} | ⚡${energy}] ${t.t} — ${t.a}`); updated++;}
    else{console.log(`⚠️  NOT FOUND: ${t.t} — ${t.a} (dz${t.id})`); notFound++;}
  } catch(e){console.error(`❌ ${t.t}: ${e.message}`);}
}
console.log(`\n── Batch 6 ──  ✅ ${updated}  ⚠️  ${notFound}`);
await mongoose.disconnect(); process.exit(0);
