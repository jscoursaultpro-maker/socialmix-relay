/**
 * generate_chatgpt_batches_partielle.mjs
 * Génère des batches de 20 pour les tracks "partielle"
 * Numérotation continue après les existants (030+)
 */
import mongoose from 'mongoose';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI manquant'); process.exit(1); }

await mongoose.connect(MONGO_URI);
const Track = (await import('./models/Track.js')).default;

const tracks = await Track.find({ qualityLevel: 'partielle' }).sort({ deezerRank: -1 }).lean();
console.log(`📦 ${tracks.length} tracks partielles\n`);

const BATCH_SIZE = 20;
const outDir = join(__dirname, 'batches_chatgpt');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const START_NUM = 30;
const batches = [];
for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
  batches.push(tracks.slice(i, i + BATCH_SIZE));
}

console.log(`📋 ${batches.length} batches de ${BATCH_SIZE}\n`);

for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  const num = String(START_NUM + b).padStart(3, '0');
  const filename = `batch_chatgpt_${num}.json`;

  const payload = {
    _instruction: `Tu es un DJ professionnel expert. CLASSIFIE les ${batch.length} tracks ci-dessous dans "tracks_a_classer".

Ces tracks sont PARTIELLES — elles ont BPM et energy mais il manque souvent phase, uiCategoryPrimary, etc. COMPLÈTE tous les champs.

RÉPONSE ATTENDUE : Un FICHIER TÉLÉCHARGEABLE nommé "${`batch_chatgpt_${num}_done.json`}" contenant :
{ "classifications": [ ...${batch.length} objets... ] }

PHASES (6 valeurs) :
arrival (BPM 70-110, energy 3.5-5), ambiance (BPM 80-115, energy 5-6.5), takeoff (BPM 100-125, energy 6.5-7.5), groove (BPM 115-130, energy 7.5-8.5), peak (BPM 120-135, energy 8.5-10), closing (BPM 90-115, energy 4.5-6)

UI CATEGORIES (9 valeurs pour uiCategoryPrimary) :
Chill, Pop, Rock, Rap, Latin, Old school, Urban Groove, Dance, Électro

RÈGLES :
1. uiCategoriesSecondary (0-2 catégories) NE CONTIENT JAMAIS uiCategoryPrimary
2. phaseAlternate = phase adjacente (arrival↔ambiance, ambiance↔takeoff, takeoff↔groove, groove↔peak, peak↔closing)
3. isBanger=true → phase DOIT être groove ou peak
4. energy ≤ 4 → JAMAIS groove/peak
5. Danceability entre 0.0 et 1.0
6. CONSERVE l'id EXACTEMENT tel quel (nombre ou chaîne hex 24 chars)`,

    _format_reponse: {
      id: "<copie exacte>", genreBDD: "<genre>", uiCategoryPrimary: "<UI cat>",
      uiCategoriesSecondary: [], phase: "<phase>", phaseAlternate: "<phase adj>",
      energy: "<1-10>", bpm: "<60-220>", danceability: "<0.0-1.0>",
      isBanger: false, isSingalong: false, isEmotional: false, isCaliente: false, isHardcore: false,
      era: "<decade>", mood: "<fun/emotional/aggressive/chill>", language: "<FR/EN/ES/PT>",
      hasLyrics: true, explicit: false, notes: "", justification: ""
    },

    _output_filename: `batch_chatgpt_${num}_done.json`,

    tracks_a_classer: batch.map((t, i) => {
      const did = (t.providers?.deezer?.trackId && t.providers.deezer.trackId > 0)
        ? String(t.providers.deezer.trackId)
        : t._id.toString();
      const artistName = typeof t.artist === 'object' ? t.artist.name : t.artist;
      return {
        index: i + 1, id: did, title: t.title, artist: artistName,
        genre_actuel: t.genre || t.genreBDD || '?',
        bpm_actuel: t.bpm || '?', energy_actuel: t.energy || '?',
        phase_actuelle: t.phase || 'MANQUANT',
        uiCat_actuel: t.uiCategoryPrimary || 'MANQUANT',
        deezerRank: t.deezerRank || 0
      };
    })
  };

  writeFileSync(join(outDir, filename), JSON.stringify(payload, null, 2));
  const missing = batch.filter(t => !t.uiCategoryPrimary).length;
  const missingPhase = batch.filter(t => !t.phase).length;
  console.log(`  ✅ ${filename} — ${batch.length} tracks (${missing} sans uiCat, ${missingPhase} sans phase)`);
}

console.log(`\n🎉 ${batches.length} batches : ${String(START_NUM).padStart(3,'0')} → ${String(START_NUM + batches.length - 1).padStart(3,'0')}`);
await mongoose.disconnect();
