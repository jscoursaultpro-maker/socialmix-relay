import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Track from '../models/Track.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from relay-server root
const envPath = path.join(__dirname, '..', '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.match(/^[A-Z]/) && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.substring(0, i).trim(), l.substring(i+1).replace(/^"|"$/g, '').trim()]; })
);

const MONGO_URI = process.env.MONGO_URI || env.MONGO_URI || env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI manquant');
  process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === '1';
const FORCE = process.env.FORCE === '1';

const CLASSIFIED_BY_TAG = 'claude_batch_v2_2026-07-14';

const BATCH_DIR = path.join(__dirname, '..', 'batches_chatgpt', 'batch_out');
const DONE_DIR = path.join(BATCH_DIR, 'done');

if (!fs.existsSync(DONE_DIR)) {
  fs.mkdirSync(DONE_DIR, { recursive: true });
}

const OVERRIDE_FIELDS = [
  'uiCategoryPrimary', 'uiCategoriesSecondary', 'phase', 'phaseAlternate', 
  'energy', 'bpm', 'danceability', 'isBanger', 'isSingalong', 'isEmotional', 
  'isCaliente', 'isHardcore', 'isFiller', 'era', 'releaseYear', 'mood', 
  'language', 'hasLyrics', 'explicit', 'tags', 'partyMoment', 'cooldownDays', 'notes',
  'suggestable', 'confidence', 'confidence_notes'
];

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`\n${'='.repeat(72)}`);
    console.log(`  IMPORT CLAUDE BATCH OUT — ${DRY_RUN ? 'DRY-RUN' : 'LIVE MODE'}`);
    console.log(`${'='.repeat(72)}\n`);

    const files = fs.readdirSync(BATCH_DIR).filter(f => f.startsWith('batch_out_') && f.endsWith('.json'));
    
    if (files.length === 0) {
      console.log('Aucun fichier batch_out_*.json trouvé.');
      process.exit(0);
    }

    let globalUpdated = 0;
    let globalNotFound = 0;
    let globalErrors = 0;
    let globalSkippedVerified = 0;

    for (const file of files) {
      console.log(`\nTraitement de ${file}...`);
      const filePath = path.join(BATCH_DIR, file);
      
      let data;
      try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (err) {
        console.error(`❌ Erreur parse JSON pour ${file}:`, err.message);
        globalErrors++;
        continue;
      }

      const classifications = data.classifications || data.tracks_classees || [];
      console.log(` > ${classifications.length} tracks à importer.`);

      let updated = 0;
      let notFound = 0;
      let errors = 0;
      let skippedVerified = 0;

      for (const item of classifications) {
        try {
          // ★ fix(import): normalize V2 batch field aliases → schema field names
          // Batches 019+ use French/abbreviated names; batches 001-018 use schema names.
          if (item.phase_principale !== undefined && item.phase === undefined) item.phase = item.phase_principale;
          if (item.phase_secondaire !== undefined && item.phaseAlternate === undefined) item.phaseAlternate = item.phase_secondaire;
          if (item.genre !== undefined && item.genreBDD === undefined) item.genreBDD = item.genre;
          if (item.uiCat !== undefined && item.uiCategoryPrimary === undefined) item.uiCategoryPrimary = item.uiCat;
          if (item.uiSec !== undefined && item.uiCategoriesSecondary === undefined) item.uiCategoriesSecondary = item.uiSec;

          const query = [];
          if (item.deezerTrackId) query.push({ 'providers.deezer.trackId': parseInt(item.deezerTrackId, 10) });
          else if (item.id && !isNaN(item.id)) query.push({ 'providers.deezer.trackId': parseInt(item.id, 10) });
          
          if (item._id) query.push({ _id: new mongoose.Types.ObjectId(item._id) });
          
          if (query.length === 0) {
            console.log(`⚠️ Skip track "${item.title}" sans deezerTrackId ni _id`);
            errors++;
            continue;
          }

          const track = await Track.findOne({ $or: query });

          if (!track) {
            console.log(`❌ NOT FOUND: ${item.title} - ${item.artist}`);
            notFound++;
            continue;
          }

          if (!FORCE && track.classifiedBy && track.classifiedBy.includes('claude_batch_v2')) {
            console.log(`⏭️ SKIP (already classified): ${track.title} - ${track.artist}`);
            continue;
          }

          if (track.isVerified === true && process.env.FORCE_OVERRIDE_VERIFIED !== '1') {
            console.log(`⚠️  SKIP (isVerified=true, curaté manuellement) : "${track.title}" - ${track.artist}`);
            skippedVerified++;
            continue;
          }

          // Merge des champs
          let changes = {};
          
          if (item.genreBDD !== undefined) {
            track.genre = item.genreBDD;
            changes.genre = item.genreBDD;
          }

          for (const field of OVERRIDE_FIELDS) {
            if (item[field] !== undefined) {
              if (field === 'bpm') {
                if (track.bpmSource === 'deezer_api_v1_2026_07_14') {
                  // Ne pas écraser le BPM
                  track.bpm_confidence = 'deezer_api';
                  changes.bpm_confidence = 'deezer_api (kept)';
                } else {
                  track.bpm = item[field];
                  changes.bpm = item[field];
                  track.bpm_confidence = 'estimated';
                  changes.bpm_confidence = 'estimated';
                }
              } else if (field === 'danceability') {
                let val = item[field];
                if (typeof val === 'number' && val > 1) {
                  val = val / 100;
                }
                track[field] = val;
                changes[field] = val;
              } else if (field === 'mood') {
                let val = item[field];
                const validMoods = ["fun", "emotional", "aggressive", "chill", null];
                if (!validMoods.includes(val)) {
                   if (val === 'energetic' || val === 'euphoric') val = 'fun';
                   else if (val === 'sensual') val = 'emotional';
                   else if (val === 'warm') val = 'chill';
                   else val = 'fun';
                }
                track[field] = val;
                changes[field] = val;
              } else {
                track[field] = item[field];
                changes[field] = item[field];
              }
            }
          }

          track.classifiedBy = CLASSIFIED_BY_TAG;
          track.lastReviewedAt = new Date();
          if (!track.source) track.source = 'batch_workflow';

          if (DRY_RUN) {
            console.log(`✅ [DRY-RUN] Will update "${track.title}" - ${track.artist}`);
            console.log(`   Changes:`, JSON.stringify(changes));
          } else {
            await track.save();
            console.log(`✅ UPDATED: "${track.title}" - ${track.artist}`);
          }
          updated++;
        } catch (err) {
          console.error(`❌ ERROR sur la track ${item.title}:`, err.message);
          errors++;
        }
      }

      globalUpdated += updated;
      globalNotFound += notFound;
      globalErrors += errors;
      globalSkippedVerified += skippedVerified;

      if (!DRY_RUN && errors === 0 && notFound === 0) { // On move seulement si 100% success ou selon la politique
        const dest = path.join(DONE_DIR, file);
        fs.renameSync(filePath, dest);
        console.log(`📦 Fichier archivé: done/${file}`);
      } else if (!DRY_RUN) {
        console.log(`⚠️ Fichier non archivé car il y a eu des erreurs ou des tracks non trouvées.`);
      }
    }

    console.log(`\n${'='.repeat(72)}`);
    console.log(`  BILAN DE L'IMPORT`);
    console.log(`${'='.repeat(72)}`);
    console.log(`  ✅ Updated   : ${globalUpdated}`);
    console.log(`  ⏭️ Skipped Ver: ${globalSkippedVerified}`);
    console.log(`  ❌ Not Found : ${globalNotFound}`);
    console.log(`  ⚠️  Errors   : ${globalErrors}`);
    console.log(`${'='.repeat(72)}\n`);

  } catch (err) {
    console.error('Erreur globale :', err);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Déconnecté');
  }
})();
