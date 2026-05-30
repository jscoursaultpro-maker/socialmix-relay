/**
 * qualify-batch-7.mjs — Photo finale — 128–146 BPM
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
function en(b) { if(b>=134)return 9; if(b>=128)return 9; return 9; }

const tracks = [
  // ── 128 BPM (nouveaux non encore traités) ────────────────────────
  { t:'I Want You',             a:'Martin Solveig',     g:'House',    b:128,   d:'04:25', y:null, id:3808856552 },
  { t:'Together',               a:'David Guetta',       g:'House',    b:128,   d:'02:33', y:null, id:3434402411 },
  // ── 129 BPM ──────────────────────────────────────────────────────
  { t:"Let's Go",               a:'Jaden Bojsen',       g:'Electro',  b:129,   d:'02:40', y:2019, id:3016411391 },
  { t:'Anxiety',                a:'Doechii',            g:'Hip-Hop',  b:129,   d:'04:09', y:2025, id:3262675101 },
  // ── 130 BPM ──────────────────────────────────────────────────────
  { t:'She Wolf',               a:'David Guetta',       g:'House',    b:130,   d:'03:43', y:2012, id:62847144 },
  { t:'Party Rock Anthem',      a:'LMFAO',              g:'Electro',  b:130,   d:'04:22', y:null, id:12565420 },
  { t:'Sweat',                  a:'Snoop Dogg',         g:'Hip-Hop',  b:130,   d:'05:43', y:null, id:10296241 },
  { t:'Bring the Noise',        a:'Public Enemy',       g:'Hip-Hop',  b:130,   d:'03:43', y:1987, id:69170898 },
  { t:"You Don't Know Me",      a:'Armand van Helden',  g:'House',    b:130,   d:'04:02', y:1998, id:603415762 },
  { t:'No Stress',              a:'Laurent Wolf',       g:'House',    b:130,   d:'03:21', y:2008, id:650147122 },
  { t:'Sexy And I Know It',     a:'LMFAO',              g:'Electro',  b:130,   d:'03:19', y:2011, id:12565421 },
  { t:'San Francisco',          a:'Ph Electro',         g:'Electro',  b:130,   d:'03:17', y:null, id:87982541 },
  { t:'Scream & Shout',         a:'will.i.am',          g:'Electro',  b:130,   d:'04:12', y:2013, id:783011442 },
  // ── 131–134 BPM ──────────────────────────────────────────────────
  { t:'Be Your Friend',         a:'Cheat Codes',        g:'House',    b:131,   d:'02:40', y:null, id:3378403321 },
  { t:'Toop Toop',              a:'Cassius',            g:'Electro',  b:132,   d:'02:47', y:null, id:120536314 },
  { t:'Without You',            a:'Avicii',             g:'House',    b:134,   d:'03:02', y:null, id:393460732 },
  // ── 142–146 BPM (closing anthems) ────────────────────────────────
  { t:'Free Bird',              a:'MOONLGHT',           g:'Electro',  b:142,   d:'01:54', y:2025, id:2916188841 },
  { t:"Can't Hold Us",          a:'Macklemore',         g:'Hip-Hop',  b:146,   d:'04:18', y:2012, id:61424044 },
];

let updated=0, notFound=0;
for (const t of tracks) {
  try {
    const hash=fh(t.t,t.a);
    const payload={ $set:{
      bpm:t.b, genre:t.g, duration:pd(t.d),
      adminQualified:true, energy:9, tags:['dancefloor','peak-time'],
      partyMoment:'peak', 'providers.deezer.trackId':t.id,
      ...(t.y?{releaseYear:t.y}:{}),
    }};
    let r = await T.findOneAndUpdate({'providers.deezer.trackId':t.id}, payload, {upsert:false});
    if(!r) r = await T.findOneAndUpdate({fallbackHash:hash}, payload, {upsert:false});
    if(r){console.log(`✅ [${t.b} | ⚡9] ${t.t} — ${t.a}`); updated++;}
    else{console.log(`⚠️  NOT FOUND: ${t.t} — ${t.a} (dz${t.id})`); notFound++;}
  } catch(e){console.error(`❌ ${t.t}: ${e.message}`);}
}
console.log(`\n── Batch 7 ──  ✅ ${updated}  ⚠️  ${notFound}`);
await mongoose.disconnect(); process.exit(0);
