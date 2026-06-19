/**
 * backfill_missing_fields.mjs
 * Remplit les champs manquants (uiCategoryPrimary, uiCategoriesSecondary, phase, phaseAlternate)
 * pour les tracks qualifiées qui ont été classées par les anciens batches Claude
 * mais n'avaient pas ces champs.
 * 
 * Logique :
 * 1. Si gptSuggestion contient les données → les promouvoir
 * 2. Sinon déduire uiCategoryPrimary du genre
 * 3. Déduire phase de energy/BPM si manquante
 */
import mongoose from 'mongoose';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI manquant'); process.exit(1); }

await mongoose.connect(MONGO_URI);
const Track = (await import('./models/Track.js')).default;
console.log('✅ MongoDB connecté');

// ─── Mapping genre → uiCategoryPrimary ───────────────────
const GENRE_TO_UI_CAT = {
  'Chill':      'Chill',
  'Pop':        'Pop',
  'Rock':       'Rock',
  'Hip-Hop':    'Rap',
  'R&B':        'Urban Groove',
  'Latin':      'Latin',
  'Afro':       'Latin',
  'Disco':      'Old school',
  'Funk':       'Old school',
  'House':      'Dance',
  'Electro':    'Électro',
  'COCOVARIET': 'Pop',
  'Jazz':       'Chill',
  'Soul':       'Old school',
  'Classique':  'Chill',
  'Classical':  'Chill',
  'Reggaeton':  'Latin',
};

// ─── Déduire phase depuis energy + BPM ───────────────────
function guessPhase(energy, bpm) {
  if (!energy || energy <= 0) return null;
  if (energy <= 4.5) return 'arrival';
  if (energy <= 5.5) return 'ambiance';
  if (energy <= 6.5) return 'ambiance';
  if (energy <= 7.5) return 'takeoff';
  if (energy <= 8.5) {
    if (bpm && bpm >= 115) return 'groove';
    return 'takeoff';
  }
  // energy > 8.5
  if (bpm && bpm >= 120) return 'peak';
  return 'groove';
}

function getAdjacentPhase(phase) {
  const map = {
    'arrival': 'ambiance',
    'ambiance': 'takeoff',
    'takeoff': 'groove',
    'groove': 'peak',
    'peak': 'groove',
    'closing': 'ambiance',
    'party': 'groove',
  };
  return map[phase] || 'ambiance';
}

// ─── Process ─────────────────────────────────────────────
const tracks = await Track.find({ adminQualified: true }).lean();
console.log(`📦 ${tracks.length} tracks qualifiées à analyser\n`);

let fixedUiCat = 0, fixedUiSec = 0, fixedPhase = 0, fixedPhaseAlt = 0;
let promotedFromGpt = 0;

for (const t of tracks) {
  const updates = {};
  const gpt = t.gptSuggestion || {};

  // 1. uiCategoryPrimary
  if (!t.uiCategoryPrimary) {
    if (gpt.uiCategoryPrimary) {
      updates.uiCategoryPrimary = gpt.uiCategoryPrimary;
      promotedFromGpt++;
    } else {
      const mapped = GENRE_TO_UI_CAT[t.genre];
      if (mapped) updates.uiCategoryPrimary = mapped;
    }
    if (updates.uiCategoryPrimary) fixedUiCat++;
  }

  // 2. uiCategoriesSecondary
  if (!t.uiCategoriesSecondary || t.uiCategoriesSecondary.length === 0) {
    if (gpt.uiCategoriesSecondary && gpt.uiCategoriesSecondary.length > 0) {
      updates.uiCategoriesSecondary = gpt.uiCategoriesSecondary;
      fixedUiSec++;
      promotedFromGpt++;
    }
  }

  // 3. phase
  if (!t.phase) {
    if (gpt.phase) {
      updates.phase = gpt.phase === 'party' ? 'peak' : gpt.phase;
      promotedFromGpt++;
    } else {
      const guessed = guessPhase(t.energy, t.bpm);
      if (guessed) updates.phase = guessed;
    }
    if (updates.phase) fixedPhase++;
  }

  // 4. phaseAlternate
  if (!t.phaseAlternate) {
    const ph = updates.phase || t.phase;
    if (ph) {
      if (gpt.phaseAlternate) {
        updates.phaseAlternate = gpt.phaseAlternate === 'party' ? 'peak' : gpt.phaseAlternate;
      } else {
        updates.phaseAlternate = getAdjacentPhase(ph);
      }
      fixedPhaseAlt++;
    }
  }

  // Apply
  if (Object.keys(updates).length > 0) {
    await Track.updateOne({ _id: t._id }, { $set: updates });
  }
}

console.log(`✅ Backfill terminé :`);
console.log(`  uiCategoryPrimary    : ${fixedUiCat} fixés`);
console.log(`  uiCategoriesSecondary: ${fixedUiSec} fixés`);
console.log(`  phase                : ${fixedPhase} fixés`);
console.log(`  phaseAlternate       : ${fixedPhaseAlt} fixés`);
console.log(`  (dont ${promotedFromGpt} promus depuis gptSuggestion)`);

// Verification
const noUiCat = await Track.countDocuments({ adminQualified: true, $or: [{uiCategoryPrimary: null}, {uiCategoryPrimary: ''}] });
const noPhase = await Track.countDocuments({ adminQualified: true, $or: [{phase: null}, {phase: ''}] });
console.log(`\n📊 Après backfill:`);
console.log(`  Sans uiCategoryPrimary: ${noUiCat}`);
console.log(`  Sans phase: ${noPhase}`);

await mongoose.disconnect();
