/**
 * qualify-batch-9.mjs — 3 derniers nouveaux titres manqués
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

const tracks = [
  { t:'Paradise City',    a:"Guns N' Roses",  g:'Rock',       b:100.1, d:'06:46', y:null, id:518458142, en:6, mo:'all' },
  { t:'Rock DJ',          a:'Robbie Williams', g:'Pop',        b:103,   d:'04:02', y:null, id:3148646711,en:6, mo:'all' },
  { t:'Bette Davis Eyes', a:'Kim Carnes',      g:'Années 80',  b:116.8, d:'03:46', y:null, id:3153065,   en:7, mo:'all' },
];

let updated=0, notFound=0;
for (const t of tracks) {
  try {
    const hash=fh(t.t,t.a);
    const payload={ $set:{
      bpm:t.b, genre:t.g, duration:pd(t.d),
      adminQualified:true, energy:t.en, tags:['dancefloor'],
      partyMoment:t.mo, 'providers.deezer.trackId':t.id,
    }};
    let r = await T.findOneAndUpdate({'providers.deezer.trackId':t.id}, payload, {upsert:false});
    if(!r) r = await T.findOneAndUpdate({fallbackHash:hash}, payload, {upsert:false});
    if(r){console.log(`✅ [${t.b} | ⚡${t.en}] ${t.t} — ${t.a}`); updated++;}
    else{console.log(`⚠️  NOT FOUND: ${t.t} — ${t.a} (dz${t.id})`); notFound++;}
  } catch(e){console.error(`❌ ${t.t}: ${e.message}`);}
}
console.log(`\n── Batch 9 ──  ✅ ${updated}  ⚠️  ${notFound}`);
await mongoose.disconnect(); process.exit(0);
