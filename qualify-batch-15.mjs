/**
 * qualify-batch-15.mjs — Photos 34-35 — 121-174 BPM (peak + closing + extrêmes)
 */
import mongoose from 'mongoose';
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI'); process.exit(1); }
await mongoose.connect(MONGO_URI);
const T = (await import('./models/Track.js')).default;
function ns(s){return(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(feat\.?|ft\.?|featuring)\b/gi,'').replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'').replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();}
function fh(t,a){return`${ns(t)}_${ns(a)}`;}
function pd(s){if(!s)return 0;const[m,sec]=s.split(':').map(Number);return(m*60)+(sec||0);}

const tracks=[
  // ── Photo 34 — 121–124 BPM ────────────────────────────────────────
  {t:'K-POP',                a:'The Weeknd',         g:'Hip-Hop',   b:121,  d:'03:05',y:2023,id:2375967015},
  {t:'Riptide',              a:'Sigala',              g:'House',     b:122,  d:'02:18',y:null,id:3441858141},
  {t:'Giant',                a:'Calvin Harris',       g:'House',     b:122,  d:'03:49',y:2019,id:614756502},
  {t:'How Deep Is Your Love',a:'Calvin Harris',       g:'House',     b:122,  d:'03:33',y:2015,id:103996098},
  {t:'TRUSTFALL',            a:'P!nk',                g:'Pop',       b:122,  d:'03:57',y:2023,id:2120598297},
  {t:'A Un Paso De La Luna', a:'Reik',                g:'Latin',     b:122,  d:'03:14',y:2009,id:1283987962},
  {t:'Roses',                a:'SAINt JHN',           g:'House',     b:122,  d:'02:57',y:2020,id:770293952},
  {t:'Jamaican',             a:'HUGEL',               g:'House',     b:122,  d:'02:36',y:2025,id:3889748961},
  {t:'The Magic Key',        a:'Trinix',              g:'Electro',   b:122,  d:'02:51',y:2023,id:2179672997},
  {t:'Friday',               a:'Nightcrawlers',       g:'House',     b:123,  d:'02:49',y:2021,id:1178599842},
  {t:'Monaco',               a:'Guy2bezbar',          g:'Dance-pop', b:123,  d:'02:21',y:2024,id:2872998762},
  {t:'Promises',             a:'Calvin Harris',       g:'House',     b:123,  d:'03:33',y:2018,id:542335432},
  {t:'Seven Nation Army',    a:'The White Stripes',   g:'Rock',      b:123.2,d:'03:52',y:2003,id:1092293262},
  {t:'Esta Vida',            a:'Marshmello',          g:'House',     b:124,  d:'03:29',y:2018,id:2216851977},
  {t:'Turn Me On',           a:'Riton',               g:'House',     b:124,  d:'03:28',y:2019,id:741480472},
  {t:'Makeba',               a:'Jain',                g:'Dance-pop', b:124,  d:'02:05',y:2023,id:2370741815},
  {t:'Work With My Love',    a:'Alok',                g:'House',     b:124,  d:'02:30',y:2017,id:2083091847},
  // ── Photo 35 — 127–132 BPM ────────────────────────────────────────
  {t:'Sunny',                a:'Boney M.',            g:'Disco',     b:127,  d:'02:22',y:1976,id:3409416781},
  {t:'In My Bones',          a:'Lost Frequencies',    g:'House',     b:128,  d:'02:36',y:2015,id:2712022541},
  {t:'Looking For Love',     a:'Alok',                g:'Dance-pop', b:128,  d:'02:53',y:2022,id:3067533781},
  {t:'The Final Countdown 2025',a:'David Guetta',     g:'House',     b:128,  d:'03:02',y:2025,id:3348770961},
  {t:'Summer',               a:'Calvin Harris',       g:'House',     b:128,  d:'03:43',y:2014,id:88936747},
  {t:'Un beso de improviso', a:'Ana Mena',            g:'Pop',       b:128,  d:'02:51',y:2021,id:1408344462},
  {t:'El Incomprendido',     a:'Farruko',             g:'Reggaeton', b:128,  d:'04:28',y:2021,id:1506996362},
  {t:'Give Me Everything',   a:'Pitbull',             g:'House',     b:129,  d:'04:16',y:2011,id:10308117},
  {t:'DESPECHÁ',             a:'ROSALÍA',             g:'Latin',     b:130,  d:'02:37',y:2025,id:1841999507},
  {t:'Lovers In A Past Life',a:'Calvin Harris',       g:'Dance-pop', b:130,  d:'02:41',y:2024,id:2660815532},
  {t:'LAS 12',               a:'Ana Mena',            g:'Pop',       b:130,  d:'02:45',y:2023,id:1787751117},
  {t:'QUE CE SOIT CLAIR',    a:'Paul Kalkbrenner',    g:'Electro',   b:130,  d:'02:56',y:2025,id:3502053411},
  {t:'Exotica',              a:'Gabry Ponte',         g:'Dance-pop', b:130,  d:'02:01',y:2021,id:3175052941},
  {t:'Freed From Desire',    a:'Gala',                g:'Electro',   b:131,  d:'03:31',y:2024,id:2855541182},
  {t:'Monotonía',            a:'Shakira',             g:'Latin',     b:132,  d:'02:39',y:2022,id:1960232517},
  {t:'Basique',              a:'Orelsan',             g:'Hip-Hop',   b:132,  d:'02:44',y:2017,id:414838122},
  {t:'Madrid City',          a:'Ana Mena',            g:'Pop',       b:132,  d:'02:53',y:2019,id:2454933765},
  // ── Photo 36 — 135–174 BPM (closing / extrêmes) ───────────────────
  {t:'Walking Away',         a:'Matway',              g:'Electro',   b:135,  d:'02:23',y:null,id:3194135561},
  {t:'I Wanna Dance with Somebody',a:'Hard Lights',   g:'Electro',   b:135,  d:'02:40',y:2006,id:1286520172},
  {t:'Trois nuits par semaine',a:'Indochine',         g:'COCOVARIET',b:137.8,d:'04:47',y:1985,id:1151063132},
  {t:'Le chant des cygnes',  a:'Indochine',           g:'COCOVARIET',b:138,  d:'03:37',y:2024,id:2840316722},
  {t:'Beat It',              a:'Michael Jackson',     g:'Pop',       b:138.8,d:'04:18',y:1983,id:4763165},
  {t:'Not Alone',            a:'Gabry Ponte',         g:'Electro',   b:140,  d:'02:45',y:2025,id:3026960801},
  {t:'Miracle',              a:'Calvin Harris',       g:'Electro',   b:143,  d:'03:06',y:2023,id:2182322087},
  {t:'Toxic',                a:'Britney Spears',      g:'Pop',       b:143,  d:'03:19',y:2004,id:15391618},
  {t:'WHERE SHE GOES',       a:'Bad Bunny',           g:'Hip-Hop',   b:144,  d:'03:52',y:2023,id:2289342455},
  {t:'Miss You',             a:'Southstar',           g:'Hip-Hop',   b:145,  d:'03:26',y:2002,id:1847938107},
  {t:'JUMP',                 a:'BLACKPINK',           g:'Pop',       b:145,  d:'02:45',y:2025,id:3454677991},
  {t:"Dans les yeux d'Émilie",a:'Joe Dassin',         g:'COCOVARIET',b:147.6,d:'03:44',y:2013,id:596537},
  {t:'Boyz In Paris',        a:'Marnik',              g:'House',     b:149,  d:'02:32',y:2023,id:2365023705},
  {t:'POWER',                a:'Marnik',              g:'House',     b:150,  d:'02:21',y:1993,id:2621151252},
  {t:'Cocorito',             a:'Marnik',              g:'House',     b:150,  d:'01:56',y:null,id:2802379712},
  {t:'Pedro',                a:'Jaxomy',              g:'Electro',   b:151,  d:'02:25',y:2024,id:2712128861},
  {t:'melodrama',            a:'disiz',               g:'Hip-Hop',   b:154,  d:'02:56',y:2025,id:3558373981},
  {t:'Adriano',              a:'Niska',               g:'Hip-Hop',   b:155,  d:'02:22',y:null,id:3442901201},
  {t:'Footloose',            a:'Kenny Loggins',       g:'Rock',      b:174.2,d:'03:41',y:1984,id:8146902},
];

let ins=0,upd=0,dup=0;
for(const t of tracks){
  try{
    const hash=fh(t.t,t.a);
    const e=t.b>=125?9:t.b>=120?8:t.b>=110?7:6;
    const pl={bpm:t.b,genre:t.g,duration:pd(t.d),adminQualified:true,energy:e,tags:['dancefloor','peak-time'],partyMoment:'peak','providers.deezer.trackId':t.id,...(t.y?{releaseYear:t.y}:{})};
    const ex=await T.findOne({$or:[{'providers.deezer.trackId':t.id},{fallbackHash:hash}]});
    if(ex){await T.updateOne({_id:ex._id},{$set:pl});console.log(`♻️  ${t.t}`);upd++;}
    else{await T.create({title:t.t,artist:t.a,...pl,fallbackHash:hash,suggestCount:0,feuCount:0,providers:{deezer:{trackId:t.id}}});console.log(`➕ [${t.b}|⚡${e}] ${t.t}`);ins++;}
  }catch(e2){if(e2.code===11000){dup++;console.log(`⚠️  DUPE: ${t.t}`);}else console.error(`❌ ${t.t}: ${e2.message}`);}
}
console.log(`\n── Batch 15 ── ➕${ins} ♻️ ${upd} ⚠️ ${dup}`);
await mongoose.disconnect();process.exit(0);
