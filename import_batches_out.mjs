/**
 * import_batches_out.mjs
 *
 * Importe les batches classifiés par Claude (format batches_out/*.json)
 * dans MongoDB SocialMix.
 *
 * Format attendu : { classifications: [{ id, genreBDD, phase, phaseAlternate,
 *   energy, bpm, danceability, isBanger, isSingalong, isEmotional, explicit,
 *   uiCategoryPrimary, uiCategoriesSecondary, era, mood, language, notes }] }
 *
 * Usage : MONGO_URI=... node import_batches_out.mjs [batch_024 batch_026 ...]
 *   ou sans args = importe TOUS les batches_out/*.json non encore traités
 */

import mongoose from 'mongoose';
import { readFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONGO_URI  = process.env.MONGO_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI non défini'); process.exit(1); }

await mongoose.connect(MONGO_URI);
const Track = (await import('./models/Track.js')).default;
console.log('✅ MongoDB connecté\n');

// ─── Genre normalisation (vers taxonomie SocialMix canonique) ────────────────
const GENRE_MAP = {
  'Hip Hop':'Hip-Hop','Rap':'Hip-Hop','Trap':'Hip-Hop','R&B':'R&B',
  'Soul':'R&B','Funk':'Disco','Nu-Disco':'Disco','Funk/Soul':'Disco',
  'Chanson':'COCOVARIET','Variété Fr':'COCOVARIET','Variété Française':'COCOVARIET',
  'Années 80':'COCOVARIET','Années 90':'Disco',
  'Latin':'Latin','Reggaeton':'Reggaeton',
  'Deep House':'House','Tech House':'House','Tribal House':'House',
  'Drum n Bass':'Electro','Euro House':'Electro','Techno':'Electro',
  'Alternative Rock':'Rock','Indie Rock':'Rock','Pop Rock':'Pop',
  'Jazz':'Jazz','Ambient':'Chill','Lo-Fi':'Chill',
};
function normalizeGenre(g) { return GENRE_MAP[g] || g || ''; }

// ─── Déterminer les fichiers à importer ─────────────────────────────────────
const BATCHES_OUT  = join(__dirname, 'batches_out');
const BATCHES_DONE = join(__dirname, 'batches_done');
if (!existsSync(BATCHES_DONE)) mkdirSync(BATCHES_DONE);

let files;
if (process.argv.length > 2) {
  // Args explicites : node import_batches_out.mjs batch_024 batch_026
  files = process.argv.slice(2).map(a => {
    const name = a.endsWith('.json') ? a : `${a}_done.json`;
    return join(BATCHES_OUT, name);
  });
} else {
  // Auto : tous les *_done.json dans batches_out
  files = readdirSync(BATCHES_OUT)
    .filter(f => f.endsWith('_done.json'))
    .sort()
    .map(f => join(BATCHES_OUT, f));
}

if (files.length === 0) { console.log('Aucun fichier à importer.'); process.exit(0); }

console.log(`📦 ${files.length} fichier(s) à importer :\n${files.map(f => '  ' + basename(f)).join('\n')}\n`);

// ─── Normalisation fallbackHash ──────────────────────────────────────────────
function ns(s) {
  return (s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi,'')
    .replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'')
    .replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
}
function fallbackHash(title, artist) { return `${ns(title)}_${ns(artist)}`; }

// ─── Import ──────────────────────────────────────────────────────────────────
let totalIns=0, totalUpd=0, totalDup=0, totalSkip=0, totalErr=0;

for (const filePath of files) {
  if (!existsSync(filePath)) {
    console.warn(`⚠️  Fichier introuvable : ${filePath}`);
    continue;
  }

  const batchName = basename(filePath, '.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  const classifications = raw.classifications || raw;

  if (!Array.isArray(classifications) || classifications.length === 0) {
    console.warn(`⚠️  ${batchName} : aucune classification trouvée`);
    continue;
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📂 ${batchName} — ${classifications.length} tracks`);
  console.log(`${'─'.repeat(60)}`);

  let ins=0, upd=0, dup=0, skip=0, err=0;

  for (const c of classifications) {
    try {
      const rawId = String(c.id).trim();
      const deezerID = parseInt(rawId, 10);
      const isObjectId = /^[a-f0-9]{24}$/.test(rawId);

      if (!isObjectId && (!deezerID || isNaN(deezerID) || deezerID < 10)) {
        console.log(`  ⏭  Skip (id invalide) : ${JSON.stringify(c.id)}`);
        skip++; continue;
      }

      // Chercher le track existant (par ObjectId OU deezerID)
      let existing;
      if (isObjectId) {
        existing = await Track.findById(rawId);
      } else {
        existing = await Track.findOne({ 'providers.deezer.trackId': deezerID });
      }

      if (!existing) {
        console.log(`  ❓ Introuvable en DB (${isObjectId ? '_id: ' + rawId : 'deezerID: ' + deezerID}) → skip`);
        skip++; continue;
      }

      // Construire le payload de mise à jour
      const genre = normalizeGenre(c.genreBDD || existing.genre || '');
      const energy = typeof c.energy === 'number' ? c.energy : existing.energy;
      const bpm    = (c.bpm && c.bpm > 0) ? c.bpm : existing.bpm;

      // Phase mapping : party → peak (DJBrain utilise 'peak')
      const mapPhase = p => p === 'party' ? 'peak' : (p || 'ambiance');

      const update = {
        genre,
        bpm,
        energy,
        phase:          mapPhase(c.phase),
        phaseAlternate: mapPhase(c.phaseAlternate || ''),
        danceability:   typeof c.danceability === 'number' ? c.danceability : 0.6,
        isBanger:       c.isBanger || false,
        isSingalong:    c.isSingalong || false,
        isEmotional:    c.isEmotional || false,
        isCaliente:     c.isCaliente || false,
        isHardcore:     c.isHardcore || false,
        hasLyrics:      c.hasLyrics !== false,
        explicit:       c.explicit || false,
        adminQualified: true,
        // qualityLevel = champ lu par le Monitor V2
        qualityLevel:   existing.qualityLevel === 'platine' ? 'platine' : 'complete',
        lastReviewedAt: new Date(),
        // Métadonnées enrichies
        ...(c.era        && { era: c.era }),
        ...(c.mood       && { mood: c.mood }),
        ...(c.language   && { language: c.language }),
        ...(c.uiCategoryPrimary && { uiCategoryPrimary: c.uiCategoryPrimary }),
        ...(c.uiCategoriesSecondary?.length && { uiCategoriesSecondary: c.uiCategoriesSecondary }),
        ...(c.notes      && { notes: c.notes }),
      };

      await Track.updateOne({ _id: existing._id }, { $set: update });

      const phaseStr = `${mapPhase(c.phase)}${c.phaseAlternate ? '/'+mapPhase(c.phaseAlternate) : ''}`;
      const flags = [
        c.isBanger    ? '🔥' : '',
        c.isSingalong ? '🎤' : '',
        c.explicit    ? '🔞' : '',
      ].filter(Boolean).join('');
      console.log(`  ♻️  [${genre.padEnd(10)} | ${String(bpm).padStart(3)} BPM | E${energy} | ${phaseStr.padEnd(14)}] ${flags} ${existing.title} — ${existing.artist}`);
      upd++;

    } catch(e) {
      if (e.code === 11000) { console.log(`  ⚠️  DUPE: ${c.id}`); dup++; }
      else { console.error(`  ❌ ${c.id}: ${e.message}`); err++; }
    }
  }

  console.log(`  ── ${batchName}: ♻️ ${upd} upd | ⏭ ${skip} skip | ⚠️ ${dup} dup | ❌ ${err} err`);
  totalUpd+=upd; totalSkip+=skip; totalDup+=dup; totalErr+=err;

  // Déplacer vers batches_done après import réussi
  if (err === 0 && upd > 0) {
    try {
      renameSync(filePath, join(BATCHES_DONE, basename(filePath)));
      console.log(`  ✅ Déplacé → batches_done/`);
    } catch(e) {
      console.warn(`  ⚠️  Impossible de déplacer : ${e.message}`);
    }
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  🎉 RÉSUMÉ GLOBAL`);
console.log(`${'═'.repeat(60)}`);
console.log(`  Mis à jour  : ${totalUpd}`);
console.log(`  Skippés     : ${totalSkip}  (pas en DB — normaux si nouveau titre)`);
console.log(`  Doublons    : ${totalDup}`);
console.log(`  Erreurs     : ${totalErr}`);
console.log(`${'═'.repeat(60)}\n`);

await mongoose.disconnect();
process.exit(totalErr > 0 ? 1 : 0);
