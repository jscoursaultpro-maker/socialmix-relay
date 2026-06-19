/**
 * enrich_deezer_rank.mjs
 *
 * Enrichit curated_base_v3.json depuis l'API publique Deezer (/track/{id}) :
 *   - rank       → toujours mis à jour
 *   - preview    → toujours mis à jour
 *   - duration   → toujours mis à jour si manquant
 *   - bpm        → UNIQUEMENT si bpm actuel === 0 (jamais écrasé)
 *
 * Rate limit : 200ms entre chaque requête (~5 req/sec) — zéro risque de ban.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, './curated_base_v3.json');

const DELAY_MS  = 200;   // 200ms entre chaque requête = ~5 req/sec
const SAVE_EVERY = 50;   // Sauvegarde intermédiaire toutes les 50 tracks

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Fetch Deezer track info ─────────────────────────────────────────────────
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

// ─── Main ────────────────────────────────────────────────────────────────────
const db     = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const tracks = db.tracks || [];

// Tracks avec deezerID valide
const toEnrich = tracks.filter(t => t.deezerID > 0);
const total    = toEnrich.length;

console.log(`\n🎵 Enrichissement Deezer rank — ${total} tracks`);
console.log(`   Vitesse : ~5 req/sec (200ms) — durée estimée : ~${Math.ceil(total * 0.2 / 60)} min\n`);

let enriched   = 0;
let bpmAdded   = 0;
let rankAdded  = 0;
let previewAdded = 0;
let errors     = 0;

for (let i = 0; i < total; i++) {
  const t = toEnrich[i];

  process.stdout.write(`\r  [${i + 1}/${total}] "${t.title?.slice(0, 35).padEnd(35)}" … `);

  const info = await fetchDeezerTrack(t.deezerID);

  if (!info) {
    errors++;
    process.stdout.write('❌ erreur');
  } else {
    // Rank — toujours
    if (info.rank > 0) {
      t.rank = info.rank;
      rankAdded++;
    }
    // Preview — toujours
    if (info.preview) {
      t.preview = info.preview;
      previewAdded++;
    }
    // Duration — si manquant
    if (info.duration > 0 && (!t.duration || t.duration === 0)) {
      t.duration = info.duration;
    }
    // ISRC — si manquant
    if (info.isrc && !t.isrc) {
      t.isrc = info.isrc;
    }
    // BPM — UNIQUEMENT si actuellement 0
    if (info.bpm > 0 && (!t.bpm || t.bpm === 0)) {
      t.bpm = info.bpm;
      bpmAdded++;
      process.stdout.write(`✅ BPM:${info.bpm} rank:${info.rank}`);
    } else {
      process.stdout.write(`✅ rank:${info.rank}`);
    }
    enriched++;
  }

  // Sauvegarde intermédiaire
  if ((i + 1) % SAVE_EVERY === 0) {
    db.generatedAt = new Date().toISOString();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    process.stdout.write(` 💾 sauvegarde (${i + 1}/${total})\n`);
  }

  await sleep(DELAY_MS);
}

// Sauvegarde finale
db.generatedAt = new Date().toISOString();
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

// Stats BPM restants
const stillZero = tracks.filter(t => !t.bpm || t.bpm === 0).length;

console.log('\n\n══════════════════════════════════════════════════');
console.log(`  ✅ Tracks enrichis        : ${enriched}/${total}`);
console.log(`  ⭐ Rank récupérés         : ${rankAdded}`);
console.log(`  🎵 Preview URL mis à jour : ${previewAdded}`);
console.log(`  ⚡ BPM injectés (manquants): ${bpmAdded}`);
console.log(`  ❌ Erreurs API            : ${errors}`);
console.log(`  ⚠️  BPM encore à 0        : ${stillZero}`);
console.log(`  📄 curated_base_v3.json mis à jour`);
console.log('══════════════════════════════════════════════════\n');
