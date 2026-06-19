import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import Track from '../models/Track.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const tracks = await Track.find({ source: 'batch_workflow', isVerified: { $ne: true } });
  let updated = 0;

  for (const track of tracks) {
    track.gptSuggestion = null;
    track.needs_review = false;
    track.isLabeled = false;
    track.source = null; // Retire le flag batch_workflow
    track.classifiedBy = null;
    
    // On ne touche pas aux attributs principaux car on a potentiellement perdu l'historique,
    // mais en re-lançant import_batches.mjs sur les lots 1 à 5, 
    // le script refera proprement "IA Prop" sans écraser.
    await track.save();
    updated++;
  }

  console.log(`[reset] ${updated} tracks non-vérifiées ont été remises à zéro.`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
