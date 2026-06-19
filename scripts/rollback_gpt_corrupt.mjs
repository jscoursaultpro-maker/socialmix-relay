import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import Track from '../models/Track.js';

const isApply = process.argv.includes('--apply');
const isDryRun = process.argv.includes('--dry-run') || !isApply;

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ MongoDB connected');

  // We are looking for tracks touched by ChatGPT recently that were corrupted.
  // The user says ~150 tracks. We can use a timestamp of today.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Filter 1: Tracks touched today OR with chatgptQueueId not null, which are labeled but NOT verified
  const query = {
    isVerified: { $ne: true },
    $or: [
      { chatgptQueueId: { $ne: null } },
      { lastReviewedAt: { $gte: today } }
    ],
    
  };

  const corruptTracks = await Track.find(query);
  
  // Filter 2: Tracks that ARE verified, but might have been touched today (to show preserved)
  const verifiedQuery = {
    isVerified: true,
    $or: [
      { chatgptQueueId: { $ne: null } },
      { lastReviewedAt: { $gte: today } }
    ],
    
  };
  const verifiedTracks = await Track.find(verifiedQuery);

  console.log('\n═══════════════════════════════════════════');
  console.log(`🔍 ÉTAPE 1 — DIAGNOSTIC (${isApply ? 'APPLY MODE' : 'DRY-RUN'})`);
  console.log('═══════════════════════════════════════════\n');

  console.log(`🔴 Tracks corrompues à RESET : ${corruptTracks.length}`);
  console.log(`✅ Tracks Verified PRÉSERVÉES : ${verifiedTracks.length}`);

  if (verifiedTracks.length > 0) {
    console.log('\nListe des tracks préservées :');
    verifiedTracks.forEach(t => {
      console.log(`   - "${t.title}" — ${typeof t.artist === 'object' ? t.artist.name : t.artist}`);
    });
  }

  // Calculate distribution of chatgptQueueId
  const queueIds = {};
  corruptTracks.forEach(t => {
    const qid = t.chatgptQueueId || 'null';
    queueIds[qid] = (queueIds[qid] || 0) + 1;
  });
  console.log('\nDistribution des chatgptQueueId :');
  Object.entries(queueIds).forEach(([qid, count]) => {
    console.log(`   - ${qid} : ${count} tracks`);
  });

  if (corruptTracks.length > 0) {
    console.log('\nÉchantillon de 10 tracks corrompues (avant rollback) :');
    corruptTracks.slice(0, 10).forEach(t => {
      console.log(`   - ID: ${t._id} | "${t.title}" | phase: ${t.phase} | energy: ${t.energy} | genre: ${t.genreBDD}`);
    });
  }

  if (!isApply) {
    console.log('\n⚠️ CECI EST UN DRY-RUN. Aucune modification n\'a été faite.');
    console.log('Pour appliquer le rollback, exécutez : node scripts/rollback_gpt_corrupt.mjs --apply\n');
    process.exit(0);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('🚀 ÉTAPE 2 — APPLYING ROLLBACK...');
  console.log('═══════════════════════════════════════════\n');

  let updated = 0;
  for (const t of corruptTracks) {
    // RESET des champs pollués
    t.uiCategoryPrimary = null;
    t.uiCategoriesSecondary = [];
    t.phase = null;
    t.phaseAlternate = null;
    t.era = null;
    t.mood = null;
    t.language = null;
    t.danceability = null;
    t.isBanger = false;
    t.isSingalong = false;
    t.isEmotional = false;
    t.isCaliente = false;
    t.isHardcore = false;
    t.hasLyrics = true;
    t.explicit = false;
    t.notes = "";
    t.justification = "";

    // PRÉSERVE les champs historiques s'ils existaient via legacy ou on garde le genre s'il était déjà là ?
    // Wait, the user said: "genre original (s'il existait avant via _legacyGenre)"
    if (t._legacyGenre) {
      t.genreBDD = t._legacyGenre;
    }
    // phase originale via _legacyPhase
    if (t._legacyPhase) {
      t.phase = t._legacyPhase;
    }

    // RESET du statut
    t.gptSuggestion = null;
    t.chatgptQueueId = null;
    t.isLabeled = false;
    t.needs_review = true;
    t.qualityLevel = 'vide'; // Ou on peut recalculer mais 'vide' est ok car on a reset la plupart des choses
    t.lastReviewedAt = null;
    t.rollbackReason = "GPT-4o template corruption 2026-06-17";

    await t.save();
    updated++;
  }

  console.log(`✅ Rollback terminé : ${updated} tracks remises à "vide/À vérifier".`);
  process.exit(0);
}

run().catch(err => {
  console.error("Erreur:", err);
  process.exit(1);
});
