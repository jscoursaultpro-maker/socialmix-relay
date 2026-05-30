/**
 * qualify-batch-11.mjs — Photos finales — ~36 nouveaux titres
 * Deep house 120 BPM + anthems extrêmes 136–174 BPM
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
function en(b){ if(b>=140)return 9; if(b>=125)return 9; if(b>=120)return 8; return 7; }
function mo(b){ return b>=120?'peak':'all'; }

const tracks = [
  // ── Photo 24 — Closing anthems 136–174 BPM ──────────────────────
  { t:"It's Raining Men",         a:'Geri Halliwell',          g:'Electro',     b:136.5, d:'04:15', y:2004, id:3472539 },
  { t:"J't'emmène au vent",       a:'Louise Attaque',          g:'COCOVARIET',  b:137.7, d:'03:01', y:2006, id:983238 },
  { t:'Viva La Vida',             a:'Coldplay',                g:'Pop',         b:138,   d:'04:02', y:2008, id:3157972 },
  { t:'Suavemente',               a:'Soolking',                g:'Hip-Hop',     b:140,   d:'02:39', y:2022, id:1662709912 },
  { t:"Ça c'est vraiment toi",   a:'Telephone',               g:'COCOVARIET',  b:140.1, d:'04:28', y:1982, id:3135725 },
  { t:'Marry You',                a:'Bruno Mars',              g:'Pop',         b:145,   d:'03:50', y:2010, id:8011854 },
  { t:'Cosmo',                    a:'Soprano',                 g:'Hip-Hop',     b:146,   d:'03:04', y:2014, id:576822202 },
  { t:'Holding Out for a Hero',   a:'Bonnie Tyler',            g:'Electro',     b:149,   d:'04:21', y:1984, id:911317852 },
  { t:"Dans les yeux d'Émilie",   a:'Romain Ughetto',          g:'COCOVARIET',  b:150,   d:'02:41', y:null, id:2847461482 },
  { t:'Happy',                    a:'Pharrell Williams',       g:'Pop',         b:160,   d:'03:53', y:2014, id:701326562 },
  { t:'New York avec toi',        a:'Telephone',               g:'COCOVARIET',  b:162,   d:'02:23', y:1984, id:3256016 },
  { t:"J'irai où tu iras",        a:'Céline Dion',             g:'COCOVARIET',  b:174.9, d:'03:27', y:1996, id:4762941 },

  // ── Photo 25 — Deep house / underground 114–120 BPM ─────────────
  { t:"Can't Get You Out Of My Head", a:'Desire',              g:'House',       b:114,   d:'06:28', y:1975, id:1613981692 },
  { t:"My City's On Fire",        a:'Jimi Jules',              g:'House',       b:119,   d:'04:59', y:2022, id:1977567857 },
  { t:'Numb',                     a:'Elderbrook',              g:'House',       b:120,   d:'03:50', y:2020, id:893594412 },
  { t:'W4U',                      a:'Mont Rouge',              g:'House',       b:120,   d:'04:00', y:null, id:3076432031 },
  { t:'Emowe',                    a:'Notre Dame',              g:'House',       b:120,   d:'07:40', y:null, id:2525458421 },
  { t:'Juno Love',                a:'Nico Morano',             g:'House',       b:120,   d:'07:27', y:null, id:2185516347 },
  { t:'Discoteca',                a:'&ME',                     g:'Disco',       b:120,   d:'06:25', y:1976, id:1269301652 },
  { t:'Paris',                    a:'&ME',                     g:'House',       b:120,   d:'07:23', y:1980, id:1668422912 },
  { t:'The Edge',                 a:'Robosonic',               g:'House',       b:120,   d:'07:05', y:2012, id:129139886 },
  { t:'Before',                   a:'Pablo Fierro',            g:'House',       b:120,   d:'07:00', y:2013, id:1512797952 },
  { t:'Wizard of Love',           a:'Blond:ish',               g:'House',       b:120,   d:'03:56', y:2014, id:3045968591 },
  { t:'soso',                     a:'Omah Lay',                g:'Afro',        b:120,   d:'04:52', y:2022, id:3001468701 },
  { t:'Les Gout',                 a:'Rampa',                   g:'House',       b:120,   d:'05:44', y:2022, id:1892122097 },
  { t:'Sala Papa Ye',             a:'Soulroots',               g:'House',       b:120,   d:'03:33', y:2022, id:1741718587 },
  { t:'Waves & Wavs',             a:'Ahmed Spins',             g:'House',       b:120,   d:'05:28', y:2022, id:2161608057 },
  { t:'The Rapture Pt.III',       a:'&ME',                     g:'House',       b:120,   d:'06:58', y:2023, id:2285438237 },
  { t:'Secret ID',                a:'Moojo',                   g:'House',       b:120,   d:'06:56', y:2023, id:2343066935 },
  { t:'Sunrise Generation',       a:'Damian Lazarus',          g:'House',       b:120,   d:'09:44', y:2024, id:3049238361 },

  // ── Photo 26 — 122–123 BPM (nouveaux) ────────────────────────────
  { t:'Lovely',                   a:'Ikerfoxx',                g:'House',       b:122,   d:'04:39', y:null, id:2858067662 },
  { t:'Intro',                    a:'TR3NACRIA',               g:'House',       b:122,   d:'02:54', y:null, id:2695572412 },
  { t:'My Love for You',          a:'Marten Lou',              g:'House',       b:122,   d:'03:26', y:2002, id:2477781041 },
  { t:'Dare Your Move',           a:'MAXI MERAKI',             g:'House',       b:122,   d:'02:49', y:2022, id:2008609407 },
  { t:'Havanero',                 a:'DJ Jarell',               g:'House',       b:122,   d:'05:29', y:2024, id:3701274662 },
  { t:'Miracle',                  a:'Adriatique',              g:'House',       b:123,   d:'08:24', y:null, id:2492716331 },
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
console.log(`\n── Batch 11 ──  ✅ ${updated}  ⚠️  ${notFound}`);
await mongoose.disconnect(); process.exit(0);
