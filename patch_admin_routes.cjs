const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

// The whole admin section
const startStr = "// GET /api/monitor/tracks — liste paginée avec filtres";
const endStr = "// GET /api/monitor/export — télécharge curated_base_v3.json depuis le serveur";

if (!server.includes(startStr) || !server.includes(endStr)) {
  console.log("Could not find delimiters");
  process.exit(1);
}

const before = server.substring(0, server.indexOf(startStr));
const after = server.substring(server.indexOf(endStr));

const newRoutes = `// GET /api/monitor/tracks — liste paginée avec filtres
app.get('/api/monitor/tracks', adminAuth, async (req, res) => {
  try {
    const filter = req.query.filter || 'needs_review';
    const genre = req.query.genre || '';
    const search = req.query.search || '';
    const phase = req.query.phase || '';
    const sort = req.query.sort || 'default';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    let query = {};
    if (filter === 'needs_review') query.needs_review = true;
    if (filter === 'unlabeled') query.isLabeled = { $ne: true };
    if (filter === 'no_bpm') query.$or = [{ bpm: null }, { bpm: 0 }];
    if (filter === 'no_energy') query.$or = [{ energy: null }, { energy: 0 }];
    if (filter === 'incomplete') query.$or = [{ bpm: null }, { bpm: 0 }, { energy: null }, { energy: 0 }];

    if (phase && phase !== 'all') {
      if (phase === 'unclassified') query.phase = null;
      else query.phase = phase;
    }
    
    if (genre && genre !== 'all') {
      query.genre = genre;
    }

    if (search) {
      const q = search.toLowerCase();
      query.$or = [
        { title: new RegExp(q, 'i') },
        { artist: new RegExp(q, 'i') }
      ];
    }

    let sortObj = {};
    if (sort === 'bpm_asc') sortObj.bpm = 1;
    else if (sort === 'bpm_desc') sortObj.bpm = -1;
    else if (sort === 'energy_asc') sortObj.energy = 1;
    else if (sort === 'energy_desc') sortObj.energy = -1;
    else if (sort === 'rank_desc') sortObj.deezerRank = -1;
    else if (sort === 'rank_asc') sortObj.deezerRank = 1;
    else sortObj.deezerRank = -1; // Default

    const tracks = await Track.find(query).sort(sortObj).skip((page - 1) * limit).limit(limit).lean();
    const total = await Track.countDocuments(query);

    // Map to JSON structure expected by UI
    const mapped = tracks.map(t => ({
      _id: t._id.toString(),
      deezerID: t.deezerID || 0,
      title: t.title,
      artist: t.artist,
      bpm: t.bpm,
      genre: t.genreBDD || t.genre,
      phase: t.phase,
      energy: t.energy,
      danceability: t.danceability,
      needs_review: t.needs_review,
      is_labeled: t.isLabeled,
      gpt_suggestion: t.gptSuggestion
    }));

    res.json({
      tracks: mapped,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/monitor/track/:id — un track par ID
app.get('/api/monitor/track/:id', adminAuth, async (req, res) => {
  try {
    const id = req.params.id;
    let query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { deezerID: Number(id) };
    const t = await Track.findOne(query).lean();
    if (!t) return res.status(404).json({ error: "Track not found" });
    
    res.json({
      ...t,
      id: t.deezerID || t._id.toString(),
      is_labeled: t.isLabeled,
      gpt_suggestion: t.gptSuggestion
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/monitor/track/:id — sauvegarder les modifications
app.patch('/api/monitor/track/:id', adminAuth, async (req, res) => {
  try {
    const id = req.params.id;
    let query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { deezerID: Number(id) };
    const t = await Track.findOne(query);
    if (!t) return res.status(404).json({ error: "Track not found" });

    const body = req.body;
    if (body.genre !== undefined) t.genreBDD = body.genre;
    if (body.phase !== undefined) t.phase = body.phase;
    if (body.energy !== undefined) t.energy = Math.min(10, Math.max(1, Number(body.energy)));
    if (body.danceability !== undefined) t.danceability = Math.min(1, Math.max(0, Number(body.danceability)));
    if (body.needs_review !== undefined) t.needs_review = Boolean(body.needs_review);
    
    t.isLabeled = body.is_labeled !== undefined ? Boolean(body.is_labeled) : true;
    
    if (t.isLabeled) {
      t.gptSuggestion = null;
      t.chatgptQueueId = null;
    }
    
    if (body.bpm !== undefined && body.bpm > 0) t.bpm = Number(body.bpm);
    
    t.lastReviewedAt = new Date();

    await t.save();
    res.json(t);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/import-gpt
app.post('/api/admin/import-gpt', adminAuth, async (req, res) => {
  try {
    const arr = req.body.tracks;
    if (!Array.isArray(arr)) return res.status(400).json({ error: "Invalid array" });

    let updated = 0;
    const queueId = 'gpt_' + Date.now();
    
    for (const up of arr) {
      const id = up.id || up.deezerID;
      if (!id) continue;
      
      let query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { deezerID: Number(id) };
      const track = await Track.findOne(query);
      
      if (track) {
        track.gptSuggestion = {
          genreBDD: up.genreBDD || null,
          uiCategoryPrimary: up.uiCategoryPrimary || null,
          uiCategoriesSecondary: up.uiCategoriesSecondary || [],
          phase: up.phase || null,
          phaseAlternate: up.phaseAlternate || null,
          energy: up.energy ? Math.min(10, Math.max(1, Number(up.energy))) : null,
          bpm: up.bpm || null,
          danceability: up.danceability ? Math.min(10, Math.max(1, Number(up.danceability))) : null,
          isBanger: up.isBanger || false,
          isSingalong: up.isSingalong || false,
          isEmotional: up.isEmotional || false,
          isCaliente: up.isCaliente || false,
          era: up.era || null,
          mood: up.mood || null,
          language: up.language || null,
          hasLyrics: up.hasLyrics || false,
          explicit: up.explicit || false,
          notes: up.notes || null,
          justification: up.justification || null
        };
        track.isLabeled = false;
        track.needs_review = true;
        track.chatgptQueueId = queueId;
        await track.save();
        updated++;
      }
    }

    res.json({ success: true, updated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/generate-prompt
app.get('/api/admin/generate-prompt', adminAuth, async (req, res) => {
  try {
    const count = parseInt(req.query.count) || 50;
    const wave = req.query.wave || 'V1';
    
    const targets = await Track.find({
      isLabeled: { $ne: true },
      gptSuggestion: null,
      $or: [{ energy: null }, { energy: 0 }]
    }).sort({ deezerRank: -1 }).limit(count).lean();

    if (targets.length === 0) {
      return res.json({ prompt: null, message: "Aucun titre à traiter !" });
    }

    let prompt = \`Tu es un DJ professionnel expert qui aide à classer des tracks pour l'app SocialMix, qui pilote des soirées privées en temps réel.

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
      prompt += \`\${i+1}. ID \${did} | "\${t.title}" — \${artistName} | BPM:\${t.bpm || '?'} | genreBDD historique: \${t.genreBDD || t.genre || '?'} | phase historique: \${t.phase || t._legacyPhase || '?'} | rank: \${t.deezerRank || '?'}\\n\`;
    });
    
    prompt += \`\\nRÉPONSE ATTENDUE :\\nArray JSON de \${targets.length} objets, dans l'ordre des tracks.\`;

    res.json({ prompt, count: targets.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/monitor/live-stats
app.get('/api/monitor/live-stats', adminAuth, async (req, res) => {
  try {
    const total = await Track.countDocuments({});
    
    const byQuality = {
      complete: await Track.countDocuments({ qualityLevel: 'complete' }),
      platine: await Track.countDocuments({ qualityLevel: 'platine' }),
      partielle: await Track.countDocuments({ qualityLevel: 'partielle' }),
      vide: await Track.countDocuments({ qualityLevel: 'vide' })
    };
    
    const startOfDay = new Date();
    startOfDay.setHours(0,0,0,0);
    
    const todayComplete = await Track.countDocuments({ lastReviewedAt: { $gte: startOfDay }, qualityLevel: 'complete' });
    const todayPlatine = await Track.countDocuments({ lastReviewedAt: { $gte: startOfDay }, qualityLevel: 'platine' });
    const sessionClassified = await Track.countDocuments({ lastReviewedAt: { $gte: startOfDay } });
    
    let speedPerMin = 0;
    const firstReviewedToday = await Track.findOne({ lastReviewedAt: { $gte: startOfDay } }).sort({ lastReviewedAt: 1 }).lean();
    if (firstReviewedToday && sessionClassified > 0) {
      const minSinceStart = Math.max(1, Math.round((new Date() - firstReviewedToday.lastReviewedAt) / 60000));
      speedPerMin = Math.round(sessionClassified / minSinceStart);
    }
    
    if (speedPerMin === 0 && (todayComplete + todayPlatine) > 0) speedPerMin = 2;
    
    const remaining = (byQuality.vide || 0) + (byQuality.partielle || 0);
    const etaMinutes = speedPerMin > 0 ? Math.round(remaining / speedPerMin) : 0;
    
    const chatgptQueue = await Track.countDocuments({ chatgptQueueId: { $ne: null } });
    
    res.json({
      total,
      byQuality,
      today: { complete: todayComplete, platine: todayPlatine },
      speedPerMin,
      etaMinutes,
      chatgptQueue
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

`;

server = before + newRoutes + after;
fs.writeFileSync('server.js', server);
console.log("Patched server.js admin routes successfully");
