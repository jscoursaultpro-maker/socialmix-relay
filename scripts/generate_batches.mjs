import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import Track from '../models/Track.js';

const IN_DIR = path.join(__dirname, '../batches_in');
const OUT_DIR = path.join(__dirname, '../batches_out');

// Clean and create dirs
if (fs.existsSync(IN_DIR)) fs.rmSync(IN_DIR, { recursive: true, force: true });
fs.mkdirSync(IN_DIR, { recursive: true });
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  
  // Find top 1000 unlabeled tracks
  const tracks = await Track.find({
    isLabeled: { $ne: true },
    $or: [
      { deezerID: { $gt: 0 } },
      { "providers.deezer.trackId": { $ne: null } }
    ]
  })
  .sort({ deezerRank: -1 })
  .limit(1000)
  .lean();

  if (tracks.length === 0) {
    console.log("No tracks found to process.");
    process.exit(0);
  }

  const BATCH_SIZE = 25;
  const totalBatches = Math.ceil(tracks.length / BATCH_SIZE);
  
  for (let i = 0; i < totalBatches; i++) {
    const batchTracks = tracks.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const batchId = `batch_${String(i + 1).padStart(3, '0')}`;
    
    const formattedTracks = batchTracks.map(t => ({
      id: t.providers?.deezer?.trackId || t.deezerID || t._id,
      title: t.title,
      artist: typeof t.artist === 'object' ? t.artist.name : t.artist,
      bpm: t.bpm || 0,
      deezerRank: t.deezerRank || 0,
      genre_historique: t._legacyGenre || t.genreBDD || "unknown"
    }));

    const instructions = `Tu es un DJ professionnel expert qui classe des tracks pour SocialMix, app de DJ virtuel autonome.

CONTEXTE SOIRÉE TYPE
Soirée privée (anniversaire 50 ans, mariage). 60 invités. Public mixte 25-65 ans. Forte demande de COCOVARIET (chanson française populaire qui se chante : Goldman, Maître Gims, Aya Nakamura, Stromae, Sardou, Cabrel, Indila).

LES 6 PHASES (chronologiques)
🌅 ARRIVAL (apéro chic, energy 3.5-5.0, BPM 70-110)
   Ex: Sade "Smooth Operator", Norah Jones, Goldman ballades, Cabrel "Petite Marie", Bossa, Lounge, Soul slow.
   À éviter: House, Electro hard, Rap hardcore.

🥂 AMBIANCE (warm-up, energy 5.0-6.5, BPM 80-115)
   Ex: Pop douce (Ed Sheeran), Disco classics mid-tempo, R&B old (Marvin Gaye), COCOVARIET (Souchon, Goldman dansants).
   À éviter: House peak, Electro hard.

🚀 TAKEOFF (la montée, energy 6.5-7.5, BPM 100-125)
   Ex: Disco (Donna Summer), Funk (Kool & The Gang), COCOVARIET dansants, Hip-Hop modéré.

💃 GROOVE (vraiment lancé, energy 7.5-8.5, BPM 115-130)
   Ex: House mainstream (Calvin Harris), Disco upbeat (Sister Sledge), Pop dance (Bruno Mars), Latin (Shakira), Michael Jackson.

🔥 PARTY (peak time, energy 8.5-10, BPM 120-135)
   Ex: House peak (Avicii, Guetta), Electro (Justice), hymnes (Sapés Comme Jamais, Single Ladies, Dancing Queen), bangers Hip-Hop.

🌙 CLOSING (descente émotionnelle, energy 4.5-6.0, BPM 90-115)
   Ex: Disco classics fin (Stayin Alive), Soul slow (Bill Withers "Lovely Day"), COCOVARIET émotionnels (Goldman "Là-bas", Sardou "Le France").

LES 13 GENRES BDD (genreBDD - choisis EXACTEMENT un)
Chill, Soul, Pop, COCOVARIET, Rock, Hip-Hop, R&B, Latin, Afro, Disco, Funk, House, Electro

DISTINCTIONS GENRES BDD
- Chill : ambient, lo-fi, acoustic doux (Norah Jones)
- Soul : classics 60s-70s (Marvin Gaye, Aretha)
- Pop : mainstream international (Lady Gaga, Sheeran)
- COCOVARIET : chanson FR populaire (Goldman, Maître Gims, Aya, Stromae, Sardou, Cabrel, Indila)
- Rock : classic + indie + pop-rock (Foo Fighters, Oasis)
- Hip-Hop : Rap US + FR + Trap (Drake, Kendrick, PNL, Booba)
- R&B : moderne dansant (Beyoncé) ou groove 90s/2000s (TLC)
- Latin : pop latin, salsa, bachata (Shakira, Bad Bunny)
- Afro : Afrobeat (Burna Boy), Afro House
- Disco : Disco 70s pur (Donna Summer, Bee Gees, EWF)
- Funk : Funk classic + Nu-Funk (Kool & Gang, Bruno Mars)
- House : Deep, Vocal, Tech, Funky House (Avicii, Guetta)
- Electro : EDM, Big Room, Synthwave (Daft Punk, Justice)

LES 9 UI CATEGORIES (uiCategoryPrimary - choisis EXACTEMENT une)
Chill, Pop, Rock, Rap, Latin, Old school, Urban Groove, Dance, Électro

(uiCategoriesSecondary : array 0 à 2 catégories UI additionnelles, NE PEUT PAS contenir uiCategoryPrimary)

MAPPING UI CATEGORIES -> genres BDD typiques
- Chill : Chill, Soul slow, Jazz
- Pop : Pop, COCOVARIET tendre
- Rock : Rock
- Rap : Hip-Hop, R&B moderne
- Latin : Latin, Afro
- Old school : Disco, Funk, classics 70s-80s
- Urban Groove : R&B 90s-2000s, Hip-Hop groovy 90s (TLC, Blackstreet, Notorious BIG)
- Dance : House mainstream, COCOVARIET dansants (Sapés Comme Jamais), Pop dance moderne
- Électro : Electro, EDM, Synthwave, Daft Punk style

TAG isHardcore (CRUCIAL pour soirée privée)
isHardcore=true = track agressive/extrême INADAPTÉE pour mariage/anniversaire.
Exemples: techno violente, hard rock, trap drill, hardcore punk, DnB Jungle, hyperpop chaotique, Hardstyle.

RÈGLES DE COHÉRENCE STRICTES (auto-vérifier avant réponse)
1. uiCategoriesSecondary NE CONTIENT JAMAIS uiCategoryPrimary
2. phaseAlternate doit être adjacente : arrival<->ambiance, ambiance<->takeoff, takeoff<->groove, groove<->party, party<->closing
3. Track BPM < 100 -> JAMAIS party
4. Track energy <= 4 -> JAMAIS groove ou party
5. isBanger=true -> phase IMPÉRATIVEMENT groove ou party
6. COCOVARIET tendre (Goldman ballade) -> JAMAIS party
7. Hip-Hop hardcore moderne (Booba, NLE Choppa) -> JAMAIS arrival
8. isHardcore=true -> JAMAIS arrival ni closing + notes OBLIGATOIRE (explique pourquoi)

CALIBRATION — 6 EXEMPLES VARIÉS

EXEMPLE 1 - Banger FR dansant
Track: Sapés Comme Jamais — Maître Gims
{
  "genreBDD": "COCOVARIET", "uiCategoryPrimary": "Dance",
  "uiCategoriesSecondary": ["Rap", "Pop"],
  "phase": "party", "phaseAlternate": "groove",
  "energy": 9, "bpm": 115, "danceability": 0.92,
  "isBanger": true, "isSingalong": true, "isEmotional": false,
  "isCaliente": false, "isHardcore": false,
  "era": "2010s", "mood": "fun", "language": "FR",
  "hasLyrics": true, "explicit": false,
  "notes": "Banger FR universel",
  "justification": "Hit FR moderne, fait chanter et danser"
}

EXEMPLE 2 - Ballade COCOVARIET tendre
Track: Encore un matin — Goldman
{
  "genreBDD": "COCOVARIET", "uiCategoryPrimary": "Pop",
  "uiCategoriesSecondary": [],
  "phase": "arrival", "phaseAlternate": "closing",
  "energy": 4, "bpm": 88, "danceability": 0.32,
  "isBanger": false, "isSingalong": true, "isEmotional": true,
  "isCaliente": false, "isHardcore": false,
  "era": "90s", "mood": "emotional", "language": "FR",
  "hasLyrics": true, "explicit": false,
  "notes": "Apéro ou closing émotionnel",
  "justification": "Ballade FR universelle"
}

EXEMPLE 3 - R&B 2000s multi-tag
Track: Single Ladies — Beyoncé
{
  "genreBDD": "R&B", "uiCategoryPrimary": "Old school",
  "uiCategoriesSecondary": ["Dance", "Urban Groove"],
  "phase": "party", "phaseAlternate": "groove",
  "energy": 9, "bpm": 97, "danceability": 0.85,
  "isBanger": true, "isSingalong": true, "isEmotional": false,
  "isCaliente": false, "isHardcore": false,
  "era": "2000s", "mood": "fun", "language": "EN",
  "hasLyrics": true, "explicit": false,
  "notes": "Hit transversal",
  "justification": "Banger 2000s multi-vibe"
}

EXEMPLE 4 - House banger moderne
Track: Levels — Avicii
{
  "genreBDD": "House", "uiCategoryPrimary": "Dance",
  "uiCategoriesSecondary": ["Électro"],
  "phase": "party", "phaseAlternate": "groove",
  "energy": 9, "bpm": 126, "danceability": 0.95,
  "isBanger": true, "isSingalong": false, "isEmotional": false,
  "isCaliente": false, "isHardcore": false,
  "era": "2010s", "mood": "fun", "language": "EN",
  "hasLyrics": true, "explicit": false,
  "notes": "Hymne dancefloor 2010s",
  "justification": "Banger House mainstream"
}

EXEMPLE 5 - Soul/Pop lounge pour arrival
Track: Smooth Operator — Sade
{
  "genreBDD": "Soul", "uiCategoryPrimary": "Chill",
  "uiCategoriesSecondary": [],
  "phase": "arrival", "phaseAlternate": "ambiance",
  "energy": 4, "bpm": 86, "danceability": 0.55,
  "isBanger": false, "isSingalong": false, "isEmotional": false,
  "isCaliente": false, "isHardcore": false,
  "era": "80s", "mood": "chill", "language": "EN",
  "hasLyrics": true, "explicit": false,
  "notes": "Apéro classy",
  "justification": "Soul/Pop 80s lounge"
}

EXEMPLE 6 - Cas isHardcore (à blacklister soirée privée)
Track: Dragonborn — Headhunterz
{
  "genreBDD": "Electro", "uiCategoryPrimary": "Électro",
  "uiCategoriesSecondary": [],
  "phase": "party", "phaseAlternate": null,
  "energy": 10, "bpm": 150, "danceability": 0.4,
  "isBanger": false, "isSingalong": false, "isEmotional": false,
  "isCaliente": false, "isHardcore": true,
  "era": "2010s", "mood": "aggressive", "language": "EN",
  "hasLyrics": true, "explicit": false,
  "notes": "Hardstyle agressif — inadapté soirée privée familiale, public 25-65 ans",
  "justification": "Hardstyle club underground"
}

AVANT DE RÉPONDRE - AUTO-CHECK OBLIGATOIRE
Pour chaque track classifiée, vérifie SILENCIEUSEMENT :
1. phase cohérente avec energy et BPM
2. phaseAlternate adjacente à phase
3. uiCategoriesSecondary n'inclut PAS uiCategoryPrimary
4. uiCategoriesSecondary contient max 2 éléments
5. uiCategoryPrimary et uiCategoriesSecondary ne sont QUE parmi les 9 valeurs autorisées
6. Si isBanger=true, phase ∈ [groove, party]
7. Si isHardcore=true, phase ∉ [arrival, closing] et notes explique pourquoi
8. era cohérent avec l'artiste

Si tu trouves une incohérence, AJUSTE avant de finaliser.

INSTRUCTIONS FINALES
- Si tu hésites, propose ton meilleur guess
- Si track inconnue : devine à partir du titre/artiste/BPM/genre historique
- Réponds STRICTEMENT en JSON, SANS markdown, SANS préambule, SANS commentaire en dehors du JSON

FORMAT DE SORTIE STRICT
Tu DOIS retourner un objet JSON avec une seule clé "classifications" contenant un array des ${batchTracks.length} objets dans l'ordre des tracks fournies. Chaque objet DOIT avoir TOUS les champs listés (id de la track + 20 champs de classification).`;

    const expected_output_format = {
      "classifications": [
        {
          "id": "12345",
          "genreBDD": "COCOVARIET",
          "uiCategoryPrimary": "Pop",
          "uiCategoriesSecondary": ["Dance"],
          "phase": "ambiance",
          "phaseAlternate": "takeoff",
          "energy": 6,
          "bpm": 120,
          "era": "2010s",
          "mood": "fun",
          "language": "FR",
          "danceability": 0.7,
          "isBanger": false,
          "isSingalong": true,
          "isEmotional": false,
          "isCaliente": false,
          "isHardcore": false,
          "hasLyrics": true,
          "explicit": false,
          "notes": "Variété FR moderne dansante",
          "justification": "COCOVARIET grand public, parfait apéro"
        }
      ]
    };

    const batchData = {
      batch_id: batchId,
      generated_at: new Date().toISOString(),
      tracks_count: batchTracks.length,
      instructions_for_claude: instructions,
      tracks_to_classify: formattedTracks,
      expected_output_format
    };

    fs.writeFileSync(path.join(IN_DIR, `${batchId}.json`), JSON.stringify(batchData, null, 2));
  }

  console.log(`[generate] ${totalBatches} fichiers créés dans batches_in/`);
  console.log(`[generate] Tracks couvertes : ${tracks.length} (top hits sans phase)`);

  process.exit(0);
}

run().catch(err => {
  console.error("Erreur:", err);
  process.exit(1);
});
