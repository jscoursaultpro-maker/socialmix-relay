import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import Track from '../models/Track.js';

const OUT_DIR = path.join(__dirname, '../batches_out');
const DONE_DIR = path.join(__dirname, '../batches_done');
const REJ_DIR = path.join(__dirname, '../batches_rejected');

if (!fs.existsSync(DONE_DIR)) fs.mkdirSync(DONE_DIR, { recursive: true });
if (!fs.existsSync(REJ_DIR)) fs.mkdirSync(REJ_DIR, { recursive: true });

const isDryRun = process.argv.includes('--dry-run');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('_done.json'));
  if (files.length === 0) {
    console.log('[import] Aucun fichier trouvé dans batches_out/');
    process.exit(0);
  }

  let totalUpdated = 0;
  let totalRejected = 0;
  let totalHardcore = 0;

  for (const file of files) {
    const filePath = path.join(OUT_DIR, file);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error(`[import] Erreur lecture ${file}:`, e.message);
      continue;
    }

    const arr = data.classifications;
    if (!Array.isArray(arr)) {
      console.error(`[import] ${file} ignoré: pas de tableau 'classifications'`);
      continue;
    }

    // VALIDATION ANTI-TEMPLATE
    if (arr.length >= 20) {
      const uniqueGenres = new Set(arr.map(t => t.genreBDD));
      const uniquePhases = new Set(arr.map(t => t.phase));
      const uniqueEras = new Set(arr.map(t => t.era));
      const uniqueBpms = new Set(arr.map(t => t.bpm));
      const uniqueEnergies = new Set(arr.map(t => t.energy));

      const onesCount = [uniqueGenres, uniquePhases, uniqueEras, uniqueBpms, uniqueEnergies]
        .filter(s => s.size <= 1).length;

      // Anti-template stricte demandée par Jean-Sé: genreBDD distincts >= 3, phase distinctes >= 2
      if (uniqueGenres.size < 3 || uniquePhases.size < 2 || onesCount === 5) {
        console.warn(`[import] ⚠️ ${file} REJETÉ (Template détecté) -> genres:${uniqueGenres.size}, phases:${uniquePhases.size}`);
        if (!isDryRun) {
          fs.renameSync(filePath, path.join(REJ_DIR, file));
        }
        totalRejected++;
        continue;
      }
    }

    let fileUpdated = 0;
    let fileHardcore = 0;

    for (const up of arr) {
      const id = up.id;
      if (!id) continue;

      let query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { "providers.deezer.trackId": Number(id) };
      const track = await Track.findOne(query);

      if (track) {
        if (!isDryRun) {
          // Validation des champs (on ne modifie PLUS la BDD directement, on met juste dans gptSuggestion)
          if (up.isHardcore) fileHardcore++;

          track.isLabeled = false; // Reste false pour apparaître dans "À vérifier"
          track.needs_review = true; 
          
          track.chatgptQueueId = null; 
          track.gptSuggestion = up; // Garder la proposition pour l'affichage Monitor (colonne du milieu)
          track.classifiedBy = "claude-sonnet-4-6-batch";
          track.source = "batch_workflow";
          track.lastReviewedAt = new Date();

          await track.save();
        } else {
          if (up.isHardcore) fileHardcore++;
        }
        fileUpdated++;
      }
    }

    console.log(`[import] ${file} : ${fileUpdated} tracks updated (Hardcore detected: ${fileHardcore})`);
    
    if (!isDryRun) {
      fs.renameSync(filePath, path.join(DONE_DIR, file));
    }
    
    totalUpdated += fileUpdated;
    totalHardcore += fileHardcore;
  }

  console.log(`\n[import] TOTAL : ${totalUpdated} tracks updated, ${totalRejected} rejected`);
  console.log(`[import] Tracks Hardcore taguées : ${totalHardcore}`);
  if (isDryRun) {
    console.log(`[import] (Mode --dry-run, aucun fichier déplacé ni base modifiée)`);
  }

  process.exit(0);
}

run().catch(err => {
  console.error("Erreur:", err);
  process.exit(1);
});
