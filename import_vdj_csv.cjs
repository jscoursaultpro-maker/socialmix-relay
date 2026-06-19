/**
 * import_vdj_csv.cjs
 * Lit SocialMix V1.csv (export Virtual DJ), applique les corrections de genre,
 * déduplique, et génère le code Swift pour curatedTracks dans DJBrain.swift
 */
const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', 'SocialMix V1.csv');
const OUTPUT_PATH = path.join(__dirname, 'curated_from_vdj.swift');
const FEEDBACK_PATH = path.join(__dirname, 'socialmix_feedback.json');

// ── 1. Normalisation automatique des labels VDJ → SocialMix ──
const GENRE_NORM = {
  'hip hop':            'Hip-Hop',
  'hip-hop':            'Hip-Hop',
  'hip-house':          'Hip-Hop',
  'pop rap':            'Hip-Hop',
  'trap':               'Hip-Hop',
  'bass music':         'Hip-Hop',
  'funk / soul':        'Disco',
  'funk/soul':          'Disco',
  'soul':               'Disco',
  'nu-disco':           'Disco',
  'disco':              'Disco',
  'euro house':         'House',
  'deep house':         'House',
  'progressive house':  'House',
  'tech house':         'House',
  'french house':       'House',
  'tribal house':       'House',
  'electro house':      'House',
  'future house':       'House',
  'garage house':       'House',
  'balearic':           'House',
  'house':              'House',
  'electro':            'Electro',
  'trance':             'Electro',
  'techno':             'Electro',
  'deep techno':        'Electro',
  'idm':                'Electro',
  'hands up':           'Electro',
  'progressive breaks': 'Electro',
  'eurobeat':           'Electro',
  'eurodance':          'Electro',
  'europop':            'Electro',
  'hard trance':        'Electro',
  'hi nrg':             'Electro',
  'leftfield':          'Electro',
  'dance':              'Electro',
  'dance-pop':          'Pop',   // default, overridden per-track below
  'synth-pop':          'Pop',
  'pop rock':           'Pop',
  'pop':                'Pop',
  'indie pop':          'Pop',
  'k-pop':              'Pop',
  'neo soul':           'Pop',
  'rock':               'Rock',
  'rock & roll':        'Rock',
  'indie rock':         'Rock',
  'goth rock':          'Rock',
  'new wave':           'Rock',
  'latin':              'Latin',
  'reggaeton':          'Latin',
  'guaracha':           'Latin',
  'bachata':            'Latin',
  'reggae':             'Reggae',
  'dub':                'Reggae',
  'contemporary r&b':   'R&B',
  'r&b':                'R&B',
  'drum n bass':        'R&B',
  'chanson':            'COCOVARIET',
  'folk, world, & country': 'COCOVARIET',
  'classical':          'COCOVARIET',
  'ambient':            'Ambient',
  'downtempo':          'Chill',
  'non-music':          'House',  // default, overridden per-track
  'cut-up/dj':          'Hip-Hop',
  'hardcore':           'Electro',
  'big beat':           'Electro',
  'chiptune':           'Electro',
  'dance / club':       'House',
  'dancehall':          'Reggae',
  'dubstep':            'Electro',
  'electroclash':       'Electro',
  'emo':                'Rock',
  'experimental':       'Electro',
  'folk':               'COCOVARIET',
  'gangsta':            'Hip-Hop',
  'hard house':         'House',
  'industrial':         'Electro',
  'italodance':         'Electro',
  'jazz':               'House',   // In VDJ context, mostly House remixes misclassified
  'jazzy hip-hop':      'Hip-Hop',
  'new age':            'Chill',
  'power pop':          'Pop',
  'psy-trance':         'Electro',
  'reggae-pop':         'Reggae',
  'rnb/swing':          'R&B',
  'sound collage':      'Electro',
  'soundtrack':         'Pop',
  'stage & screen':     'Pop',
  'surf':               'Rock',
  'synthwave':          'Electro',
  'theme':              'Pop',
  'trip hop':           'Chill',
  'tropical house':     'House',
  'uk garage':          'House',
  'electronic':         'Electro',
};

// ── 2. Corrections MANUELLES par deezerID (de l'audit) ──
// Clé = deezerID, Valeur = genre corrigé
const ID_OVERRIDES = {
  // BAF - Where You Go → Electro
  3077122251: 'Electro',
  // &ME - Paris → House (pas Rock)
  1668422912: 'House',
  // Walk On Water tracks → House
  3759013842: 'House', 3432928481: 'House', 3482621011: 'House',
  // Buzz Low → House
  2882453692: 'House',
  // Lane Boy → House
  3783585972: 'House',
  // Jack David → House
  3577729901: 'House', 3431109191: 'House',
  // Horizon Blue → House
  3546178961: 'House', 3638296052: 'House', 3516739611: 'House',
  3590269281: 'House', 3058862751: 'House', 3590269301: 'House',
  3638014542: 'House',
  // Giorgio Gee → House
  3728059842: 'House',
  // James Carter Electric Feel → House
  2905837361: 'House',
  // Spirit Fly → House
  3327596641: 'House',
  // Topic → House
  3189331151: 'House',
  // WITH U Karibu → House
  2817151442: 'House',
  // Chris Crone → House
  3703562532: 'House',
  // Fresh Coast → House
  3491222481: 'House',

  // Alex Wann → House
  2949762271: 'House',
  // &Friends → House
  3763440192: 'House',
  // Emotional → House
  2690306832: 'House',
  // joki → House
  3340623721: 'House', 3420727621: 'House',
  // Sandy Beach - Lady → House
  3328916561: 'House',
  // BAF → House
  3251482951: 'House',
  // VLX → House
  3516121731: 'House', 3493991131: 'House',
  // Indicate → House
  3376891891: 'House',
  // Emily Dawn → House
  3304037941: 'House',
  // Lex → House
  3570095261: 'House', 3549134361: 'House',
  // Skye → House
  3338966031: 'House',
  // House Arrest → House
  3473063831: 'House',
  // Miles Carter → House
  3711284062: 'House', 3670195112: 'House', 3539187281: 'House',
  // Gavin Moss → House
  3150428401: 'House',
  // Alok → House
  3417494111: 'House', 3067533781: 'House',
  // Meduza No Sleep → House
  3603058412: 'House',
  // Verb Yu Feel → House
  3329690381: 'House',
  // Innerbloom → House
  113475002: 'House',
  // Marten Lou Miss You remix → House
  2099670727: 'House',
  // Cristian Marchi → House
  517144922: 'House',
  // Bicep Glue → House
  795642332: 'House',
  // Yann Muller Mourir Sur Scene → House (not Classical)
  1207998522: 'House',
  // Yann Muller Les Oies Sauvages → House
  2901697491: 'House',
  // Francis Mercier Voyage Voyage → House
  2562451692: 'House',
  // Trinix Magic Key → House
  2179672997: 'House',
  // Steff Da Campo → House
  3164238781: 'House',
  // Supermen Lovers → House
  3370717541: 'House',
  // Nightcrawlers Friday → House (already House)
  // David Guetta Together → House
  3434402411: 'House',
  // Kungs → House
  1372169352: 'House',
  // MIKA Grace Kelly → Pop (not House)
  953602: 'Pop',
  // Britney Oops → Pop (not House)
  13142617: 'Pop',
  // Beyoncé BREAK MY SOUL → House
  1797297127: 'House',
  // Beyoncé CUFF IT → already House ✅
  // Regard Secrets → House
  923740862: 'House',
  // Marshmello → House
  1775253117: 'House', 2216851977: 'House',
  // Kygo → House
  1896376597: 'House', 1455828442: 'House',
  // Calvin Harris → House (already mostly)
  2660815532: 'House', 2182322087: 'House',
  // Southstar Miss You → House
  1847938107: 'House',
  // Sam Feldt → House
  2174690427: 'House',
  // Martin Garrix → House
  2855135242: 'House',
  // Mosimann → House
  1937152867: 'House',
  // Gabry Ponte → Electro
  3175052941: 'Electro', 3026960801: 'Electro',
  // Gala Freed From Desire → House
  2855541182: 'House',
  // It's Raining Men (Geri) → House
  3472539: 'House',
  // Hard Lights → House
  1286520172: 'House',
  // Naughty Boy Runnin' → Pop
  107406104: 'Pop',
  // David Guetta When Love Takes Over → House
  3445820: 'House',
  // David Guetta Hey Mama → House
  99469540: 'House',
  // Black Eyed Peas Don't Stop → House
  7706008: 'House',
  // Helmut Fritz → House (already)
  // Deorro → House
  123373232: 'House',
  // Marnik → Electro (high BPM)
  2365023705: 'Electro', 2621151252: 'Electro', 2802379712: 'Electro',
  // Pedro Jaxomy → Electro
  2712128861: 'Electro',
  // MOONLGHT Free Bird → Electro
  2916188841: 'Electro',
  // The Tech Thieves → Electro
  629562252: 'Electro',
  // Alexandra Stan → Electro
  1077700822: 'Electro',
  // Edward Maya → Electro
  129287494: 'Electro',
  // Romain Ughetto → Electro
  2847461482: 'Electro',
  // Paul Kalkbrenner → Electro
  3502053411: 'Electro',
  // NTO → Electro
  131065634: 'Electro', 568497412: 'Electro',
  // Stephan Bodzin → Electro
  99272940: 'Electro',
  // Moderat → Electro
  486399342: 'Electro',
  // Carl Cox → Electro
  507548912: 'Electro',
  // Reinier Zonneveld → Electro
  2478140041: 'Electro',
  // Denis Horvat → Electro
  487281862: 'Electro',
  // Adam Beyer → Electro
  3422267721: 'Electro',
  // Dune Wicked Game → Electro
  3327910601: 'Electro',
  // Bang La Decks Zouka → Electro
  82398692: 'Electro',
  // Bonnie Tyler → Pop
  911317852: 'Pop',
  // The Cardigans → Pop
  1088389: 'Pop', 910474: 'Pop', 916525: 'Pop',
  // Britney Toxic → Pop
  15391618: 'Pop',
  // BLACKPINK → Pop
  3454677991: 'Pop',
  // Katy Perry → Pop
  3169161: 'Pop', 6812361: 'Pop',
  // P!nk What About Us → Pop
  415238442: 'Pop',
  // Jessie J → Pop
  14405185: 'Pop',
  // Phil Collins → Pop
  134036220: 'Pop',
  // Kim Carnes → Pop
  3153065: 'Pop',
  // Spice Girls → Pop
  3133738: 'Pop',
  // Sweet Dreams → Pop
  561836: 'Pop',
  // Tainted Love → Pop
  1173622: 'Pop',
  // Justin Timberlake CAN'T STOP → Pop
  124237488: 'Pop',
  // Gwen Stefani → Pop
  1575417: 'Pop',
  // Cyndi Lauper → Pop
  72194071: 'Pop',
  // Bruno Mars Marry You → Pop
  8011854: 'Pop',
  // Tom Odell → Pop
  65723649: 'Pop',
  // Fine Young Cannibals → Pop
  428850822: 'Pop',
  // Eurythmics → Pop
  // Soft Cell → Pop
  // Lily Allen → Pop already
  // Ana Mena → Latin
  1787751117: 'Latin', 2454933765: 'Latin', 1408344462: 'Latin',
  // ROSALÍA DESPECHÁ → Latin
  1841999507: 'Latin',
  // Bad Bunny → Latin
  1122450992: 'Latin', 2289342455: 'Latin', 3171003001: 'Latin',
  3171003131: 'Latin', 3171002981: 'Latin',
  // Rauw Alejandro → Latin
  3012877461: 'Latin',
  // Becky G → Latin
  2170492547: 'Latin',
  // Camila Cabello → Latin
  1666673152: 'Latin', 447098092: 'Latin',
  // Enrique Iglesias → Latin
  84097475: 'Latin',
  // Reik → Latin
  1283987962: 'Latin',
  // Elvis Crespo → Latin
  557093: 'Latin',
  // C. Tangana → Latin
  1507773472: 'Latin',
  // Lucenzo Danza Kuduro → Latin
  1161020382: 'Latin',
  // MC Fioti → Latin
  438850292: 'Latin',
  // Soolking Suavemente → Latin
  1662709912: 'Latin',
  // Black Eyed Peas RITMO → Latin
  772603752: 'Latin',
  // Shakira Loca → Latin
  79589178: 'Latin',
  // Sean Paul → Reggae
  1298490012: 'Reggae', 136341512: 'Reggae',
  // Shaggy → Reggae
  2122526: 'Reggae',
  // Usher Yeah! → R&B
  13783449: 'R&B', 837914: 'R&B',
  // Doja Cat → R&B
  797228462: 'R&B', 2387373015: 'R&B',
  // The Weeknd → R&B
  2375967015: 'R&B',
  // TLC → R&B
  574778: 'R&B',
  // Blackstreet → R&B
  916496: 'R&B',
  // All Saints → R&B
  706847: 'R&B',
  // Jamelia → R&B
  1855814847: 'R&B',
  // Estelle → R&B
  1855507607: 'R&B',
  // DJ Khaled Wild Thoughts → R&B
  375689861: 'R&B',
  // Joé Dwet Filé → Afro
  1298524752: 'Afro',
  // Oxlade → Afro
  2044337497: 'Afro',
  // CKay → Afro
  752155092: 'Afro',
  // Aya Nakamura → Afro
  576851222: 'Afro',
  // Rema → Afro
  1644464022: 'Afro',
  // Jain Makeba → Afro
  109176426: 'Afro', 2370741815: 'Afro',
  // Jain Night Heights → Pop (keep Pop actually, it's borderline)
  // Jahyanai → Afro
  428558022: 'Afro',
  // Lil Nas X STAR WALKIN → Hip-Hop
  1924639057: 'Hip-Hop',
  // Guy2bezbar Monaco → Hip-Hop
  2872998762: 'Hip-Hop',
  // Flo Rida Right Round → Hip-Hop
  4162078: 'Hip-Hop',
  // Travis Scott → Hip-Hop
  1208717042: 'Hip-Hop',
  // Teddybears Cobrastyle → Hip-Hop
  7860278: 'Hip-Hop',
  // Lartiste Chocolat → Hip-Hop
  135203382: 'Hip-Hop',
  // Fatman Scoop → Hip-Hop
  9849814: 'Hip-Hop',
  // C2C → Hip-Hop
  54519711: 'Hip-Hop',
  // Mark Ronson Uptown Funk → Disco
  92734438: 'Disco',
  // Raye → Disco
  3548216281: 'Disco',
  // Bruno Mars 24K Magic → Disco
  136336110: 'Disco',
  // Patrice Rushen → Disco
  434614222: 'Disco',
  // Sister Sledge → Disco
  691622: 'Disco',
  // Oliver Cheatham → Disco
  2044588597: 'Disco',
  // The Jacksons → Disco
  611499: 'Disco',
  // Isley Brothers → Disco
  473274412: 'Disco',
  // DiscoGalactiX → Disco
  1629769072: 'Disco',
  // Cerrone Supernature → Disco
  445812132: 'Disco',
  // &ME Discoteca → House
  1269301652: 'House',
  // Marian Hill Down → Chill
  127244341: 'Chill',
  // Dirty Dancing → Pop
  13128250: 'Pop',
  // Joe Dassin → COCOVARIET
  596537: 'COCOVARIET',
  // Serge Gainsbourg Sea Sex → COCOVARIET
  1728081337: 'COCOVARIET',
  // Jean-Jacques Goldman → COCOVARIET
  730166752: 'COCOVARIET',
  // France Gall → COCOVARIET
  46300831: 'COCOVARIET', 46307001: 'COCOVARIET',
  // Claude François → COCOVARIET
  743689: 'COCOVARIET',
  // Larusso → COCOVARIET
  3528163: 'COCOVARIET',
  // Daniel Balavoine → COCOVARIET
  886322: 'COCOVARIET',
  // Mylène Farmer → COCOVARIET
  2425807: 'COCOVARIET',
  // Dalida → COCOVARIET
  1149273: 'COCOVARIET',
  // Michel Berger → COCOVARIET
  46280411: 'COCOVARIET',
  // THEODORT → COCOVARIET
  3014213321: 'COCOVARIET',
  // Ricchi e Poveri → COCOVARIET
  636405: 'COCOVARIET',
  // Julien Doré → COCOVARIET
  3054938751: 'COCOVARIET', 3054938791: 'COCOVARIET',
  // Romain Drouet remix Bécaud → COCOVARIET
  2367111565: 'COCOVARIET',
  // Brigitte → COCOVARIET
  63348469: 'COCOVARIET',
  // Philippe Katerine → COCOVARIET
  3710863022: 'COCOVARIET',
  // -M- Close to Me → COCOVARIET
  3129684: 'COCOVARIET',
  // Gold → COCOVARIET
  3785977732: 'COCOVARIET',
  // Jean Leloup → COCOVARIET
  128237717: 'COCOVARIET',
  // Manu Chao → COCOVARIET
  71590758: 'COCOVARIET',
  // Shaka Ponk → Rock
  2589964032: 'Rock', 605643392: 'Rock', 2894176151: 'Rock',
  // Gipsy Kings → Latin (keep Latin actually)
  // BB Brunes → Rock
  714554: 'Rock',
  // Patrick Bruel → COCOVARIET
  600886: 'COCOVARIET',
  // Telephone → Rock
  3135725: 'Rock', 3256016: 'Rock',
  // Indochine → Rock
  1151063132: 'Rock', 2840316722: 'Rock',
  // Justice → Electro
  2100102627: 'Electro',
  // Bost & Bim → House
  2490327001: 'House',
  // Sia Cheap Thrills → Pop
  118986142: 'Pop',
  // Winterplay Billie Jean → House
  3336912301: 'House',
  // Travis Scott Goosebumps Deep House remix → Hip-Hop
  // Nile Delta → House (already)
  // Queen You Don't Fool Me → Rock (keep)
  // Dune Wicked Game → already set to Electro
  // Lil Nas X INDUSTRY BABY → Hip-Hop (already after norm)
};

// ── 3. Morceaux supplémentaires (ajoutés manuellement hors CSV) ──
const EXTRA_TRACKS = [
  { deezerID: 13791931, genre: 'Rock', title: 'In Bloom', artist: 'Nirvana', bpm: 114 }
];

// Load feedback scores from relay server
let feedbackScores = {};
try {
  if (fs.existsSync(FEEDBACK_PATH)) {
    const raw = fs.readFileSync(FEEDBACK_PATH, 'utf-8');
    feedbackScores = JSON.parse(raw);
    for (const [idStr, data] of Object.entries(feedbackScores)) {
      if (data.genre && data.participantCount > 0) {
        const ratio = (data.fireCount || 0) / data.participantCount;
        if (ratio > 0.19) {
          EXTRA_TRACKS.push({
            deezerID: parseInt(idStr),
            genre: data.genre,
            title: data.title,
            artist: data.artist,
            bpm: data.bpm
          });
        }
      }
    }
  }
} catch (e) { console.error('No feedback loaded', e); }

// ── 3. Parse CSV ──
const raw = fs.readFileSync(CSV_PATH, 'utf-8');
const lines = raw.split('\n');

// Skip line 1 (sep=,) and line 2 (headers)
const tracks = [];
const seenIds = new Set();
let skipped = 0;
let noId = 0;

for (let i = 2; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  // Parse CSV with quoted fields
  const fields = [];
  let current = '';
  let inQuote = false;
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (c === '"') {
      if (inQuote && line[j+1] === '"') {
        current += '"';
        j++;
      } else {
        inQuote = !inQuote;
      }
    } else if (c === ',' && !inQuote) {
      fields.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current);

  const title = fields[0] || '';
  const artist = fields[2] || '';
  const genreRaw = (fields[6] || '').trim();
  const bpmStr = fields[8] || '';
  const filename = fields[11] || '';
  const rating = fields[12] || '';

  // Extract deezerID
  let deezerID = 0;
  const dzMatch = filename.match(/dz(\d+)/);
  if (dzMatch) {
    deezerID = parseInt(dzMatch[1]);
  }

  if (!deezerID || deezerID === 0) {
    noId++;
    continue;
  }

  // Deduplicate
  if (seenIds.has(deezerID)) {
    skipped++;
    continue;
  }
  seenIds.add(deezerID);

  // BPM
  const bpm = Math.round(parseFloat(bpmStr) || 0);

  // Genre resolution: ID override > genre norm > raw
  let genre;
  if (ID_OVERRIDES[deezerID]) {
    genre = ID_OVERRIDES[deezerID];
  } else {
    const key = genreRaw.toLowerCase();
    genre = GENRE_NORM[key] || genreRaw || 'Pop';
  }

  // Skip empty genre
  if (!genre) genre = 'Pop';

  // Rating → stars count
  const stars = (rating.match(/★/g) || []).length;
  const fireScore = feedbackScores[String(deezerID)] ? feedbackScores[String(deezerID)].fireCount : 0;

  tracks.push({ deezerID, title, artist, genre, bpm, stars, fireScore });
}

// Inject EXTRA_TRACKS
for (const track of EXTRA_TRACKS) {
  if (!seenIds.has(track.deezerID)) {
    const fireScore = feedbackScores[String(track.deezerID)] ? feedbackScores[String(track.deezerID)].fireCount : 0;
    tracks.push({ ...track, stars: 0, fireScore });
    seenIds.add(track.deezerID);
  }
}

// ── 4. Generate Swift code ──
let swift = `    // ★ CURATED BASE V2 — Generated from Virtual DJ export (${new Date().toISOString().slice(0,10)})\n`;
swift += `    // ${tracks.length} tracks, deduplicated, genre-corrected\n`;
swift += `    private var curatedTracks: [CuratedTrack] = [\n`;

// Group by genre for readability
const byGenre = {};
for (const t of tracks) {
  if (!byGenre[t.genre]) byGenre[t.genre] = [];
  byGenre[t.genre].push(t);
}

// Sort genres alphabetically, then tracks by BPM within each genre
const genreOrder = Object.keys(byGenre).sort();
for (const genre of genreOrder) {
  const genreTracks = byGenre[genre].sort((a, b) => a.bpm - b.bpm);
  swift += `\n        // ── ${genre} (${genreTracks.length} tracks) ──\n`;
  for (const t of genreTracks) {
    const safeTitle = t.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const safeArtist = t.artist.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    let line = `        CuratedTrack(deezerID: ${t.deezerID}, genre: "${t.genre}"`.padEnd(58, ' ');
    line += `, title: "${safeTitle}", artist: "${safeArtist}"`;
    if (t.bpm > 0) {
      line += `, bpm: ${t.bpm}`;
    }
    if (t.fireScore > 0) {
      line += `, fireScore: ${t.fireScore}`;
    }
    line += `),\n`;
    swift += line;
  }
}

swift += `    ]\n`;

fs.writeFileSync(OUTPUT_PATH, swift, 'utf-8');

// ── 5. Stats ──
console.log(`\n✅ Import terminé`);
console.log(`   📀 ${tracks.length} tracks uniques`);
console.log(`   🔄 ${skipped} doublons supprimés`);
console.log(`   ⚠️  ${noId} tracks sans ID Deezer (ignorées)`);
console.log(`\n── Répartition par genre ──`);
for (const g of genreOrder) {
  console.log(`   ${g.padEnd(14)} ${byGenre[g].length}`);
}
console.log(`\n📄 Fichier généré: ${OUTPUT_PATH}`);
