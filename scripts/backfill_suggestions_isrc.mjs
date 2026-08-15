// Backfill ISRC + deezerID pour Party.suggestions déjà en base sans ces champs.
// Contexte : Task #114 — bug L4578 write-through relay-server omettait isrc/deezerID.
// Suggestions insérées AVANT le fix 14/08 sont muettes pour RatingFlush → feuRatio=0.00.
// Ce script les rattrape via Deezer API search(title+artist).
//
// Usage :
//   Dry-run (défaut, ne modifie rien) :
//     node scripts/backfill_suggestions_isrc.mjs
//   Apply (écrit en base) :
//     node scripts/backfill_suggestions_isrc.mjs --apply
//
// MONGO_URI requis (env variable, jamais inline dans le chat/logs).
// Rate limit Deezer : sleep 150ms entre calls (~6 req/s, bien en-dessous du seuil).

import mongoose from 'mongoose';
import Party from '../models/Party.js';

const APPLY = process.argv.includes('--apply');
const SLEEP_MS = 150;
const SINCE = new Date('2026-08-01T00:00:00Z'); // parties depuis août

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fallbackHash(title, artist) {
  // Recopie de la logique EditorialSeedLoader.fallbackHash côté iOS (Swift)
  // pour cohérence Track ↔ suggestion matching.
  const norm = (s) => (s || '').toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30);
  return `${norm(title)}_${norm(artist)}`;
}

async function searchDeezer(title, artist) {
  const q = encodeURIComponent(`${artist} ${title}`);
  const url = `https://api.deezer.com/search?q=${q}&limit=3&order=RANKING`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.data || data.data.length === 0) return null;
    const top = data.data[0];
    // Fetch full track for ISRC (search endpoint ne renvoie pas l'ISRC directement)
    const trackRes = await fetch(`https://api.deezer.com/track/${top.id}`);
    if (!trackRes.ok) return { deezerID: top.id, isrc: null };
    const trackData = await trackRes.json();
    return {
      deezerID: top.id,
      isrc: trackData.isrc || null
    };
  } catch (err) {
    return null;
  }
}

async function run() {
  // Accepte MONGO_URI (mon usage historique) OU MONGODB_URI (nom du .env relay-server)
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI || MONGO_URI.includes('********')) {
    console.error('❌ MONGO_URI ou MONGODB_URI env variable required');
    console.error('   Usage: node --env-file=.env scripts/backfill_suggestions_isrc.mjs [--apply]');
    process.exit(1);
  }

  console.log(APPLY ? '🚨 MODE APPLY — les mutations seront écrites en base' : 'ℹ️  Mode dry-run (aucune écriture). Utiliser --apply pour appliquer.');

  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const parties = await Party.find({ createdAt: { $gte: SINCE } })
    .select('code suggestions')
    .lean();

  console.log(`📊 ${parties.length} parties à scanner\n`);

  let totalSuggestions = 0;
  let toBackfill = 0;
  let backfilled = 0;
  let deezerHits = 0;
  let deezerMisses = 0;
  let failedWrites = 0;

  for (const party of parties) {
    const suggestions = party.suggestions || [];
    if (suggestions.length === 0) continue;

    const patched = [];
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      totalSuggestions++;

      const hasIsrc = s.isrc && s.isrc.length > 0;
      const hasDeezerID = s.deezerID && s.deezerID > 0;
      if (hasIsrc && hasDeezerID) continue;

      toBackfill++;
      const title = s.title || '';
      const artist = s.artist || '';
      if (!title || !artist) {
        console.log(`  ⚠️  [${party.code}] #${i} skip (title ou artist vide)`);
        continue;
      }

      const deezerData = await searchDeezer(title, artist);
      await sleep(SLEEP_MS);

      if (!deezerData || (!deezerData.isrc && !deezerData.deezerID)) {
        deezerMisses++;
        console.log(`  ⚠️  [${party.code}] #${i} "${title}" — ${artist} → Deezer miss`);
        continue;
      }

      deezerHits++;
      const fh = fallbackHash(title, artist);
      const patch = {
        isrc: deezerData.isrc || s.isrc || null,
        deezerID: deezerData.deezerID || s.deezerID || null,
        fallbackHash: fh
      };
      console.log(`  ✅ [${party.code}] #${i} "${title}" — ${artist} → ISRC ${patch.isrc || '(nul)'} deezerID ${patch.deezerID}`);

      if (APPLY) {
        try {
          // Update par positional : suggestions.<i>.isrc etc
          await Party.updateOne(
            { code: party.code },
            {
              $set: {
                [`suggestions.${i}.isrc`]: patch.isrc,
                [`suggestions.${i}.deezerID`]: patch.deezerID,
                [`suggestions.${i}.fallbackHash`]: patch.fallbackHash
              }
            }
          );
          backfilled++;
        } catch (err) {
          failedWrites++;
          console.log(`  ❌ [${party.code}] #${i} write failed: ${err.message}`);
        }
      }
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('📊 REPORT');
  console.log('═══════════════════════════════════════════');
  console.log(`  Total suggestions scannées : ${totalSuggestions}`);
  console.log(`  À backfill (sans ISRC/deezerID) : ${toBackfill}`);
  console.log(`  Deezer hits : ${deezerHits}`);
  console.log(`  Deezer misses : ${deezerMisses}`);
  if (APPLY) {
    console.log(`  Écritures BDD réussies : ${backfilled}`);
    console.log(`  Écritures BDD échouées : ${failedWrites}`);
  } else {
    console.log(`  Écritures BDD : SKIPPÉES (dry-run)`);
    console.log(`  → Relancer avec --apply pour écrire`);
  }

  await mongoose.disconnect();
  console.log('\n✅ Done');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
