import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Track from '../models/Track.js';

const DELAY_MS = 500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchDeezerTrack(deezerID) {
  try {
    const res = await fetch(`https://api.deezer.com/track/${deezerID}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return {
      rank:     data.rank     || 0,
      preview:  data.preview  || '',
      duration: data.duration || 0,
      bpm:      data.bpm      || 0,
      isrc:     data.isrc     || '',
    };
  } catch (e) {
    return null;
  }
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  
  // Diagnostic Initial
  const total = await Track.countDocuments({});
  const enriched = await Track.countDocuments({ deezerRank: { $gt: 0 } });
  const rankZero = await Track.countDocuments({ deezerRank: 0 });
  const rankAbsent = await Track.countDocuments({ deezerRank: { $exists: false } }) + await Track.countDocuments({ deezerRank: null });
  
  console.log(`=== DIAGNOSTIC INITIAL DEEZER RANK ===`);
  console.log(`- Total tracks : ${total}`);
  console.log(`- Avec rank > 0 : ${enriched}`);
  console.log(`- Avec rank = 0 : ${rankZero}`);
  console.log(`- Rank absent : ${rankAbsent}`);
  
  // Bonus analyse
  const noPhase = await Track.find({ $or: [{ phase: null }, { phase: { $exists: false } }] }).lean();
  let noPhaseWithRank = 0;
  for (const t of noPhase) {
    if (t.deezerRank > 0) noPhaseWithRank++;
  }
  const bonusPct = noPhase.length > 0 ? Math.round((noPhaseWithRank / noPhase.length) * 100) : 0;
  console.log(`\n=== BONUS ANALYSE ===`);
  console.log(`- Sur les ${noPhase.length} tracks sans phase, ${noPhaseWithRank} ont un deezerRank > 0 (${bonusPct}%)`);
  
  // Récupération tracks à enrichir (fantômes)
  const toEnrichGhosts = await Track.find({ source: "fantome_recovered", deezerRank: { $in: [0, null] } });
  
  // Récupération tracks à enrichir (originaux)
  const toEnrichOriginals = await Track.find({ 
    source: { $ne: "fantome_recovered" }, 
    deezerRank: { $in: [0, null] },
    $or: [{ 'providers.deezer.trackId': { $gt: 0 } }, { deezerID: { $gt: 0 } }] 
  });
  
  let ghostsEnriched = 0;
  let ghostsErrors = 0;
  let originalsEnriched = 0;
  let originalsErrors = 0;
  
  async function processBatch(toEnrich, isGhost) {
    if (toEnrich.length > 0) {
      console.log(`\n=== ENRICHISSEMENT (${isGhost ? 'Fantômes' : 'Originaux'} : ${toEnrich.length} tracks) ===`);
      const startTime = Date.now();
      
      for (let i = 0; i < toEnrich.length; i++) {
        const doc = toEnrich[i];
        const did = doc.providers?.deezer?.trackId || doc.deezerID;
        if (!did) {
          if (isGhost) ghostsErrors++; else originalsErrors++;
          continue;
        }
      
      const info = await fetchDeezerTrack(did);
      if (!info) {
        if (isGhost) ghostsErrors++; else originalsErrors++;
      } else {
        if (info.rank > 0) doc.deezerRank = info.rank;
        if (info.duration > 0 && doc.duration === 0) doc.duration = info.duration;
        if (info.isrc && !doc.isrc) doc.isrc = info.isrc;
        if (info.bpm > 0 && doc.bpm === 0) doc.bpm = info.bpm;
        
        try {
          await doc.save();
          if (isGhost) ghostsEnriched++; else originalsEnriched++;
        } catch (err) {
          if (err.code === 11000 && err.keyPattern && err.keyPattern.isrc) {
            console.log(`[enrich] Duplicate ISRC ${doc.isrc} for ${doc.title}, clearing it and retrying.`);
            doc.isrc = undefined;
            try {
              await doc.save();
              if (isGhost) ghostsEnriched++; else originalsEnriched++;
            } catch (err2) {
              console.log(`[enrich] Failed to save even without ISRC: ${err2.message}`);
              if (isGhost) ghostsErrors++; else originalsErrors++;
            }
          } else {
            console.log(`[enrich] Error saving ${doc.title}: ${err.message}`);
            if (isGhost) ghostsErrors++; else originalsErrors++;
          }
        }
      }
      
      if ((i+1) % 50 === 0) {
        const elapsedS = Math.round((Date.now() - startTime)/1000);
        console.log(`[enrich] T+${elapsedS}s | Updated ${i+1}/${toEnrich.length} tracks`);
      }
      
      await sleep(DELAY_MS);
    }
    
    console.log(`[enrich] DONE | ${toEnrich.length} processed`);
  }
}

  await processBatch(toEnrichGhosts, true);
  await processBatch(toEnrichOriginals, false);
  
  // Distribution finale
  const allFinal = await Track.find({ deezerRank: { $gt: 0 } }).lean();
  let r1_100k = 0;
  let r100k_500k = 0;
  let r500k_1m = 0;
  let r1m_2m = 0;
  let r_gt_2m = 0;
  
  for (const t of allFinal) {
    const r = t.deezerRank;
    if (r <= 100000) r1_100k++;
    else if (r <= 500000) r100k_500k++;
    else if (r <= 1000000) r500k_1m++;
    else if (r <= 2000000) r1m_2m++;
    else r_gt_2m++;
  }
  
  const finalCount = await Track.countDocuments({ deezerRank: { $gt: 0 } });
  console.log(`\n=== BILAN GLOBAL ENRICHISSEMENT ===`);
  console.log(`- Fantômes : ${ghostsEnriched} enrichis, ${ghostsErrors} erreurs`);
  console.log(`- Originaux : ${originalsEnriched} enrichis, ${originalsErrors} erreurs`);
  console.log(`- Total MongoDB avec rank > 0 : ${finalCount} / ${total}`);
  
  console.log(`\n=== DISTRIBUTION FINALE RANK ===`);
  console.log(`- rank 1-100k (mega hit) : ${r1_100k}`);
  console.log(`- rank 100k-500k : ${r100k_500k}`);
  console.log(`- rank 500k-1M : ${r500k_1m}`);
  console.log(`- rank 1M-2M : ${r1m_2m}`);
  console.log(`- rank > 2M : ${r_gt_2m}`);

  await mongoose.disconnect();
}

run().catch(console.error);
