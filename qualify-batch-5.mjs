/**
 * qualify-batch-5.mjs — Photos 11→16 — BPM 113–128
 * ~90 nouveaux titres
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
function en(b) { if(b>=127)return 9; if(b>=122)return 8; if(b>=116)return 7; return 7; }
function mo(b) { return b>=120?'peak':'all'; }

const tracks = [
  // ── Photo 11 — 113–120 BPM ────────────────────────────────────────
  { t:'Forget Me Nots',                   a:'Patrice Rushen',          g:'Disco',       b:113.8, d:'04:45', y:1996, id:434614222 },
  { t:'Got to Be Real',                   a:'Cheryl Lynn',             g:'Disco',       b:114.7, d:'03:49', y:1996, id:1027891 },
  { t:'Jamaican Boy',                     a:'Bost & Bim',              g:'Afro',        b:115,   d:'04:59', y:2011, id:2490327001 },
  { t:'And The Beat Goes On',             a:'The Whispers',            g:'Disco',       b:116,   d:'04:55', y:1979, id:3806133052 },
  { t:'We Are Family',                    a:'Sister Sledge',           g:'Disco',       b:116.4, d:'08:21', y:2017, id:691622 },
  { t:'Get Down Saturday Night',          a:'Oliver Cheatham',         g:'Disco',       b:116.5, d:'04:02', y:1995, id:2044588597 },
  { t:'Résiste',                          a:'France Gall',             g:'COCOVARIET',  b:116.8, d:'04:35', y:1981, id:46307001 },
  { t:'American Boy',                     a:'Estelle',                 g:'Pop',         b:118,   d:'04:45', y:2008, id:1855507607 },
  { t:'Arranca',                          a:'Becky G',                 g:'Reggaeton',   b:118,   d:'02:47', y:2023, id:2170492547 },
  { t:'Le Freak',                         a:'Chic',                    g:'Disco',       b:118.7, d:'05:28', y:1979, id:72060062 },
  { t:"Long Train Runnin'",               a:'The Doobie Brothers',     g:'Disco',       b:118.7, d:'03:28', y:1973, id:3822044 },
  { t:"Don't Stop 'Til You Get Enough",   a:'Michael Jackson',         g:'Disco',       b:119,   d:'03:56', y:1979, id:13129197 },
  { t:'Jump to It',                       a:'Aretha Franklin',         g:'Disco',       b:119.5, d:'06:41', y:null, id:486765302 },
  { t:'Bamboléo',                         a:'Gipsy Kings',             g:'Latin',       b:119.5, d:'03:23', y:1987, id:958647812 },
  { t:'On the Beat',                      a:'The B.B. & Q. Band',      g:'Disco',       b:119.6, d:'05:57', y:1988, id:62622575 },
  { t:'Stomp!',                           a:'The Brothers Johnson',    g:'Disco',       b:119.7, d:'06:20', y:1980, id:549309082 },
  { t:'Blurred Lines',                    a:'Robin Thicke',            g:'R&B',         b:120,   d:'04:23', y:2013, id:65444691 },
  { t:'Shake',                            a:'Foreal People',           g:'House',       b:120,   d:'05:11', y:1999, id:723821422 },
  { t:'The Sweet Escape',                 a:'Gwen Stefani',            g:'Pop',         b:120,   d:'04:06', y:2006, id:1575417 },

  // ── Photo 12 — 120–122 BPM (nouveaux) ────────────────────────────
  { t:'Call Me Maybe',                    a:'Carly Rae Jepsen',        g:'Pop',         b:120,   d:'03:14', y:2012, id:17826508 },
  { t:'Drive Back, Baby',                 a:'Platinum Doug',           g:'House',       b:120,   d:'02:22', y:2015, id:108678880 },
  { t:'Gypsy Woman',                      a:'Crystal Waters',          g:'House',       b:120.1, d:'03:38', y:1991, id:907649 },
  { t:'Pump It',                          a:'Black Eyed Peas',         g:'Hip-Hop',     b:120.3, d:'03:33', y:2005, id:7375556 },
  { t:'Girls Just Want to Have Fun',      a:'Cyndi Lauper',            g:'Pop',         b:120.4, d:'03:58', y:1983, id:72194071 },
  { t:'Celebration',                      a:'Kool & The Gang',         g:'Disco',       b:120.9, d:'04:58', y:1980, id:906568 },
  { t:'1990',                             a:'Jean Leloup',             g:'COCOVARIET',  b:121.8, d:'05:08', y:1990, id:128237717 },
  { t:'Je te donne',                      a:'Jean-Jacques Goldman',    g:'COCOVARIET',  b:122,   d:'04:25', y:1985, id:730166752 },
  { t:'No Man No Cry',                    a:'Oliver Koletzki',         g:'Disco',       b:122,   d:'07:00', y:2021, id:395143972 },
  { t:'Soul Makossa',                     a:'Yolanda Be Cool',         g:'House',       b:122,   d:'02:36', y:2015, id:108179944 },
  { t:'This Girl',                        a:'Kungs',                   g:'House',       b:122,   d:'04:03', y:2016, id:121593956 },
  { t:'This Girl',                        a:'Kungs',                   g:'House',       b:122,   d:'03:16', y:2016, id:135373112 },

  // ── Photo 13 — 122–124 BPM (nouveaux) ────────────────────────────
  { t:'Push It Up',                       a:"Cookin' On 3 Burners",    g:'Electro',     b:122,   d:'04:29', y:2017, id:145169112 },
  { t:'Never Going Home',                 a:'Kungs',                   g:'House',       b:122,   d:'02:50', y:2021, id:1372169352 },
  { t:'Relax, Take It Easy',              a:'MIKA',                    g:'Pop',         b:122,   d:'03:45', y:2006, id:2333803305 },
  { t:'Grace Kelly',                      a:'MIKA',                    g:'House',       b:122.3, d:'03:08', y:2006, id:953602 },
  { t:"Don't Stop The Music",             a:'Rihanna',                 g:'Hip-Hop',     b:122.7, d:'04:27', y:2007, id:925108 },
  { t:'You Should Be Dancing',            a:'Bee Gees',                g:'Disco',       b:122.8, d:'04:17', y:1976, id:350027741 },
  { t:'One More Time',                    a:'Daft Punk',               g:'House',       b:122.9, d:'05:20', y:2000, id:3135553 },
  { t:'Prayer in C',                      a:'Lilly Wood And The Prick', g:'House',      b:123,   d:'03:09', y:2014, id:79223833 },
  { t:'Marea',                            a:'Fred again..',            g:'House',       b:123,   d:'04:45', y:2021, id:1239694902 },
  { t:'Intro',                            a:'Alan Braxe',              g:'House',       b:123.9, d:'04:55', y:2000, id:1702170497 },
  { t:'Sun Is Shining',                   a:'Bob Marley & The Wailers',g:'Afro',        b:124,   d:'03:05', y:1970, id:1019475382 },
  { t:'In The Morning',                   a:'JØRD',                    g:'House',       b:124,   d:'02:43', y:1981, id:1356912982 },
  { t:'Jerusalema',                       a:'Master KG',               g:'Afro',        b:124,   d:'05:43', y:2020, id:1015793062 },

  // ── Photo 14 — 124–126 BPM (nouveaux) ────────────────────────────
  { t:'Give Me Love',                     a:'Cerrone',                 g:'Disco',       b:124,   d:'05:00', y:2025, id:3068785251 },
  { t:'Firework',                         a:'Katy Perry',              g:'Electro',     b:124,   d:'03:48', y:2010, id:6812361 },
  { t:'Music Sounds Better With You',     a:'Stardust',                g:'House',       b:124.2, d:'04:21', y:1998, id:695110942 },
  { t:'Music Sounds Better With You',     a:'Stardust',                g:'House',       b:124.2, d:'06:43', y:1998, id:695110932 },
  { t:'Love Today',                       a:'MIKA',                    g:'Pop',         b:124.5, d:'03:55', y:2007, id:953605 },
  { t:'Make Luv',                         a:'Room 5',                  g:'House',       b:124.8, d:'03:32', y:2001, id:57840351 },
  { t:'You See the Trouble with Me',      a:'Black Legend',            g:'House',       b:125,   d:'03:22', y:2000, id:414594022 },
  { t:'Jealousy',                         a:'Martin Solveig',          g:'House',       b:125,   d:'05:19', y:2005, id:3786009792 },
  { t:'Right Round',                      a:'Flo Rida',                g:'Hip-Hop',     b:125,   d:'03:25', y:2009, id:4162078 },
  { t:'La Tarde Se Ha Puesto Triste',     a:'Dr. Kucho!',              g:'House',       b:125,   d:'07:45', y:2010, id:2422118875 },
  { t:'Jubel',                            a:'Klingande',               g:'House',       b:125,   d:'04:44', y:2013, id:102875744 },
  { t:'Goosebumps',                       a:'Travis Scott',            g:'House',       b:125,   d:'02:43', y:2021, id:1208717042 },
  { t:'Can You Feel It',                  a:'The Jacksons',            g:'Disco',       b:125.4, d:'05:58', y:1980, id:611499 },
  { t:'Désenchantée',                     a:'Mylène Farmer',           g:'COCOVARIET',  b:125.9, d:'05:23', y:1991, id:2425807 },

  // ── Photo 15 — 126–128 BPM (tous nouveaux) ───────────────────────
  { t:'Around the World',                 a:'Daft Punk',               g:'House',       b:126,   d:'05:43', y:2005, id:3167843 },
  { t:'Calabria 2007',                    a:'Enur',                    g:'House',       b:126,   d:'03:53', y:2007, id:7117058 },
  { t:'Levels',                           a:'Avicii',                  g:'House',       b:126,   d:'03:20', y:2011, id:14383880 },
  { t:'Changes',                          a:'Faul & Wad',              g:'House',       b:126,   d:'03:22', y:2013, id:809619762 },
  { t:"Don't Tease Me",                   a:'Misstress Barbara',       g:'House',       b:126,   d:'07:18', y:2016, id:2546848982 },
  { t:'In My Mind',                       a:'Dynoro',                  g:'Electro',     b:126,   d:'03:05', y:2018, id:505204262 },
  { t:'Que Calor',                        a:'Major Lazer',             g:'House',       b:126,   d:'02:50', y:2019, id:825112142 },
  { t:'Supercars',                        a:'Wolfgang Gartner',        g:'Electro',     b:126,   d:'03:37', y:2020, id:9937513832 },
  { t:"Love Don't Let Me Go",             a:'David Guetta',            g:'House',       b:127,   d:'03:37', y:1999, id:3087828 },
  { t:"Wish I Didn't Miss You",           a:'Angie Stone',             g:'House',       b:127,   d:'07:52', y:2002, id:71653557 },
  { t:'World Hold On',                    a:'Bob Sinclar',             g:'Disco',       b:127,   d:'03:19', y:2007, id:2633773772 },
  { t:'Memories',                         a:'David Guetta',            g:'House',       b:127,   d:'02:43', y:2010, id:1197592562 },
  { t:'Stereo Love',                      a:'Edward Maya',             g:'House',       b:127,   d:'03:04', y:2009, id:129287494 },
  { t:'The Weekend',                      a:'Michael Gray',            g:'House',       b:127,   d:'08:08', y:2004, id:78304464 },
  { t:'The Weekend',                      a:'Michael Gray',            g:'House',       b:127,   d:'03:12', y:2004, id:78304463 },
  { t:'Insomnia',                         a:'Faithless',               g:'House',       b:127.1, d:'03:33', y:1995, id:7035328 },
  { t:'Capitaine abandonné',              a:'Gold',                    g:'COCOVARIET',  b:127.1, d:'03:55', y:1985, id:3785977732 },
  { t:'Starlight',                        a:'The Supermen Lovers',     g:'House',       b:127.5, d:'06:03', y:2000, id:3370719321 },
  { t:'Feel So Close',                    a:'Calvin Harris',           g:'House',       b:128,   d:'03:28', y:2011, id:13040252 },
  { t:'Moves Like Jagger',                a:'Maroon 5',                g:'Pop',         b:128,   d:'03:21', y:2012, id:12724819 },
];

let updated=0, notFound=0;
for (const t of tracks) {
  try {
    const hash=fh(t.t,t.a), energy=en(t.b), moment=mo(t.b);
    const payload={ $set:{
      bpm: Math.round(t.b*10)/10, genre:t.g, duration:pd(t.d),
      adminQualified:true, energy, tags:['dancefloor'], partyMoment:moment,
      'providers.deezer.trackId':t.id, ...(t.y?{releaseYear:t.y}:{}),
    }};
    let r = await T.findOneAndUpdate({'providers.deezer.trackId':t.id}, payload, {upsert:false});
    if(!r) r = await T.findOneAndUpdate({fallbackHash:hash}, payload, {upsert:false});
    if(r){console.log(`✅ [${t.b} | ⚡${energy}] ${t.t} — ${t.a}`); updated++;}
    else{console.log(`⚠️  NOT FOUND: ${t.t} — ${t.a} (dz${t.id})`); notFound++;}
  } catch(e){console.error(`❌ ${t.t}: ${e.message}`);}
}
console.log(`\n── Batch 5 ──  ✅ ${updated}  ⚠️  ${notFound} non trouvés`);
await mongoose.disconnect(); process.exit(0);
