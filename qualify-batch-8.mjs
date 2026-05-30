/**
 * qualify-batch-8.mjs — 5 nouveaux titres très lents (67–94 BPM)
 * warm-up intro de soirée
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
  { t:'Never Ever',   a:'All Saints',              g:'Années 90', b:67.1, d:'06:28', y:null, id:706847,    en:3 },
  { t:'Shout!',       a:'The Isley Brothers',      g:'R&B',       b:69.5, d:'04:24', y:null, id:473274412, en:3 },
  { t:'Boombastic',   a:'Shaggy',                  g:'Reggaeton', b:79.2, d:'04:07', y:null, id:2122526,   en:4 },
  { t:'Good Thing',   a:'Fine Young Cannibals',    g:'Années 80', b:82.3, d:'03:22', y:null, id:428850822, en:4 },
  { t:'Shy Guy',      a:'Diana King',              g:'Reggaeton', b:94.1, d:'04:19', y:null, id:13165731,  en:5 },
];

let updated=0, notFound=0;
for (const t of tracks) {
  try {
    const hash=fh(t.t,t.a);
    const payload={ $set:{
      bpm:t.b, genre:t.g, duration:pd(t.d),
      adminQualified:true, energy:t.en, tags:['dancefloor','warm-up'],
      partyMoment:'warm-up', 'providers.deezer.trackId':t.id,
    }};
    let r = await T.findOneAndUpdate({'providers.deezer.trackId':t.id}, payload, {upsert:false});
    if(!r) r = await T.findOneAndUpdate({fallbackHash:hash}, payload, {upsert:false});
    if(r){console.log(`✅ [${t.b} | ⚡${t.en}] ${t.t} — ${t.a}`); updated++;}
    else{console.log(`⚠️  NOT FOUND: ${t.t} — ${t.a} (dz${t.id})`); notFound++;}
  } catch(e){console.error(`❌ ${t.t}: ${e.message}`);}
}
console.log(`\n── Batch 8 ──  ✅ ${updated}  ⚠️  ${notFound}`);
await mongoose.disconnect(); process.exit(0);
