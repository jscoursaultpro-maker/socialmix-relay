const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');

// 1. Generate prompt
const oldPromptFunc = server.substring(
  server.indexOf("let prompt = `Tu es un DJ professionnel expert"),
  server.indexOf("res.json({ prompt, count: targets.length });")
);

const newPrompt = `let prompt = \`Tu es un DJ professionnel expert qui aide à classer des tracks pour l'app SocialMix, qui pilote des soirées privées en temps réel.

CONTEXTE SOIRÉE TYPE
- 40-80 invités | 6h à 7h de soirée (20h-2h30 type)
- Public mixte, souvent 25-65 ans
- Soirées privées (anniversaires, mariages, fêtes amis)
- Forte demande de COCOVARIET (chanson française populaire qui se chante : Goldman, Maître Gims, Aya Nakamura, Stromae, Sardou, Cabrel, Souchon, Indila)
- Arrivals tendres et closings émotionnels sont des moments importants

DESCRIPTION DES 6 PHASES (utilise pour calibrer)
🌅 ARRIVAL (apéro chic, energy 3.5-5.0, BPM 70-110)
   Exemples : Sade "Smooth Operator", Norah Jones, Goldman "Encore un matin", Cabrel "Petite Marie", Bossa, Lounge, Soul slow.
   À éviter : House, Electro hard, Rap hardcore

🥂 AMBIANCE (warm-up, energy 5.0-6.5, BPM 80-115)
   Exemples : Pop douce (Sheeran), Disco classics mid-tempo (EWF), R&B old (Marvin Gaye), COCOVARIET (Souchon, Goldman dansants).
   À éviter : House peak, Electro hard

🚀 TAKEOFF (la montée, energy 6.5-7.5, BPM 100-125)
   Exemples : Disco (Donna Summer), Funk (Kool & The Gang), COCOVARIET dansants, Hip-Hop modéré (Drake).

💃 GROOVE (vraiment lancé, energy 7.5-8.5, BPM 115-130)
   Exemples : House mainstream (Calvin Harris), Disco upbeat (Sister Sledge), Pop dance (Bruno Mars), Latin (Shakira).

🔥 PARTY (peak time, energy 8.5-10, BPM 120-135)
   Exemples : House peak (Avicii, Guetta), Electro (Justice), hymnes (Sapés Comme Jamais, Single Ladies, Dancing Queen), bangers Hip-Hop.

🌙 CLOSING (descente émotionnelle, energy 4.5-6.0, BPM 90-115)
   Exemples : Disco classics fin, Soul slow (Bill Withers), COCOVARIET émotionnels (Goldman "Là-bas", Sardou "Le France").

DISTINCTIONS GENRES BDD
- Chill : ambient, lo-fi, acoustic doux (Norah Jones)
- Soul : classics 60s-70s (Marvin Gaye, Aretha)
- Pop : mainstream international (Lady Gaga, Sheeran)
- COCOVARIET : chanson FR populaire (Goldman, Maître Gims, Aya, Stromae, Sardou, Cabrel, Indila, Calogero)
- Rock : classic + indie + pop-rock (Foo Fighters, Oasis)
- Hip-Hop : Rap US + FR + Trap (Drake, Kendrick, PNL, Booba)
- R&B : moderne dansant (Beyoncé) ou groove 90s/2000s (TLC)
- Latin : pop latin, salsa, bachata (Shakira, Bad Bunny)
- Afro : Afrobeat (Burna Boy), Afro House
- Disco : Disco 70s pur (Donna Summer, Bee Gees, EWF)
- Funk : Funk classic + Nu-Funk (Kool & Gang, Bruno Mars)
- House : Deep, Vocal, Tech, Funky House (Avicii, Guetta)
- Electro : EDM, Big Room, Synthwave (Daft Punk, Justice)

FORMAT JSON STRICT
{
  "id": "<string> (l'ID retourné peut être un entier deezerID ou un string MongoDB ObjectId. Conserve-le tel quel en sortie)",
  "genreBDD": "<un parmi : Chill / Soul / Pop / COCOVARIET / Rock / Hip-Hop / R&B / Latin / Afro / Disco / Funk / House / Electro>",
  "uiCategoryPrimary": "<un parmi : Chill / Pop / Rock / Rap / Latin / Old school / Urban Groove / Dance / Électro>",
  "uiCategoriesSecondary": [<0 à 2 catégories UI additionnelles, ne contenant JAMAIS uiCategoryPrimary>],
  "phase": "<arrival / ambiance / takeoff / groove / party / closing>",
  "phaseAlternate": "<phase adjacente ou null>",
  "energy": <entier 1-10>,
  "bpm": <entier 60-220, devine si manquant>,
  "danceability": <float 0.0-1.0>,
  "isBanger": <true si hymne qui fait monter la salle, false>,
  "isSingalong": <true si refrain repris en chœur, false>,
  "isEmotional": <true si émouvant/larme à l'œil, false>,
  "isCaliente": <true si chaleur latine/salsa/reggaeton hot, false>,
  "era": "<50s / 60s / 70s / 80s / 90s / 2000s / 2010s / 2020s>",
  "mood": "<fun / emotional / aggressive / chill>",
  "language": "<FR / EN / ES / PT / autre>",
  "hasLyrics": <true/false>,
  "explicit": <true/false>,
  "notes": "<note DJ courte ou ''>",
  "justification": "<1 ligne expliquant tes choix>"
}

RÈGLES DE COHÉRENCE STRICTES (auto-vérifier avant réponse)
1. uiCategoriesSecondary NE CONTIENT JAMAIS uiCategoryPrimary
2. phaseAlternate adjacente : arrival↔ambiance, ambiance↔takeoff, takeoff↔groove, groove↔party, party↔closing
3. Track BPM 80 ne peut PAS être en party (party = 120-135 min)
4. Track energy <= 4 ne peut PAS être en groove/party
5. isBanger=true → phase IMPÉRATIVEMENT groove ou party
6. COCOVARIET tendre (Goldman ballade) → JAMAIS party
7. Hip-Hop hardcore moderne (Booba, NLE Choppa) → JAMAIS arrival
8. era cohérent avec artiste (Daft Punk = 90s-2010s pas 70s)

CALIBRATION — 5 EXEMPLES VARIÉS

EXEMPLE 1 - Banger FR dansant
Track : Sapés Comme Jamais — Maître Gims
{
  "genreBDD": "COCOVARIET", "uiCategoryPrimary": "Dance",
  "uiCategoriesSecondary": ["Rap", "Pop"], "phase": "party",
  "phaseAlternate": "groove", "energy": 9, "bpm": 115,
  "danceability": 0.92, "isBanger": true, "isSingalong": true,
  "isEmotional": false, "isCaliente": false, "era": "2010s",
  "mood": "fun", "language": "FR", "hasLyrics": true,
  "explicit": false, "notes": "Banger universel public FR",
  "justification": "Hit FR moderne, fait chanter et danser"
}

EXEMPLE 2 - Ballade COCOVARIET tendre
Track : Encore un matin — Goldman
{
  "genreBDD": "COCOVARIET", "uiCategoryPrimary": "Pop",
  "uiCategoriesSecondary": [], "phase": "arrival",
  "phaseAlternate": "closing", "energy": 4, "bpm": 88,
  "danceability": 0.32, "isBanger": false, "isSingalong": true,
  "isEmotional": true, "isCaliente": false, "era": "90s",
  "mood": "emotional", "language": "FR", "hasLyrics": true,
  "explicit": false, "notes": "Apéro ou closing émotionnel",
  "justification": "Ballade FR universelle"
}

EXEMPLE 3 - R&B 2000s multi-tag
Track : Single Ladies — Beyoncé
{
  "genreBDD": "R&B", "uiCategoryPrimary": "Old school",
  "uiCategoriesSecondary": ["Dance", "Urban Groove"],
  "phase": "party", "phaseAlternate": "groove", "energy": 9,
  "bpm": 97, "danceability": 0.85, "isBanger": true,
  "isSingalong": true, "isEmotional": false, "isCaliente": false,
  "era": "2000s", "mood": "fun", "language": "EN",
  "hasLyrics": true, "explicit": false,
  "notes": "Hit transversal", 
  "justification": "Banger 2000s classique multi-vibe"
}

EXEMPLE 4 - House banger moderne
Track : Levels — Avicii
{
  "genreBDD": "House", "uiCategoryPrimary": "Dance",
  "uiCategoriesSecondary": ["Électro"], "phase": "party",
  "phaseAlternate": "groove", "energy": 9, "bpm": 126,
  "danceability": 0.95, "isBanger": true, "isSingalong": false,
  "isEmotional": false, "isCaliente": false, "era": "2010s",
  "mood": "fun", "language": "EN", "hasLyrics": true,
  "explicit": false, "notes": "Hymne dancefloor 2010s",
  "justification": "Banger House mainstream"
}

EXEMPLE 5 - Soul/Pop lounge pour arrival
Track : Smooth Operator — Sade
{
  "genreBDD": "Soul", "uiCategoryPrimary": "Chill",
  "uiCategoriesSecondary": [], "phase": "arrival",
  "phaseAlternate": "ambiance", "energy": 4, "bpm": 86,
  "danceability": 0.55, "isBanger": false, "isSingalong": false,
  "isEmotional": false, "isCaliente": false, "era": "80s",
  "mood": "chill", "language": "EN", "hasLyrics": true,
  "explicit": false, "notes": "Apéro classy",
  "justification": "Soul/Pop 80s lounge"
}

AVANT DE RÉPONDRE - AUTO-CHECK OBLIGATOIRE
Pour chaque track classifiée, vérifie SILENCIEUSEMENT :
1. phase cohérente avec energy et BPM
2. phaseAlternate adjacente à phase
3. uiCategoriesSecondary n'inclut PAS uiCategoryPrimary
4. Si isBanger=true, phase ∈ [groove, party]
5. era cohérent avec l'artiste
Si tu trouves une incohérence, AJUSTE avant de finaliser.

INSTRUCTIONS FINALES
- Si tu hésites, propose ton meilleur guess
- Si tu ne connais pas la track : devine à partir du titre/artiste/BPM/genre historique
- Réponds STRICTEMENT en JSON Array, sans markdown, sans préambule

LISTE DES \${targets.length} TRACKS À TRAITER
\`;
    targets.forEach((t, i) => {
      let artistName = typeof t.artist === 'object' ? t.artist.name : t.artist;
      const did = (t.deezerID && t.deezerID > 0) ? t.deezerID : t._id.toString();
      prompt += \`\${i+1}. ID \${did} | "\${t.title}" — \${artistName} | BPM:\${t.bpm || '?'} | genreBDD historique: \${t.genre || '?'} | phase historique: \${t.phase || t._legacyPhase || '?'} | rank: \${t.deezerRank || '?'}\\n\`;
    });
    
    prompt += \`\\nRÉPONSE ATTENDUE :\\nArray JSON de \${targets.length} objets, dans l'ordre des tracks.\`;

    `;

if (oldPromptFunc.length < 50) {
  console.log("Error: could not find oldPromptFunc");
  process.exit(1);
}
server = server.replace(oldPromptFunc, newPrompt);

// 2. ChatgptQueue in import-gpt
const oldImport = `      const updateData = {`;
const newImport = `      const queueId = 'gpt_' + Date.now();
      const updateData = {
        chatgptQueueId: queueId,`;
server = server.replace(oldImport, newImport);

// 3. chatgptQueueId tracking in live-stats
const oldLiveStats = `      etaMinutes,
      phaseProgress
    });`;
const newLiveStats = `      etaMinutes,
      phaseProgress,
      chatgptQueue: await Track.countDocuments({ chatgptQueueId: { $ne: null } })
    });`;
server = server.replace(oldLiveStats, newLiveStats);

// 4. Reset chatgptQueueId on validate
const oldValidate = `    t.needs_review = false;
    t.isLabeled = true;`;
const newValidate = `    t.needs_review = false;
    t.isLabeled = true;
    t.chatgptQueueId = null;`;
server = server.replace(oldValidate, newValidate);

fs.writeFileSync('server.js', server);
console.log('Patch server.js successful');
