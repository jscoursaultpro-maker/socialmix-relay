/**
 * qualify-batch-12.mjs — 15 titres + retry NOT FOUND batch 11
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
  // ── Retry NOT FOUND depuis batch 11 (photo 26) ────────────────────
  { t:'Lovely',                    a:'Ikerfoxx',        g:'House',    b:122,   d:'04:39', y:null, id:2858067662 },
  { t:'Intro',                     a:'TR3NACRIA',       g:'House',    b:122,   d:'02:54', y:null, id:2695572412 },
  { t:'Havanero',                  a:'DJ Jarell',       g:'House',    b:122,   d:'05:29', y:2024, id:3701274662 },
  { t:'My Love for You',           a:'Marten Lou',      g:'House',    b:122,   d:'03:26', y:2002, id:2477781041 },
  { t:'Miracle',                   a:'Adriatique',      g:'House',    b:123,   d:'08:24', y:null, id:2492716331 },

  // ── Nouveaux de la photo 27 (123–124 BPM) ─────────────────────────
  { t:'Like A Dream',              a:'Adriatique',      g:'House',    b:123,   d:'04:13', y:2024, id:2951106011 },
  { t:'La Verdolaga',              a:'HUGEL',           g:'House',    b:124,   d:'02:30', y:2024, id:3156247951 },
  { t:"Past Lives",                a:'sapientdream',    g:'Electro',  b:124,   d:'03:12', y:null, id:2608551762 },
  { t:"Day 'N' Nite",              a:'Jamy Nox',        g:'Electro',  b:124,   d:'05:29', y:null, id:3612756622 },
  { t:'Feeling Good',              a:'Javi Colors',     g:'House',    b:124,   d:'06:31', y:1999, id:994464192 },
  { t:'Baddy On The Floor',        a:'Jamie xx',        g:'House',    b:124,   d:'03:42', y:2024, id:2720190122 },
  { t:'7 Seconds',                 a:'Joezi',           g:'House',    b:124,   d:'05:15', y:2023, id:2628154112 },
  { t:'Yu Feel',                   a:'Verb',            g:'House',    b:124,   d:'02:38', y:1999, id:3329690381 },
  { t:'Sing It Back',              a:'Dj Hermes',       g:'House',    b:124,   d:'09:02', y:2022, id:1738774067 },
  { t:"Wish I Didn't Miss You",    a:'Angie Stone',     g:'Disco',    b:124.1, d:'04:31', y:2001, id:966648 },
];

let updated=0, notFound=0;
for (const t of tracks) {
  try {
    const hash=fh(t.t,t.a);
    const energy = t.b >= 125 ? 9 : 8;
    const payload={ $set:{
      bpm:t.b, genre:t.g, duration:pd(t.d),
      adminQualified:true, energy, tags:['dancefloor'],
      partyMoment:'peak', 'providers.deezer.trackId':t.id,
      ...(t.y?{releaseYear:t.y}:{}),
    }};
    let r = await T.findOneAndUpdate({'providers.deezer.trackId':t.id}, payload, {upsert:false});
    if(!r) r = await T.findOneAndUpdate({fallbackHash:hash}, payload, {upsert:false});
    if(r){console.log(`✅ [${t.b} | ⚡${energy}] ${t.t} — ${t.a}`); updated++;}
    else{console.log(`⚠️  NOT FOUND: ${t.t} — ${t.a} (dz${t.id})`); notFound++;}
  } catch(e){console.error(`❌ ${t.t}: ${e.message}`);}
}
console.log(`\n── Batch 12 ──  ✅ ${updated}  ⚠️  ${notFound}`);
await mongoose.disconnect(); process.exit(0);
