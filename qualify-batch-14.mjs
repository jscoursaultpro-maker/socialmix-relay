/**
 * qualify-batch-14.mjs — Photos 31-33 — 69-120 BPM
 * ~49 nouveaux titres : hip-hop latin, urban, purple disco, bad bunny
 */
import mongoose from 'mongoose';
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI non défini'); process.exit(1); }
await mongoose.connect(MONGO_URI);
const T = (await import('./models/Track.js')).default;
console.log('✅ MongoDB connecté\n');
function ns(s){return(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\b(feat\.?|ft\.?|featuring)\b/gi,'').replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'').replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();}
function fh(t,a){return`${ns(t)}_${ns(a)}`;}
function pd(s){if(!s)return 0;const[m,sec]=s.split(':').map(Number);return(m*60)+(sec||0);}
function en(b){if(b>=125)return 9;if(b>=120)return 8;if(b>=110)return 7;if(b>=100)return 6;if(b>=90)return 5;if(b>=80)return 4;return 3;}
function mo(b){if(b>=120)return'peak';if(b>=100)return'all';return'warm-up';}
function tg(b){const t=['dancefloor'];if(b>=125)t.push('peak-time');if(b<100)t.push('warm-up');return t;}

const tracks=[
  // ── Photo 31 — 69–100 BPM ─────────────────────────────────────────
  {t:'Say My Name',          a:"Destiny's Child",   g:'Electro',    b:69,    d:'04:31',y:1999,id:580936},
  {t:"STAR WALKIN'",         a:'Lil Nas X',          g:'Dance-pop',  b:71,    d:'03:31',y:2022,id:1924639057},
  {t:'Meuda',                a:'Tiakola',            g:'Hip-Hop',    b:71,    d:'02:33',y:2022,id:1759430967},
  {t:'INDUSTRY BABY',        a:'Lil Nas X',          g:'Hip-Hop',    b:75,    d:'03:32',y:2021,id:1439691952},
  {t:'Jolie madame',         a:'Joé Dwet Filé',      g:'Dance-pop',  b:80,    d:'03:05',y:2021,id:1298524752},
  {t:'NANANI NANANA',        a:'Gazo',               g:'Hip-Hop',    b:87,    d:'03:38',y:2024,id:3102004051},
  {t:'MAMI WATA',            a:'Gazo',               g:'Hip-Hop',    b:88,    d:'03:53',y:2023,id:2561982012},
  {t:'Hawái',                a:'Maluma',             g:'Latin',      b:90,    d:'03:20',y:2022,id:1129572462},
  {t:'Copa Vacía',           a:'Shakira',            g:'Latin',      b:90,    d:'02:54',y:2023,id:2326105095},
  {t:'BAILE INolVIDABLE',    a:'Bad Bunny',          g:'Reggaeton',  b:90,    d:'06:08',y:2025,id:3171003001},
  {t:'KU LO SA',             a:'Oxlade',             g:'Dance-pop',  b:93,    d:'02:29',y:2022,id:2044337497},
  {t:'Bam Bam',              a:'Camila Cabello',     g:'Hip-Hop',    b:95,    d:'03:26',y:2022,id:1666673152},
  {t:'BESO',                 a:'ROSALÍA',            g:'Latin',      b:95,    d:'03:15',y:2023,id:2200304467},
  {t:'Le temps est bon',     a:'Bon Entendeur',      g:'Chill',      b:98,    d:'03:30',y:2019,id:532589062},
  {t:'Paint The Town Red',   a:'Doja Cat',           g:'Hip-Hop',    b:100,   d:'03:52',y:2023,id:2387373015},
  {t:'TOUT VA BIEN',         a:'Alonzo',             g:'Hip-Hop',    b:100,   d:'03:13',y:2017,id:1738308487},
  {t:'Soltera',              a:'Shakira',            g:'Latin',      b:100,   d:'03:35',y:2024,id:3002724121},
  {t:'Night Heights',        a:'Jain',               g:'Pop',        b:100,   d:'04:10',y:null,id:2151341427},
  // ── Photo 32 — 101–115 BPM ────────────────────────────────────────
  {t:'Love Me Now',          a:'Kygo',               g:'Pop',        b:102,   d:'03:16',y:2020,id:1455828442},
  {t:'RITMO',                a:'Black Eyed Peas',    g:'Hip-Hop',    b:105,   d:'03:42',y:2019,id:772603752},
  {t:'Iko Iko (My Bestie)',  a:'Justin Wellington',  g:'Reggae',     b:105,   d:'03:03',y:null,id:1324559462},
  {t:'Woke Up in Love',      a:'Kygo',               g:'Dance-pop',  b:106,   d:'03:37',y:2022,id:1896376597},
  {t:'DÁKITI!',              a:'Bad Bunny',          g:'Hip-Hop',    b:110,   d:'03:25',y:2020,id:1122450992},
  {t:'River',                a:'Tom Gregory',        g:'Pop',        b:110,   d:'03:10',y:2021,id:1264696562},
  {t:'Superstar',            a:'Jamelia',            g:'Funk',       b:110,   d:'03:35',y:2003,id:1855814847},
  {t:'COCO LOCO',            a:'Maluma',             g:'Reggaeton',  b:110,   d:'02:47',y:2024,id:2304999015},
  {t:'Say So',               a:'Doja Cat',           g:'Hip-Hop',    b:111,   d:'03:58',y:2019,id:797228462},
  {t:'Tití Me Preguntó',     a:'Bad Bunny',          g:'Reggaeton',  b:111,   d:'04:04',y:2022,id:1741494317},
  {t:'Loca',                 a:'Shakira',            g:'Latin',      b:112,   d:'03:04',y:2010,id:79589178},
  {t:"CAN'T STOP THE FEELING!",a:'Justin Timberlake',g:'House',      b:113,   d:'03:56',y:2016,id:124237488},
  {t:'DtMF',                 a:'Bad Bunny',          g:'Reggaeton',  b:113,   d:'03:57',y:2025,id:3171003131},
  {t:'Summer Days',          a:'Martin Garrix',      g:'House',      b:114,   d:'02:44',y:2019,id:669567072},
  {t:'What About Us',        a:'P!nk',               g:'Pop',        b:114,   d:'04:30',y:2008,id:415238442},
  {t:'BREAK MY SOUL',        a:'Beyoncé',            g:'R&B',        b:115,   d:'04:38',y:2022,id:1797297127},
  // ── Photo 33 — 115–120 BPM ────────────────────────────────────────
  {t:'Chacun son chacun',    a:'THEODORT',           g:'Pop',        b:115,   d:'02:34',y:2025,id:3014213321},
  {t:'Wati by Night',        a:"Sexion D'Assaut",    g:'Hip-Hop',    b:115,   d:'04:09',y:2010,id:5639255},
  {t:'CUFF IT',              a:'Beyoncé',            g:'House',      b:115,   d:'03:45',y:2022,id:1842063487},
  {t:'Les démons de minuit', a:'Julien Doré',        g:'Pop',        b:115,   d:'03:29',y:2024,id:3054938751},
  {t:'In The Dark',          a:'Purple Disco Machine',g:'House',     b:116,   d:'03:06',y:2022,id:1595157041},
  {t:'WHERE IS MY HUSBAND!', a:'Raye',               g:'Funk',       b:116,   d:'03:17',y:2025,id:3548216281},
  {t:'Pasaporte',            a:'Rauw Alejandro',     g:'Hip-Hop',    b:117,   d:'04:27',y:2024,id:3012877461},
  {t:'Basta Cazzate',        a:'Bon Entendeur',      g:'House',      b:118,   d:'02:42',y:null,id:2633491932},
  {t:'Dopamine',             a:'Purple Disco Machine',g:'House',     b:118,   d:'03:36',y:2018,id:1458986142},
  {t:'Flowers',              a:'Miley Cyrus',        g:'Pop',        b:118,   d:'03:20',y:2023,id:2105158337},
  {t:'NUEVAYoL',             a:'Bad Bunny',          g:'Reggaeton',  b:118,   d:'03:04',y:2025,id:3171002981},
  {t:'Fireworks',            a:'Purple Disco Machine',g:'Nu-Disco',  b:118,   d:'03:20',y:2021,id:1228452582},
  {t:'Secrets',              a:'Regard',             g:'Electro',    b:119,   d:'02:57',y:2019,id:923740862},
  {t:'Numb',                 a:'Marshmello',         g:'Dance-pop',  b:120,   d:'02:36',y:2022,id:1775253117},
  {t:'Honey Boy',            a:'Purple Disco Machine',g:'Nu-Disco',  b:120,   d:'03:47',y:2024,id:2751202791},
];

let inserted=0,updated=0,skipped=0;
for(const t of tracks){
  try{
    const hash=fh(t.t,t.a),energy=en(t.b),moment=mo(t.b),tgs=tg(t.b);
    const payload={bpm:t.b,genre:t.g,duration:pd(t.d),adminQualified:true,energy,tags:tgs,partyMoment:moment,'providers.deezer.trackId':t.id,...(t.y?{releaseYear:t.y}:{})};
    const exists=await T.findOne({$or:[{'providers.deezer.trackId':t.id},{fallbackHash:hash}]});
    if(exists){await T.updateOne({_id:exists._id},{$set:payload});console.log(`♻️  [${t.b}|⚡${energy}] ${t.t}`);updated++;}
    else{await T.create({title:t.t,artist:t.a,genre:t.g,bpm:t.b,duration:pd(t.d),energy,tags:tgs,partyMoment:moment,adminQualified:true,fallbackHash:hash,suggestCount:0,feuCount:0,providers:{deezer:{trackId:t.id}},...(t.y?{releaseYear:t.y}:{})});console.log(`➕ [${t.b}|⚡${energy}] ${t.t} — ${t.a}`);inserted++;}
  }catch(e){if(e.code===11000){skipped++;console.log(`⚠️  DUPE: ${t.t}`);}else console.error(`❌ ${t.t}: ${e.message}`);}
}
console.log(`\n── Batch 14 ── ➕${inserted} ♻️ ${updated} ⚠️ ${skipped}`);
await mongoose.disconnect();process.exit(0);
