/**
 * generate_chatgpt_batches.mjs
 * Génère des fichiers JSON à glisser dans ChatGPT pour reclassifier
 * les 230 tracks mal classifiées par heuristiques locales.
 * Lots de 20 tracks chacun.
 * 
 * FORMAT : fichier auto-suffisant — glisser dans ChatGPT + Enter = ça marche
 */
import mongoose from 'mongoose';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI manquant'); process.exit(1); }

await mongoose.connect(MONGO_URI);
const Track = (await import('./models/Track.js')).default;
console.log('✅ MongoDB connecté');

// Cibler les tracks classifiées par heuristiques
const targets = await Track.find({
  adminQualified: true,
  notes: /Classifié localement via heuristics/
}).sort({ deezerRank: -1 }).lean();

// Aussi ajouter les 2 tracks fixées manuellement
const manualFixes = await Track.find({
  adminQualified: true,
  notes: /Classifié manuellement via Antigravity/
}).lean();

const allTargets = [...targets, ...manualFixes];
console.log(`📦 ${allTargets.length} tracks à reclassifier`);

const BATCH_SIZE = 20;
const totalBatches = Math.ceil(allTargets.length / BATCH_SIZE);

const outDir = join(__dirname, 'batches_chatgpt');
if (!existsSync(outDir)) mkdirSync(outDir);

for (let b = 0; b < totalBatches; b++) {
  const batch = allTargets.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
  const batchNum = String(b + 1).padStart(3, '0');
  
  const batchFile = {
    _instruction: `INSTRUCTION : Tu es un DJ professionnel expert. Classe les ${batch.length} tracks listées ci-dessous selon les règles décrites. Génère ta réponse sous forme d'un FICHIER TÉLÉCHARGEABLE nommé "batch_chatgpt_${batchNum}_done.json". Le fichier doit contenir exactement : { "classifications": [ ...tes ${batch.length} objets JSON... ] }. Ne mets RIEN dans la conversation, génère UNIQUEMENT le fichier.`,
    
    _contexte_soiree: "40-80 invités | 6-7h de soirée (20h-2h30) | Public mixte 25-65 ans | Soirées privées (anniversaires, mariages, fêtes amis)",
    
    _phases: {
      "arrival": "🌅 Apéro chic — energy 3.5-5.0, BPM 70-110 — Ex: Sade, Norah Jones, Goldman, Cabrel",
      "ambiance": "🥂 Warm-up — energy 5.0-6.5, BPM 80-115 — Ex: Sheeran, EWF mid-tempo, Marvin Gaye",
      "takeoff": "🚀 La montée — energy 6.5-7.5, BPM 100-125 — Ex: Donna Summer, Kool & The Gang, Drake",
      "groove": "💃 Vraiment lancé — energy 7.5-8.5, BPM 115-130 — Ex: Calvin Harris, Sister Sledge, Bruno Mars",
      "party": "🔥 Peak time — energy 8.5-10, BPM 120-135 — Ex: Avicii, Guetta, Justice, Sapés Comme Jamais",
      "closing": "🌙 Descente émotionnelle — energy 4.5-6.0, BPM 90-115 — Ex: Bill Withers, Soul slow"
    },
    
    _genres_bdd: ["Chill", "Pop", "COCOVARIET", "Rock", "Hip-Hop", "R&B", "Latin", "Afro", "Disco", "House", "Electro"],
    _ui_categories: ["Chill", "Pop", "Rock", "Rap", "Latin", "Old school", "Urban Groove", "Dance", "Électro"],
    
    _format_reponse: {
      "id": "<conserver tel quel depuis tracks_a_classer>",
      "genreBDD": "<genre parmi _genres_bdd>",
      "uiCategoryPrimary": "<catégorie parmi _ui_categories>",
      "uiCategoriesSecondary": ["<0-2 catégories, JAMAIS = primary>"],
      "phase": "<arrival/ambiance/takeoff/groove/party/closing>",
      "phaseAlternate": "<phase adjacente à phase>",
      "energy": "<1-10>",
      "bpm": "<60-220>",
      "danceability": "<0.0-1.0>",
      "isBanger": "<true/false — true uniquement si groove ou party>",
      "isSingalong": "<true/false>",
      "isEmotional": "<true/false>",
      "isCaliente": "<true/false>",
      "isHardcore": "<true/false>",
      "era": "<50s/60s/70s/80s/90s/2000s/2010s/2020s>",
      "mood": "<fun/emotional/aggressive/chill>",
      "language": "<FR/EN/ES/PT/instrumental/autre>",
      "hasLyrics": "<true/false>",
      "explicit": "<true/false>",
      "notes": "<note DJ courte>",
      "justification": "<1 ligne>"
    },
    
    _regles_coherence: [
      "phaseAlternate DOIT être adjacente à phase",
      "uiCategoriesSecondary NE CONTIENT JAMAIS uiCategoryPrimary",
      "BPM < 100 → PAS en party",
      "energy <= 4 → PAS en groove/party",
      "isBanger=true → phase groove ou party uniquement",
      "era cohérent avec artiste"
    ],
    
    tracks_a_classer: batch.map((t, i) => ({
      index: i + 1,
      id: t.providers?.deezer?.trackId || t._id.toString(),
      title: t.title,
      artist: typeof t.artist === 'object' ? t.artist.name : t.artist,
      genre: t.genre,
      bpm: t.bpm,
      energy: t.energy,
      deezerRank: t.deezerRank || 0
    }))
  };

  const filePath = join(outDir, `batch_chatgpt_${batchNum}.json`);
  writeFileSync(filePath, JSON.stringify(batchFile, null, 2));
  console.log(`📄 Batch ${b + 1}/${totalBatches} → ${filePath} (${batch.length} tracks)`);
}

console.log(`\n✅ ${totalBatches} fichiers générés dans ${outDir}/`);
console.log(`📋 Workflow : Glisse le fichier dans ChatGPT → Enter → Télécharge le fichier _done.json → Place dans batches_out/`);

await mongoose.disconnect();
