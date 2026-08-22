// Analyse les 652 bangers IA (batches_done) vs les 662 isBanger:true en BDD prod.
// Répond : combien de vrais bangers IA sont bien flagués, combien de faux bangers
// (marqués isBanger:true en BDD mais pas dans le résultat IA = IN mal mappés).
//
// Usage : node --env-file=.env scripts/analyze_bangers_ia.mjs

import mongoose from 'mongoose';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import Track from '../models/Track.js';

const BATCHES_DIR = 'batches_done';

async function run() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI ou MONGODB_URI requis');
    process.exit(1);
  }

  // 1. Extract IA bangers ids depuis tous les batches_done
  const files = readdirSync(BATCHES_DIR).filter(f => f.endsWith('.json'));
  const iaBangers = new Map(); // deezerTrackId (Number) → { title, artist, phase }
  const iaNonBangers = new Set();
  let parseErrors = 0;
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(BATCHES_DIR, f), 'utf8'));
      const arr = d.classifications || [];
      for (const t of arr) {
        const idNum = Number(t.id);
        if (isNaN(idNum) || idNum === 0) continue;
        if (t.isBanger === true) {
          iaBangers.set(idNum, {
            title: t.title || '',
            artist: t.artist || '',
            phase: t.phase || ''
          });
        } else {
          iaNonBangers.add(idNum);
        }
      }
    } catch (e) { parseErrors++; }
  }

  console.log('═══════════════════════════════════════════');
  console.log('📊 SOURCE IA (batches_done/)');
  console.log('═══════════════════════════════════════════');
  console.log(`  Batches parsés               : ${files.length - parseErrors}`);
  console.log(`  Parse errors                 : ${parseErrors}`);
  console.log(`  Bangers IA (Deezer id unique): ${iaBangers.size}`);
  console.log(`  Non-bangers IA               : ${iaNonBangers.size}`);
  console.log('');

  // 2. Cross-ref BDD prod
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const bddBangers = await Track.find({ isBanger: true })
    .select('providers.deezer.trackId title artist isBanger isFiller')
    .lean();

  console.log('═══════════════════════════════════════════');
  console.log('📊 BDD PROD');
  console.log('═══════════════════════════════════════════');
  console.log(`  Total isBanger:true en BDD   : ${bddBangers.length}`);
  console.log('');

  // 3. Intersection
  const bddBangerIds = new Set(
    bddBangers
      .map(t => t.providers?.deezer?.trackId)
      .filter(id => id && !isNaN(id))
      .map(id => Number(id))
  );

  const truePositives = [...iaBangers.keys()].filter(id => bddBangerIds.has(id));  // IA banger + BDD banger ✅
  const falsePositives = [...bddBangerIds].filter(id => !iaBangers.has(id) && !iaNonBangers.has(id)); // BDD banger mais IA jamais vu (= ajout post-IA, probablement IN mal mappé)
  const explicitNonBangerInBdd = [...bddBangerIds].filter(id => iaNonBangers.has(id)); // BDD banger MAIS IA a explicitement dit non-banger 🚨
  const missedBangers = [...iaBangers.keys()].filter(id => !bddBangerIds.has(id)); // IA banger MAIS pas isBanger en BDD (perdu quelque part)

  console.log('═══════════════════════════════════════════');
  console.log('🎯 CROSS-REF BDD ↔ IA');
  console.log('═══════════════════════════════════════════');
  console.log(`  ✅ Vrais bangers (BDD + IA)          : ${truePositives.length}`);
  console.log(`  🚨 Faux bangers IN mappés            : ${falsePositives.length}  (BDD isBanger:true mais IA n'a jamais classifié → probablement ajouts post-IA)`);
  console.log(`  🚨 Faux bangers explicitement rejetés: ${explicitNonBangerInBdd.length}  (BDD isBanger:true MAIS IA a dit isBanger:false explicitement)`);
  console.log(`  ⚠️  Vrais bangers IA perdus en BDD  : ${missedBangers.length}  (IA a dit banger mais BDD isBanger:false — à réactiver ?)`);
  console.log('');

  // 4. Sample 10 faux positifs pour comprendre
  if (explicitNonBangerInBdd.length > 0) {
    console.log('═══════════════════════════════════════════');
    console.log('🔍 SAMPLE 10 FAUX BANGERS EXPLICITEMENT REJETÉS PAR IA');
    console.log('═══════════════════════════════════════════');
    const sample = bddBangers
      .filter(t => explicitNonBangerInBdd.includes(Number(t.providers?.deezer?.trackId)))
      .slice(0, 10);
    for (const t of sample) {
      console.log(`  "${t.title}" — ${t.artist}  (deezerId: ${t.providers?.deezer?.trackId})`);
    }
    console.log('');
  }

  if (missedBangers.length > 0) {
    console.log('═══════════════════════════════════════════');
    console.log('🔍 SAMPLE 10 VRAIS BANGERS IA PERDUS EN BDD');
    console.log('═══════════════════════════════════════════');
    const sample = missedBangers.slice(0, 10).map(id => ({ id, meta: iaBangers.get(id) }));
    for (const s of sample) {
      console.log(`  deezerId ${s.id} → phase:${s.meta.phase}  (title/artist absents des batches, à rechercher via BDD)`);
    }
  }

  await mongoose.disconnect();
  console.log('\n✅ Done');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
