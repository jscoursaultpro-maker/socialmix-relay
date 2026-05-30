/**
 * qualify-batch-13.mjs — 9 nouveaux titres 125–134 BPM
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

const tracks = [
  { t:'Tried So Hard',    a:'Youngr',              g:'Electro',  b:125,   d:'04:37', y:null, id:2652885342 },
  { t:'Inferno',          a:'Carl Cox',            g:'Electro',  b:126,   d:'06:56', y:2018, id:507548912 },
  { t:'No Sleep',         a:'Meduza',              g:'House',    b:128,   d:'02:42', y:2002, id:3603058412 },
  { t:'Caramelle',        a:'Mesto',               g:'House',    b:128,   d:'02:00', y:2025, id:3628883602 },
  { t:'Your World',       a:'Benedetto',           g:'House',    b:129,   d:'05:32', y:2010, id:5747924 },
  { t:'We Are Perfect',   a:'Cristian Marchi',     g:'Electro',  b:129,   d:'05:06', y:2007, id:517144922 },
  { t:'Anxiety',          a:'Doechii',             g:'Hip-Hop',  b:129,   d:'04:09', y:2025, id:3262675101 },
  { t:'Desolate Lands',   a:'Adam Beyer',          g:'Electro',  b:129,   d:'04:19', y:2025, id:3422267721 },
  { t:'Cambodia',         a:'Agoria',              g:'Electro',  b:126,   d:'03:55', y:null, id:3811654872 },
];

let updated=0, notFound=0;
for (const t of tracks) {
  try {
    const hash=fh(t.t,t.a), energy=9;
    const payload={ $set:{
      bpm:t.b, genre:t.g, duration:pd(t.d),
      adminQualified:true, energy, tags:['dancefloor','peak-time'],
      partyMoment:'peak', 'providers.deezer.trackId':t.id,
      ...(t.y?{releaseYear:t.y}:{}),
    }};
    let r = await T.findOneAndUpdate({'providers.deezer.trackId':t.id}, payload, {upsert:false});
    if(!r) r = await T.findOneAndUpdate({fallbackHash:hash}, payload, {upsert:false});
    if(r){console.log(`✅ [${t.b} | ⚡9] ${t.t} — ${t.a}`); updated++;}
    else{console.log(`⚠️  NOT FOUND: ${t.t} — ${t.a} (dz${t.id})`); notFound++;}
  } catch(e){console.error(`❌ ${t.t}: ${e.message}`);}
}
console.log(`\n── Batch 13 ──  ✅ ${updated}  ⚠️  ${notFound}`);
await mongoose.disconnect(); process.exit(0);
