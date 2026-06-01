/**
 * user-catalog.js — Bibliothèque personnelle du host (extrait de djay)
 *
 * Utilisé par :
 *   - stress.js  → les bots suggèrent ces titres (avec vrais deezerIDs)
 *   - seed-catalog.js → upsert MongoDB pour le snapshot DJBrain
 *
 * Deezer IDs extraits depuis le nom de fichier djay (format dzNNNNNNNNN).
 * Genres normalisés vers les familles DJBrain (Hip-Hop, Pop, House, Disco,
 * Electro, R&B, Latin, Reggaeton, Afro).
 */

export const USER_CATALOG = [
  // ── BPM 80–99 ────────────────────────────────────────────────────────
  { title: "Soleil Bleu",                   artist: "Bleu Soleil",           deezerID: 3278913111, bpm: 80,  genre: "Electro",   duration: 246, year: 2025 },
  { title: "CIEL",                          artist: "GIMS",                  deezerID: 3045169941, bpm: 81,  genre: "Hip-Hop",   duration: 186, year: 2024 },
  { title: "Copines",                       artist: "Aya Nakamura",          deezerID: 576851242,  bpm: 90,  genre: "Hip-Hop",   duration: 172, year: 2018 },
  { title: "ONE TRACK MIND",               artist: "Naïka",                 deezerID: 3650665212, bpm: 91,  genre: "Pop",       duration: 200, year: 2026 },
  { title: "Human Nature",                  artist: "Michael Jackson",       deezerID: 831196,     bpm: 93,  genre: "R&B",       duration: 245, year: 1983 },
  { title: "GIRLFRIEND",                    artist: "Tayc",                  deezerID: 3938003381, bpm: 95,  genre: "Hip-Hop",   duration: 259, year: 2026 },
  { title: "hate that i made you love me", artist: "Ariana Grande",         deezerID: 4045817471, bpm: 96,  genre: "Pop",       duration: 197, year: 2026 },
  { title: "La lune",                       artist: "Christophe Maé",        deezerID: 3760706922, bpm: 98,  genre: "Pop",       duration: 208, year: 2026 },
  { title: "Lush Life",                     artist: "Zara Larsson",          deezerID: 144389048,  bpm: 98,  genre: "Pop",       duration: 201, year: 2015 },
  { title: "Comme Caroline",               artist: "Zaho",                  deezerID: 3814069442, bpm: 99,  genre: "Pop",       duration: 185, year: 2013 },

  // ── BPM 100–112 ──────────────────────────────────────────────────────
  { title: "NETFLIX CHILL",                artist: "Zola",                  deezerID: 4047900401, bpm: 100, genre: "Hip-Hop",   duration: 149, year: 2024 },
  { title: "C'est à qui le tour",          artist: "Mylène Farmer",         deezerID: 4030914551, bpm: 102, genre: "House",     duration: 169, year: 2008 },
  { title: "I Just Might",                  artist: "Bruno Mars",            deezerID: 3867905101, bpm: 103, genre: "Pop",       duration: 212, year: 2026 },
  { title: "FEVER DREAM",                  artist: "Alex Warren",           deezerID: 3869647201, bpm: 108, genre: "Pop",       duration: 153, year: 2026 },
  { title: "18 Carats",                    artist: "Alonzo",                deezerID: 3979681391, bpm: 110, genre: "Hip-Hop",   duration: 180, year: 2024 },
  { title: "Tití Me Preguntó",             artist: "Bad Bunny",             deezerID: 1741494317, bpm: 111, genre: "Reggaeton", duration: 244, year: 2022 },
  { title: "Feel Good",                    artist: "Charlotte Cardin",      deezerID: 2424911405, bpm: 111, genre: "Pop",       duration: 163, year: 2023 },
  { title: "FASHION DESIGNA",             artist: "Theodora",              deezerID: 3060824431, bpm: 112, genre: "Hip-Hop",   duration: 184, year: 2024 },
  { title: "Ordinary",                     artist: "Alex Warren",           deezerID: 3210709941, bpm: 112, genre: "Pop",       duration: 186, year: 2025 },

  // ── BPM 113–122 ──────────────────────────────────────────────────────
  { title: "DtMF",                         artist: "Bad Bunny",             deezerID: 3171003131, bpm: 113, genre: "Reggaeton", duration: 237, year: 2025 },
  { title: "What You Want",               artist: "Angèle",                deezerID: 3827212511, bpm: 114, genre: "Electro",   duration: 188, year: 2026 },
  { title: "MON BÉBÉ",                    artist: "RnBoi",                 deezerID: 3602108062, bpm: 114, genre: "Hip-Hop",   duration: 131, year: 2024 },
  { title: "Dracula",                      artist: "Tame Impala",           deezerID: 3818963601, bpm: 115, genre: "Disco",     duration: 209, year: 2026 },
  { title: "Picasso",                      artist: "Bigflo & Oli",          deezerID: 3884482901, bpm: 115, genre: "Hip-Hop",   duration: 166, year: 2026 },
  { title: "Tu dors ?",                   artist: "PLK",                   deezerID: 3862146611, bpm: 115, genre: "Hip-Hop",   duration: 128, year: 2026 },
  { title: "WHERE IS MY HUSBAND!",        artist: "Raye",                  deezerID: 3548216281, bpm: 116, genre: "R&B",       duration: 197, year: 2025 },
  { title: "Dai Dai",                      artist: "Shakira",               deezerID: 4015341011, bpm: 116, genre: "Latin",     duration: 223, year: 2007 },
  { title: "La recette",                   artist: "Jeck",                  deezerID: 3571311501, bpm: 116, genre: "Pop",       duration: 182, year: 2025 },
  { title: "OG",                           artist: "Genezio",               deezerID: 3674551372, bpm: 117, genre: "Hip-Hop",   duration: 165, year: 2025 },
  { title: "Billie Jean",                  artist: "Michael Jackson",       deezerID: 4603408,    bpm: 117, genre: "Disco",     duration: 294, year: 1983 },
  { title: "NUEVAYoL",                    artist: "Bad Bunny",             deezerID: 3171002981, bpm: 118, genre: "Reggaeton", duration: 184, year: 2025 },
  { title: "Man I Need",                   artist: "Olivia Dean",           deezerID: 3503857201, bpm: 119, genre: "Pop",       duration: 184, year: 2025 },
  { title: "AVEC MOI",                    artist: "RnBoi",                 deezerID: 3732618262, bpm: 120, genre: "Hip-Hop",   duration: 182, year: 2024 },
  { title: "J'oublie tout",               artist: "Jul",                   deezerID: 75867418,   bpm: 120, genre: "Hip-Hop",   duration: 317, year: 2002 },
  { title: "Le monde est à moi",          artist: "Jul",                   deezerID: 4013762661, bpm: 120, genre: "Hip-Hop",   duration: 224, year: 2024 },
  { title: "Sous la lune",                artist: "Jul",                   deezerID: 701987352,  bpm: 120, genre: "Hip-Hop",   duration: 171, year: 2019 },
  { title: "Été avec toi",               artist: "Adèle Castillon",       deezerID: 4034126871, bpm: 120, genre: "Pop",       duration: 187, year: 2026 },
  { title: "RUINART",                     artist: "R2",                    deezerID: 3401257811, bpm: 122, genre: "Hip-Hop",   duration: 175, year: 2024 },
  { title: "Jamaican",                     artist: "HUGEL",                 deezerID: 3889748961, bpm: 122, genre: "House",     duration: 156, year: 2025 },

  // ── BPM 122–128 ──────────────────────────────────────────────────────
  { title: "La bandite",                   artist: "Jul",                   deezerID: 767071002,  bpm: 123, genre: "Hip-Hop",   duration: 161, year: 2019 },
  { title: "Golden",                       artist: "HUNTR/X",               deezerID: 3412534581, bpm: 123, genre: "Pop",       duration: 192, year: 2025 },
  { title: "C'est la cité",               artist: "Jul",                   deezerID: 1426733732, bpm: 123, genre: "Hip-Hop",   duration: 224, year: 2015 },
  { title: "FEU VERT",                    artist: "ISS",                   deezerID: 3987094421, bpm: 123, genre: "Hip-Hop",   duration: 203, year: 2025 },
  { title: "PARISIENNE",                  artist: "GIMS",                  deezerID: 3484365861, bpm: 123, genre: "Hip-Hop",   duration: 158, year: 2025 },
  { title: "Pocahontas",                   artist: "PLK",                   deezerID: 3862146511, bpm: 124, genre: "Hip-Hop",   duration: 168, year: 2026 },
  { title: "The Fate of Ophelia",         artist: "Taylor Swift",          deezerID: 3579685431, bpm: 124, genre: "Pop",       duration: 226, year: 2025 },
  { title: "Paris",                        artist: "Nono La Grinta",        deezerID: 3294048841, bpm: 124, genre: "Hip-Hop",   duration: 168, year: 2025 },
  { title: "C'est dur d'aimer",           artist: "Jul",                   deezerID: 4013762651, bpm: 124, genre: "Hip-Hop",   duration: 190, year: 2026 },
  { title: "YAKUZA",                       artist: "RK",                    deezerID: 4043072601, bpm: 125, genre: "House",     duration: 161, year: 2025 },
  { title: "ELLE VOULAIT",               artist: "RnBoi",                 deezerID: 3835893541, bpm: 125, genre: "Hip-Hop",   duration: 146, year: 2025 },
  { title: "BLOQUÉ",                      artist: "GIMS",                  deezerID: 3629572332, bpm: 126, genre: "Hip-Hop",   duration: 201, year: 2013 },
  { title: "Tour du monde",               artist: "Soolking",              deezerID: 3469521671, bpm: 126, genre: "Hip-Hop",   duration: 172, year: 2019 },
  { title: "À l'aise",                    artist: "TRIANGLE DES BERMUDES", deezerID: 3899366101, bpm: 127, genre: "Hip-Hop",   duration: 180, year: 2025 },
  { title: "SPA",                          artist: "GIMS",                  deezerID: 3758716202, bpm: 127, genre: "Pop",       duration: 183, year: 2015 },
  { title: "Si Antes Te Hubiera Conocido",artist: "KAROL G",               deezerID: 2846442802, bpm: 128, genre: "Reggaeton", duration: 196, year: 2024 },
  { title: "Beauty And A Beat",           artist: "Justin Bieber",         deezerID: 37027991,   bpm: 128, genre: "House",     duration: 228, year: 2012 },
  { title: "méli-mélo",                   artist: "kulturr",               deezerID: 3675222292, bpm: 128, genre: "Hip-Hop",   duration: 153, year: 2025 },
  { title: "New Religion",                artist: "Bebe Rexha",            deezerID: 3850680281, bpm: 128, genre: "House",     duration: 174, year: 2026 },
  { title: "RENÉ CAOVILLA",              artist: "Gambi",                 deezerID: 3921078891, bpm: 128, genre: "Hip-Hop",   duration: 137, year: 2025 },

  // ── BPM 129–140 ──────────────────────────────────────────────────────
  { title: "Avion de chasse",             artist: "Zeg P",                 deezerID: 4000152541, bpm: 130, genre: "Hip-Hop",   duration: 136, year: 2025 },
  { title: "Kendall",                      artist: "Booba",                 deezerID: 4047736081, bpm: 130, genre: "Hip-Hop",   duration: 193, year: 2025 },
  { title: "Maladie",                      artist: "Mauvais Djo",           deezerID: 4045099331, bpm: 130, genre: "Hip-Hop",   duration: 192, year: 2025 },
  { title: "Pilé",                         artist: "Mauvais Djo",           deezerID: 3499178151, bpm: 130, genre: "Hip-Hop",   duration: 156, year: 2024 },
  { title: "Soleil",                       artist: "GIMS",                  deezerID: 3935276381, bpm: 130, genre: "Pop",       duration: 131, year: 2013 },
  { title: "LOVE YOU",                    artist: "Nono La Grinta",        deezerID: 3579710801, bpm: 130, genre: "Hip-Hop",   duration: 147, year: 2025 },
  { title: "Argent Sale",                 artist: "La Rvfleuze",           deezerID: 3837291721, bpm: 130, genre: "Hip-Hop",   duration: 164, year: 2025 },
  { title: "Talk To You",                 artist: "ANOTR",                 deezerID: 3784724892, bpm: 132, genre: "House",     duration: 191, year: 2025 },
  { title: "PARLU",                       artist: "La Rvfleuze",           deezerID: 3911003931, bpm: 133, genre: "Hip-Hop",   duration: 141, year: 2026 },
  { title: "Phénoménal",                  artist: "Jul",                   deezerID: 3314018771, bpm: 133, genre: "Hip-Hop",   duration: 204, year: 2025 },
  { title: "Balek",                        artist: "TRIANGLE DES BERMUDES", deezerID: 3899366131, bpm: 135, genre: "Hip-Hop",   duration: 177, year: 2025 },
  { title: "Beat It",                      artist: "Michael Jackson",       deezerID: 4763165,    bpm: 139, genre: "Pop",       duration: 258, year: 1983 },

  // ── BPM 140+ ─────────────────────────────────────────────────────────
  { title: "Hakayet",                      artist: "VEN1",                  deezerID: 2846025562, bpm: 139, genre: "Hip-Hop",   duration: 158, year: 2025 },
  { title: "KYKY2BONDY",                  artist: "Hamza",                 deezerID: 3330178491, bpm: 140, genre: "Hip-Hop",   duration: 137, year: 2025 },
  { title: "Parfum quartier",             artist: "Jul",                   deezerID: 410780162,  bpm: 141, genre: "Hip-Hop",   duration: 226, year: 2024 },
  { title: "Asalto",                       artist: "Jul",                   deezerID: 600108042,  bpm: 142, genre: "Electro",   duration: 267, year: 2013 },
  { title: "Gabriela",                     artist: "KATSEYE",               deezerID: 3412611901, bpm: 146, genre: "Pop",       duration: 196, year: 2025 },
  { title: "Pangor",                       artist: "Djaksparo",             deezerID: 3977159061, bpm: 146, genre: "Hip-Hop",   duration: 121, year: 2025 },
  { title: "Sexy Nana",                   artist: "Aya Nakamura",          deezerID: 3995047821, bpm: 148, genre: "Hip-Hop",   duration: 156, year: 2025 },
  { title: "Soirée mondaine",             artist: "Oria",                  deezerID: 3651885972, bpm: 150, genre: "Pop",       duration: 198, year: 2025 },
  { title: "ZOU BISOU",                   artist: "Theodora",              deezerID: 3380338381, bpm: 150, genre: "Hip-Hop",   duration: 162, year: 2025 },
  { title: "melodrama",                    artist: "disiz",                 deezerID: 3558373981, bpm: 154, genre: "Hip-Hop",   duration: 176, year: 2025 },
  { title: "B.M.S",                       artist: "Rambo Goyard",          deezerID: 3809346722, bpm: 154, genre: "Hip-Hop",   duration: 125, year: 2025 },
  { title: "Miss Kitoko",                  artist: "Theodora",              deezerID: 3884172321, bpm: 154, genre: "Hip-Hop",   duration: 150, year: 2025 },
  { title: "Adriano",                      artist: "Niska",                 deezerID: 3442901201, bpm: 155, genre: "Hip-Hop",   duration: 142, year: 2024 },
  { title: "End of Beginning",            artist: "Djo",                   deezerID: 1899060227, bpm: 160, genre: "Pop",       duration: 159, year: 2022 },
  { title: "Baddies",                      artist: "Aya Nakamura",          deezerID: 3356310051, bpm: 160, genre: "R&B",       duration: 207, year: 2025 },
  { title: "Sex Model",                    artist: "PLK",                   deezerID: 3842413311, bpm: 160, genre: "Hip-Hop",   duration: 166, year: 2026 },
  { title: "Self Aware",                   artist: "Temper City",           deezerID: 3848530521, bpm: 162, genre: "Hip-Hop",   duration: 181, year: 2025 },
  { title: "Génération impolie",           artist: "Franglish",             deezerID: 3591983602, bpm: 127, genre: "Hip-Hop",   duration: 141, year: 2025 },
];

// Derived helpers
export const CATALOG_TITLES  = USER_CATALOG.map(t => t.title);
export const CATALOG_ARTISTS = USER_CATALOG.map(t => t.artist);
export const pickCatalogTrack = () =>
  USER_CATALOG[Math.floor(Math.random() * USER_CATALOG.length)];
