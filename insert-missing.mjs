/**
 * insert-missing.mjs — Insère ~81 titres absents du seed initial
 * Utilise upsert sur deezerTrackId pour éviter les doublons
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
function en(b){
  if(b>=125) return 9; if(b>=120) return 8; if(b>=110) return 7;
  if(b>=100) return 6; if(b>=90)  return 5; if(b>=80)  return 4; return 3;
}
function mo(b){
  if(b>=120) return 'peak'; if(b>=100) return 'all'; return 'warm-up';
}
function tags(b){
  const t=['dancefloor'];
  if(b>=125) t.push('peak-time');
  if(b<100)  t.push('warm-up');
  return t;
}

const missing = [
  // ══ Batch 6 — NOT FOUND ══════════════════════════════════════════
  { t:'Dana Dana',                      a:'Rima',                    g:'Hip-Hop',     b:103,   d:'04:06', y:null, id:2689621452 },
  { t:'Down The Road',                  a:'C2C',                     g:'Electro',     b:111,   d:'03:27', y:null, id:54519711 },
  { t:'Bulanga',                        a:'Felipe Allenn',           g:'House',       b:120,   d:'02:47', y:null, id:3507123471 },
  { t:'Call on Me',                     a:'Eric Prydz',              g:'House',       b:126.3, d:'02:51', y:null, id:144203048 },
  { t:'Animals',                        a:'Martin Garrix',           g:'House',       b:128,   d:'05:04', y:2013, id:2102633427 },
  { t:'Just a Little More Love',        a:'David Guetta',            g:'House',       b:128,   d:'03:24', y:2025, id:553056812 },
  { t:'I Gotta Feeling',                a:'Black Eyed Peas',         g:'Electro',     b:128,   d:'04:49', y:2009, id:4619466 },
  { t:'Rattle',                         a:'Bingo Players',           g:'Electro',     b:128,   d:'04:47', y:2011, id:466013612 },
  { t:'Love Is Gone',                   a:'David Guetta',            g:'House',       b:128,   d:'03:19', y:2012, id:3107326 },
  { t:'Pursuit of Happiness',           a:'InstaHit Crew',           g:'House',       b:128,   d:'06:18', y:2012, id:68133053 },
  { t:'Booyah',                         a:'Showtek',                 g:'Electro',     b:128,   d:'03:35', y:2013, id:1451459162 },
  { t:"I'm an Albatraoz",               a:'AronChupa',               g:'Electro',     b:128,   d:'02:47', y:2014, id:82564724 },
  { t:'Pursuit Of Happiness',           a:'Kid Cudi',                g:'House',       b:128,   d:'06:14', y:2016, id:18181530 },
  { t:'Magnolias for Ever',             a:'Claude François',         g:'House',       b:128,   d:'05:32', y:2022, id:1984836197 },
  { t:'Hello',                          a:'Martin Solveig',          g:'House',       b:128,   d:'04:41', y:null, id:3803035232 },
  { t:'One Day (Vandaag)',               a:'Bakermat',                g:'House',       b:128,   d:'03:39', y:2014, id:75819429 },
  { t:'Put Your Hands Up For Detroit',  a:'Fedde Le Grand',          g:'House',       b:128,   d:'06:33', y:2006, id:1134280762 },
  { t:'Pump It Up',                     a:'Endor',                   g:'Electro',     b:129,   d:'02:31', y:2025, id:3156101171 },
  { t:'Somebody That I Used To Know',   a:'Gotye',                   g:'Pop',         b:129,   d:'07:15', y:null, id:38194901 },

  // ══ Batch 7 — NOT FOUND ══════════════════════════════════════════
  { t:'I Want You',                     a:'Martin Solveig',          g:'House',       b:128,   d:'04:25', y:null, id:3808856552 },
  { t:'Together',                       a:'David Guetta',            g:'House',       b:128,   d:'02:33', y:null, id:3434402411 },
  { t:"Let's Go",                       a:'Jaden Bojsen',            g:'Electro',     b:129,   d:'02:40', y:2019, id:3016411391 },
  { t:'Sweat',                          a:'Snoop Dogg',              g:'Hip-Hop',     b:130,   d:'05:43', y:null, id:10296241 },
  { t:'Bring the Noise',                a:'Public Enemy',            g:'Hip-Hop',     b:130,   d:'03:43', y:1987, id:69170898 },
  { t:'No Stress',                      a:'Laurent Wolf',            g:'House',       b:130,   d:'03:21', y:2008, id:650147122 },
  { t:'San Francisco',                  a:'Ph Electro',              g:'Electro',     b:130,   d:'03:17', y:null, id:87982541 },
  { t:'Be Your Friend',                 a:'Cheat Codes',             g:'House',       b:131,   d:'02:40', y:null, id:3378403321 },
  { t:'Toop Toop',                      a:'Cassius',                 g:'Electro',     b:132,   d:'02:47', y:null, id:120536314 },
  { t:'Without You',                    a:'Avicii',                  g:'House',       b:134,   d:'03:02', y:null, id:393460732 },
  { t:'Free Bird',                      a:'MOONLGHT',                g:'Electro',     b:142,   d:'01:54', y:2025, id:2916188841 },

  // ══ Batch 8 — Warm-up lents ═══════════════════════════════════════
  { t:'Never Ever',                     a:'All Saints',              g:'Années 90',   b:67.1,  d:'06:28', y:null, id:706847 },
  { t:'Shout!',                         a:'The Isley Brothers',      g:'R&B',         b:69.5,  d:'04:24', y:null, id:473274412 },
  { t:'Boombastic',                     a:'Shaggy',                  g:'Reggaeton',   b:79.2,  d:'04:07', y:null, id:2122526 },
  { t:'Good Thing',                     a:'Fine Young Cannibals',    g:'Années 80',   b:82.3,  d:'03:22', y:null, id:428850822 },
  { t:'Shy Guy',                        a:'Diana King',              g:'Reggaeton',   b:94.1,  d:'04:19', y:null, id:13165731 },

  // ══ Batch 9 — NOT FOUND ══════════════════════════════════════════
  { t:'Paradise City',                  a:"Guns N' Roses",           g:'Rock',        b:100.1, d:'06:46', y:null, id:518458142 },
  { t:'Rock DJ',                        a:'Robbie Williams',         g:'Pop',         b:103,   d:'04:02', y:null, id:3148646711 },
  { t:'Bette Davis Eyes',               a:'Kim Carnes',              g:'Années 80',   b:116.8, d:'03:46', y:null, id:3153065 },

  // ══ Batch 10 — NOT FOUND ═════════════════════════════════════════
  { t:'Les Oies Sauvages',              a:'Yann Muller',             g:'House',       b:121,   d:'02:25', y:null, id:2901697491 },
  { t:'Paroles',                        a:'Yann Muller',             g:'Pop',         b:125,   d:'04:15', y:null, id:928969372 },
  { t:'Mr. Saxobeat',                   a:'Alexandra Stan',          g:'Electro',     b:127,   d:'03:15', y:null, id:1077700822 },
  { t:'Saturday Hustle',                a:'DiscoGalactiX',           g:'Disco',       b:127.1, d:'05:50', y:null, id:1629769072 },
  { t:"It's Not Right But It's Okay",   a:'Mr. Belt & Wezol',        g:'House',       b:128,   d:'02:32', y:2025, id:2589549242 },
  { t:'Si Antes Te Hubiera Conocido',   a:'KAROL G',                 g:'Latin',       b:128,   d:'03:16', y:2024, id:2846442802 },
  { t:'Outro Lugar',                    a:'Salomé de Bahia',         g:'Latin',       b:128,   d:'03:02', y:null, id:2716896732 },
  { t:'Balada',                         a:'Gusttavo Lima',           g:'Latin',       b:128,   d:'03:22', y:2013, id:767383202 },
  { t:'Je ne suis pas un héros',        a:'Daniel Balavoine',        g:'COCOVARIET',  b:128.8, d:'05:15', y:1980, id:886322 },
  { t:'Dis-moi',                        a:'BB Brunes',               g:'Pop',         b:129.6, d:'02:25', y:2007, id:714554 },
  { t:'La goffa Lolita',                a:'Vincè la petite culotte', g:'Pop',         b:130,   d:'03:41', y:null, id:1619126272 },
  { t:"Ça m'énerve",                    a:'Helmut Fritz',            g:'House',       b:130,   d:'03:38', y:2009, id:2862281 },
  { t:'Danza Kuduro',                   a:'Lucenzo',                 g:'Reggaeton',   b:130,   d:'03:36', y:2012, id:1161020382 },
  { t:'Ateo',                           a:'C. Tangana',              g:'Latin',       b:130,   d:'04:00', y:2022, id:1507773472 },
  { t:'When Love Takes Over',           a:'David Guetta',            g:'House',       b:130,   d:'03:11', y:2009, id:3445820 },
  { t:'Fuck You',                       a:'Lily Allen',              g:'Pop',         b:130,   d:'03:41', y:2009, id:3148168 },
  { t:'Place des grands hommes',        a:'Patrick Bruel',           g:'COCOVARIET',  b:130.7, d:'04:29', y:1989, id:600886 },
  { t:'Monday, Tuesday... Laissez-moi danser', a:'Dalida',           g:'COCOVARIET',  b:134,   d:'02:40', y:1979, id:1149273 },

  // ══ Batch 11 — NOT FOUND ═════════════════════════════════════════
  { t:"It's Raining Men",               a:'Geri Halliwell',          g:'Electro',     b:136.5, d:'04:15', y:2004, id:3472539 },
  { t:'Viva La Vida',                   a:'Coldplay',                g:'Pop',         b:138,   d:'04:02', y:2008, id:3157972 },
  { t:'Marry You',                      a:'Bruno Mars',              g:'Pop',         b:145,   d:'03:50', y:2010, id:8011854 },
  { t:'Cosmo',                          a:'Soprano',                 g:'Hip-Hop',     b:146,   d:'03:04', y:2014, id:576822202 },
  { t:'Holding Out for a Hero',         a:'Bonnie Tyler',            g:'Electro',     b:149,   d:'04:21', y:1984, id:911317852 },
  { t:"Dans les yeux d'Émilie",         a:'Romain Ughetto',          g:'COCOVARIET',  b:150,   d:'02:41', y:null, id:2847461482 },
  { t:'Happy',                          a:'Pharrell Williams',       g:'Pop',         b:160,   d:'03:53', y:2014, id:701326562 },
  { t:'New York avec toi',              a:'Telephone',               g:'COCOVARIET',  b:162,   d:'02:23', y:1984, id:3256016 },
  { t:'Numb',                           a:'Elderbrook',              g:'House',       b:120,   d:'03:50', y:2020, id:893594412 },
  { t:'Lovely',                         a:'Ikerfoxx',                g:'House',       b:122,   d:'04:39', y:null, id:2858067662 },
  { t:'Intro',                          a:'TR3NACRIA',               g:'House',       b:122,   d:'02:54', y:null, id:2695572412 },
  { t:'My Love for You',                a:'Marten Lou',              g:'House',       b:122,   d:'03:26', y:2002, id:2477781041 },
  { t:'Havanero',                       a:'DJ Jarell',               g:'House',       b:122,   d:'05:29', y:2024, id:3701274662 },
  { t:'Miracle',                        a:'Adriatique',              g:'House',       b:123,   d:'08:24', y:null, id:2492716331 },

  // ══ Batch 12 — NOT FOUND ═════════════════════════════════════════
  { t:'Like A Dream',                   a:'Adriatique',              g:'House',       b:123,   d:'04:13', y:2024, id:2951106011 },
  { t:'Past Lives',                     a:'sapientdream',            g:'Electro',     b:124,   d:'03:12', y:null, id:2608551762 },
  { t:'Baddy On The Floor',             a:'Jamie xx',                g:'House',       b:124,   d:'03:42', y:2024, id:2720190122 },
  { t:'Yu Feel',                        a:'Verb',                    g:'House',       b:124,   d:'02:38', y:1999, id:3329690381 },
  { t:'Sing It Back',                   a:'Dj Hermes',               g:'House',       b:124,   d:'09:02', y:2022, id:1738774067 },
  { t:"Wish I Didn't Miss You",         a:'Angie Stone',             g:'Disco',       b:124.1, d:'04:31', y:2001, id:966648 },

  // ══ Batch 13 — NOT FOUND ═════════════════════════════════════════
  { t:'Tried So Hard',                  a:'Youngr',                  g:'Electro',     b:125,   d:'04:37', y:null, id:2652885342 },
  { t:'No Sleep',                       a:'Meduza',                  g:'House',       b:128,   d:'02:42', y:2002, id:3603058412 },
  { t:'Caramelle',                      a:'Mesto',                   g:'House',       b:128,   d:'02:00', y:2025, id:3628883602 },
  { t:'Your World',                     a:'Benedetto',               g:'House',       b:129,   d:'05:32', y:2010, id:5747924 },
  { t:'We Are Perfect',                 a:'Cristian Marchi',         g:'Electro',     b:129,   d:'05:06', y:2007, id:517144922 },
  { t:'Anxiety',                        a:'Doechii',                 g:'Hip-Hop',     b:129,   d:'04:09', y:2025, id:3262675101 },
  { t:'Desolate Lands',                 a:'Adam Beyer',              g:'Electro',     b:129,   d:'04:19', y:2025, id:3422267721 },
  { t:'Cambodia',                       a:'Agoria',                  g:'Electro',     b:126,   d:'03:55', y:null, id:3811654872 },
];

let inserted=0, skipped=0;
for (const t of missing) {
  try {
    const hash = fh(t.t, t.a);
    // Vérifie si déjà présent (double sécurité)
    const exists = await T.findOne({
      $or: [{ 'providers.deezer.trackId': t.id }, { fallbackHash: hash }]
    });
    if (exists) {
      // Met à jour les métadonnées manquantes
      await T.updateOne({ _id: exists._id }, { $set: {
        bpm: t.b, genre: t.g, duration: pd(t.d),
        adminQualified: true, energy: en(t.b), tags: tags(t.b),
        partyMoment: mo(t.b), 'providers.deezer.trackId': t.id,
        ...(t.y ? { releaseYear: t.y } : {}),
      }});
      console.log(`♻️  UPDATED existing: ${t.t} — ${t.a}`);
      skipped++;
    } else {
      await T.create({
        title: t.t, artist: t.a, genre: t.g,
        bpm: t.b, duration: pd(t.d), energy: en(t.b),
        tags: tags(t.b), partyMoment: mo(t.b),
        adminQualified: true, fallbackHash: hash,
        suggestCount: 0, feuCount: 0,
        providers: { deezer: { trackId: t.id } },
        ...(t.y ? { releaseYear: t.y } : {}),
      });
      console.log(`➕ INSERTED: [${t.b} BPM | ⚡${en(t.b)}] ${t.t} — ${t.a}`);
      inserted++;
    }
  } catch(e){
    if (e.code === 11000) {
      console.log(`⚠️  DUPE: ${t.t} — ${t.a}`);
      skipped++;
    } else {
      console.error(`❌ ${t.t}: ${e.message}`);
    }
  }
}
console.log(`\n══════════════════════════════════`);
console.log(`  ➕ Insérés  : ${inserted}`);
console.log(`  ♻️  Mis à jour: ${skipped}`);
console.log(`  📀 Total    : ${inserted + skipped}`);
console.log(`══════════════════════════════════`);
await mongoose.disconnect(); process.exit(0);
