/**
 * generate_chatgpt_batches_complete.mjs
 * Génère des batches de 20 tracks pour compléter les tracks "complete" 
 * qui manquent de uiCategoryPrimary, uiCategoriesSecondary, phase, etc.
 * Même format self-contained que generate_chatgpt_batches.mjs
 */
import mongoose from 'mongoose';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI manquant'); process.exit(1); }

await mongoose.connect(MONGO_URI);
const Track = (await import('./models/Track.js')).default;

// ─── Trouver les complètes avec des trous ───────────────
const tracks = await Track.find({
  qualityLevel: 'complete',
  $or: [
    { uiCategoryPrimary: null }, { uiCategoryPrimary: '' }, { uiCategoryPrimary: { $exists: false } },
    { uiCategoriesSecondary: null }, { uiCategoriesSecondary: [] },
    { phase: null }, { phase: '' }, { phase: { $exists: false } },
    { phaseAlternate: null }, { phaseAlternate: '' },
    { danceability: null }, { danceability: { $exists: false } },
  ]
}).sort({ deezerRank: -1 }).lean();

console.log(`📦 ${tracks.length} tracks complètes avec champs manquants\n`);

if (tracks.length === 0) {
  console.log('✅ Toutes les complètes sont nickel !');
  await mongoose.disconnect();
  process.exit(0);
}

// ─── Batch generation ───────────────────────────────────
const BATCH_SIZE = 20;
const outDir = join(__dirname, 'batches_chatgpt');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Start numbering from 013 (after existing 001-012)
const START_NUM = 13;
const batches = [];
for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
  batches.push(tracks.slice(i, i + BATCH_SIZE));
}

console.log(`📋 ${batches.length} batches de ${BATCH_SIZE} à générer\n`);

for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  const num = String(START_NUM + b).padStart(3, '0');
  const filename = `batch_chatgpt_${num}.json`;

  const payload = {
    _instruction: `Tu es un DJ professionnel expert. CLASSIFIE les ${batch.length} tracks ci-dessous dans "tracks_a_classer".

ATTENTION : Ces tracks ont DÉJÀ certains champs remplis (genre, BPM, energy, phase parfois). Tu dois COMPLÉTER les champs manquants et VÉRIFIER la cohérence des champs existants. Si un champ existant te semble incorrect, corrige-le.

RÉPONSE ATTENDUE : Un FICHIER TÉLÉCHARGEABLE nommé "${`batch_chatgpt_${num}_done.json`}" contenant :
{ "classifications": [ ...${batch.length} objets... ] }

PHASES (6 valeurs, dans l'ordre d'une soirée 20h→2h30) :
- arrival : apéro chic, BPM 70-110, energy 3.5-5
- ambiance : warm-up, BPM 80-115, energy 5-6.5
- takeoff : montée, BPM 100-125, energy 6.5-7.5
- groove : lancé, BPM 115-130, energy 7.5-8.5
- peak : peak time, BPM 120-135, energy 8.5-10
- closing : descente émotionnelle, BPM 90-115, energy 4.5-6

UI CATEGORIES (9 valeurs pour uiCategoryPrimary) :
Chill, Pop, Rock, Rap, Latin, Old school, Urban Groove, Dance, Électro

RÈGLES :
1. uiCategoriesSecondary (0-2 catégories) NE CONTIENT JAMAIS uiCategoryPrimary
2. phaseAlternate = phase adjacente (arrival↔ambiance, ambiance↔takeoff, takeoff↔groove, groove↔peak, peak↔closing)
3. isBanger=true → phase DOIT être groove ou peak
4. energy ≤ 4 → JAMAIS groove/peak
5. Danceability entre 0.0 et 1.0

CONSERVE l'id EXACTEMENT tel quel (Deezer ID numérique ou ObjectId MongoDB string).`,

    _format_reponse: {
      id: "<copie exacte de l'id fourni>",
      genreBDD: "<genre parmi: Chill/Pop/Rock/Hip-Hop/R&B/Latin/Afro/Disco/House/Electro/COCOVARIET>",
      uiCategoryPrimary: "<parmi les 9 UI categories>",
      uiCategoriesSecondary: ["<0 à 2 catégories, jamais = uiCategoryPrimary>"],
      phase: "<arrival/ambiance/takeoff/groove/peak/closing>",
      phaseAlternate: "<phase adjacente>",
      energy: "<entier 1-10>",
      bpm: "<entier 60-220>",
      danceability: "<float 0.0-1.0>",
      isBanger: "<true/false>",
      isSingalong: "<true/false>",
      isEmotional: "<true/false>",
      isCaliente: "<true/false>",
      isHardcore: "<true/false>",
      era: "<50s/60s/70s/80s/90s/2000s/2010s/2020s>",
      mood: "<fun/emotional/aggressive/chill>",
      language: "<FR/EN/ES/PT/autre>",
      hasLyrics: "<true/false>",
      explicit: "<true/false>",
      notes: "<note DJ courte>",
      justification: "<1 ligne>"
    },

    _output_filename: `batch_chatgpt_${num}_done.json`,

    tracks_a_classer: batch.map((t, i) => {
      const did = (t.providers?.deezer?.trackId && t.providers.deezer.trackId > 0) 
        ? String(t.providers.deezer.trackId) 
        : t._id.toString();
      const artistName = typeof t.artist === 'object' ? t.artist.name : t.artist;
      return {
        index: i + 1,
        id: did,
        title: t.title,
        artist: artistName,
        genre_actuel: t.genre || t.genreBDD || '?',
        bpm_actuel: t.bpm || '?',
        energy_actuel: t.energy || '?',
        phase_actuelle: t.phase || '?',
        uiCat_actuel: t.uiCategoryPrimary || 'MANQUANT',
        uiSec_actuel: (t.uiCategoriesSecondary || []).join(', ') || 'MANQUANT',
        deezerRank: t.deezerRank || 0
      };
    })
  };

  const filepath = join(outDir, filename);
  writeFileSync(filepath, JSON.stringify(payload, null, 2));
  
  const missing = batch.filter(t => !t.uiCategoryPrimary).length;
  const missingPhase = batch.filter(t => !t.phase).length;
  console.log(`  ✅ ${filename} — ${batch.length} tracks (${missing} sans uiCat, ${missingPhase} sans phase)`);
}

console.log(`\n🎉 ${batches.length} batches générés dans batches_chatgpt/`);
console.log(`   Numéros: ${String(START_NUM).padStart(3,'0')} → ${String(START_NUM + batches.length - 1).padStart(3,'0')}`);

await mongoose.disconnect();
