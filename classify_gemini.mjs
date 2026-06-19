/**
 * classify_gemini.mjs
 * 
 * Classifie les tracks SocialMix via Gemini API au lieu de Claude.
 * Cible : tracks adminQualified avec genre/BPM/energy mais SANS phase.
 * 
 * Usage :
 *   MONGO_URI=... GEMINI_API_KEY=... node classify_gemini.mjs [--batch-size 25] [--dry-run]
 */

import mongoose from 'mongoose';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONGO_URI = process.env.MONGO_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!MONGO_URI) { console.error('❌ MONGO_URI manquant'); process.exit(1); }
if (!GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY manquant'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = parseInt(args.find((_, i, a) => a[i - 1] === '--batch-size') || '25');

await mongoose.connect(MONGO_URI);
const Track = (await import('./models/Track.js')).default;
console.log('✅ MongoDB connecté');

// ─── Prompt de classification (même que celui pour Claude) ─────────────────
function buildPrompt(tracks) {
  let prompt = `Tu es un DJ professionnel expert qui aide à classer des tracks pour l'app SocialMix, qui pilote des soirées privées en temps réel.

CONTEXTE SOIRÉE TYPE
- 40-80 invités | 6h à 7h de soirée (20h-2h30 type)
- Public mixte, souvent 25-65 ans
- Soirées privées (anniversaires, mariages, fêtes amis)

DESCRIPTION DES 6 PHASES
🌅 ARRIVAL (apéro chic, energy 3.5-5.0, BPM 70-110)
   Exemples : Sade "Smooth Operator", Norah Jones, Goldman "Encore un matin", Cabrel "Petite Marie"
🥂 AMBIANCE (warm-up, energy 5.0-6.5, BPM 80-115)
   Exemples : Pop douce (Sheeran), Disco classics mid-tempo (EWF), R&B old (Marvin Gaye)
🚀 TAKEOFF (la montée, energy 6.5-7.5, BPM 100-125)
   Exemples : Disco (Donna Summer), Funk (Kool & The Gang), Hip-Hop modéré (Drake)
💃 GROOVE (vraiment lancé, energy 7.5-8.5, BPM 115-130)
   Exemples : House mainstream (Calvin Harris), Disco upbeat (Sister Sledge), Pop dance (Bruno Mars)
🔥 PARTY (peak time, energy 8.5-10, BPM 120-135)
   Exemples : House peak (Avicii, Guetta), Electro (Justice), hymnes (Sapés Comme Jamais)
🌙 CLOSING (descente émotionnelle, energy 4.5-6.0, BPM 90-115)
   Exemples : Disco classics fin, Soul slow (Bill Withers), COCOVARIET émotionnels

GENRES BDD : Chill / Pop / COCOVARIET / Rock / Hip-Hop / R&B / Latin / Afro / Disco / House / Electro
UI CATEGORIES : Chill / Pop / Rock / Rap / Latin / Old school / Urban Groove / Dance / Électro

FORMAT JSON STRICT — Renvoie UNIQUEMENT un JSON Array, sans markdown, sans préambule :
{
  "id": "<conserver tel quel>",
  "genreBDD": "<genre>",
  "uiCategoryPrimary": "<catégorie UI>",
  "uiCategoriesSecondary": [<0-2 catégories, jamais = primary>],
  "phase": "<arrival/ambiance/takeoff/groove/party/closing>",
  "phaseAlternate": "<phase adjacente>",
  "energy": <1-10>,
  "bpm": <60-220>,
  "danceability": <0.0-1.0>,
  "isBanger": <true/false>,
  "isSingalong": <true/false>,
  "isEmotional": <true/false>,
  "isCaliente": <true/false>,
  "isHardcore": <true/false>,
  "era": "<50s-2020s>",
  "mood": "<fun/emotional/aggressive/chill>",
  "language": "<FR/EN/ES/PT/instrumental/autre>",
  "hasLyrics": <true/false>,
  "explicit": <true/false>,
  "notes": "<note DJ courte>",
  "justification": "<1 ligne>"
}

RÈGLES DE COHÉRENCE (auto-vérifier) :
1. phaseAlternate adjacente à phase
2. uiCategoriesSecondary NE CONTIENT JAMAIS uiCategoryPrimary
3. Track BPM < 100 ne peut PAS être en party
4. Track energy <= 4 ne peut PAS être en groove/party
5. isBanger=true → phase groove ou party uniquement
6. era cohérent avec artiste

LISTE DES ${tracks.length} TRACKS À CLASSER :
`;

  tracks.forEach((t, i) => {
    const artistName = typeof t.artist === 'object' ? t.artist.name : t.artist;
    const did = t.providers?.deezer?.trackId || t._id.toString();
    prompt += `${i + 1}. ID ${did} | "${t.title}" — ${artistName} | BPM:${t.bpm || '?'} | genre:${t.genre || '?'} | energy:${t.energy || '?'} | rank:${t.deezerRank || '?'}\n`;
  });

  prompt += `\nRéponds STRICTEMENT en JSON Array de ${tracks.length} objets.`;
  return prompt;
}

// ─── Appel Gemini API ─────────────────────────────────────────────────────
async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 16384,
      responseMimeType: "application/json"
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini: réponse vide');

  // Extraire le JSON Array
  let clean = text.trim();
  // Enlever les blocs markdown si présents
  clean = clean.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
  
  // Trouver le premier [ et le dernier ]
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('Gemini: pas de JSON Array dans la réponse');
  
  return JSON.parse(clean.substring(start, end + 1));
}

// ─── Appliquer les résultats ──────────────────────────────────────────────
const mapPhase = p => p === 'party' ? 'peak' : (p || 'ambiance');

async function applyClassification(classification) {
  const deezerID = parseInt(classification.id, 10);
  const query = isNaN(deezerID) || deezerID === 0
    ? { _id: classification.id }
    : { 'providers.deezer.trackId': deezerID };

  const existing = await Track.findOne(query);
  if (!existing) {
    console.log(`  ❓ Introuvable: ID ${classification.id}`);
    return 'skip';
  }

  const update = {
    phase: mapPhase(classification.phase),
    phaseAlternate: mapPhase(classification.phaseAlternate || ''),
    danceability: typeof classification.danceability === 'number' ? classification.danceability : 0.6,
    isBanger: classification.isBanger || false,
    isSingalong: classification.isSingalong || false,
    isEmotional: classification.isEmotional || false,
    isCaliente: classification.isCaliente || false,
    isHardcore: classification.isHardcore || false,
    hasLyrics: classification.hasLyrics !== false,
    explicit: classification.explicit || false,
    lastReviewedAt: new Date(),
    ...(classification.era && { era: classification.era }),
    ...(classification.mood && { mood: classification.mood }),
    ...(classification.language && { language: classification.language }),
    ...(classification.uiCategoryPrimary && { uiCategoryPrimary: classification.uiCategoryPrimary }),
    ...(classification.uiCategoriesSecondary?.length && { uiCategoriesSecondary: classification.uiCategoriesSecondary }),
    ...(classification.notes && { notes: classification.notes }),
  };

  // Ne pas écraser genre/BPM/energy s'ils existent déjà
  if (!existing.genre || existing.genre === '') update.genre = classification.genreBDD || existing.genre;
  if (!existing.bpm || existing.bpm === 0) update.bpm = classification.bpm || existing.bpm;
  if (!existing.energy || existing.energy === 0) update.energy = classification.energy || existing.energy;

  if (!DRY_RUN) {
    await Track.updateOne({ _id: existing._id }, { $set: update });
  }

  const phaseStr = `${update.phase}${classification.phaseAlternate ? '/' + mapPhase(classification.phaseAlternate) : ''}`;
  const flags = [
    classification.isBanger ? '🔥' : '',
    classification.isSingalong ? '🎤' : '',
    classification.explicit ? '🔞' : '',
  ].filter(Boolean).join('');
  console.log(`  ♻️  [${(classification.genreBDD || '?').padEnd(10)} | ${phaseStr.padEnd(14)}] ${flags} ${existing.title} — ${existing.artist}`);
  return 'ok';
}

// ─── Main ─────────────────────────────────────────────────────────────────
const targets = await Track.find({
  adminQualified: true,
  genre: { $nin: ['', null] },
  bpm: { $gt: 0 },
  energy: { $gt: 0 },
  $or: [{ phase: null }, { phase: '' }, { phase: { $exists: false } }]
}).sort({ deezerRank: -1 }).lean();

console.log(`\n📦 ${targets.length} tracks à classifier (complètes sans phase)`);
if (DRY_RUN) console.log('🔍 MODE DRY-RUN — aucune modification en base\n');

if (targets.length === 0) {
  console.log('✅ Aucune track à traiter !');
  await mongoose.disconnect();
  process.exit(0);
}

// Traiter par batches
const totalBatches = Math.ceil(targets.length / BATCH_SIZE);
let totalOk = 0, totalSkip = 0, totalErr = 0;

for (let b = 0; b < totalBatches; b++) {
  const batch = targets.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📂 Batch ${b + 1}/${totalBatches} — ${batch.length} tracks`);
  console.log(`${'─'.repeat(60)}`);

  try {
    const prompt = buildPrompt(batch);
    console.log(`  🤖 Appel Gemini (${batch.length} tracks)...`);
    const results = await callGemini(prompt);

    if (!Array.isArray(results)) {
      console.error('  ❌ Gemini n\'a pas renvoyé un tableau');
      totalErr += batch.length;
      continue;
    }

    console.log(`  ✅ Gemini: ${results.length} classifications reçues`);

    // Sauvegarder le résultat brut
    const outDir = join(__dirname, 'batches_done');
    if (!existsSync(outDir)) mkdirSync(outDir);
    const batchNum = 100 + b; // Numérotation haute pour éviter conflit
    writeFileSync(
      join(outDir, `batch_gemini_${String(batchNum).padStart(3, '0')}_done.json`),
      JSON.stringify({ classifications: results, source: 'gemini', generatedAt: new Date().toISOString() }, null, 2)
    );

    // Appliquer
    for (const c of results) {
      try {
        const status = await applyClassification(c);
        if (status === 'ok') totalOk++;
        else totalSkip++;
      } catch (e) {
        console.error(`  ❌ ${c.id}: ${e.message}`);
        totalErr++;
      }
    }

    // Petit délai entre les batches pour rate limiting
    if (b < totalBatches - 1) {
      console.log('  ⏳ Pause 3s (rate limit)...');
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (e) {
    console.error(`  ❌ Erreur batch ${b + 1}: ${e.message}`);
    totalErr += batch.length;
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  🎉 RÉSUMÉ CLASSIFICATION GEMINI`);
console.log(`${'═'.repeat(60)}`);
console.log(`  Classifiées  : ${totalOk}`);
console.log(`  Skippées     : ${totalSkip}`);
console.log(`  Erreurs      : ${totalErr}`);
console.log(`${'═'.repeat(60)}\n`);

await mongoose.disconnect();
process.exit(totalErr > 0 ? 1 : 0);
