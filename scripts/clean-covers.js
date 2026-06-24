#!/usr/bin/env node
/**
 * clean-covers.js — Script anti-covers BDD AhOuai
 * ─────────────────────────────────────────────────────────────────────────────
 * Détecte et bloque les covers/tributes/karaoke dans la collection `tracks`
 * quand l'original est déjà présent en base.
 *
 * Usage (toujours avec --env-file=.env pour charger MONGODB_URI) :
 *   node --env-file=.env scripts/clean-covers.js             # dry-run (défaut)
 *   node --env-file=.env scripts/clean-covers.js --apply     # backup + blocage
 *   node --env-file=.env scripts/clean-covers.js --restore   # annulation
 *
 * Note: si dotenv est installé, remplace --env-file=.env par
 *   `import 'dotenv/config'` en tête de fichier.
 *
 * Doctrine sécurité :
 *   - AUCUN mot de passe dans ce fichier
 *   - process.env.MONGODB_URI est lu depuis le contexte de lancement
 *   - Les tracks adminQualified=true ne sont JAMAIS bloqués automatiquement
 *   - Backup JSON systématique avant --apply
 *   - Idempotent : --apply 2× = même résultat
 */

import mongoose from 'mongoose';
import fs       from 'fs';
import path     from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ────────────────────────────────────────────────────────────

const SCRIPT_TAG  = 'script:clean-covers.js';
const BACKUP_DIR  = path.join(__dirname, '../.backups/2026-06-25/anti-covers');

// DÉCISION 2026-06-25 (Jean-Sé) : --apply traite UNIQUEMENT confidence=HIGH
// Raison : la Passe B (titre matching) génère trop de faux positifs MEDIUM
// (remixes légitimes, featurings, titres génériques courts).
// Les MEDIUM et REVIEW restent en SECTION 2 pour validation manuelle.
// La Passe A (regex explicites) est le seul chemin vers un blocage automatique.
const APPLY_MIN_CONFIDENCE = 'HIGH';

// Passe A — Regex sur titre : couvertures auto-déclarées (haute précision)
const COVER_TITLE_REGEX = new RegExp(
  [
    'karaoke',
    'tribute',
    'originally\\s+performed',
    'in\\s+the\\s+style\\s+of',
    'made\\s+famous\\s+by',
    'coverversion',
    'cover\\s+version',
    'instrumental\\s+version',
    'as\\s+performed\\s+by',
    'im\\s+original\\s+von',  // variante allemande vue en BDD
  ].join('|'),
  'i'
);

// Passe A — Regex sur artiste : noms d'artistes typiquement covers
const COVER_ARTIST_REGEX = /\b(karaoke|tribute)\b/i;

// ─── Connexion ────────────────────────────────────────────────────────────────

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌  MONGODB_URI absent de l\'environnement.');
    console.error('    Lancer avec : node --env-file=.env scripts/clean-covers.js');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('✅  MongoDB connecté');
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalise un titre pour comparaison inter-tracks :
 *   - lowercase
 *   - supprime les parenthèses/crochets et leur contenu (feat., Karaoke, etc.)
 *   - réduit la ponctuation et les espaces
 */
function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/\s*[\(\[].+?[\)\]]\s*/g, ' ')    // (Originally by X), [Karaoke]
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalise un nom d'artiste :
 *   - lowercase
 *   - supprime l'article "the" en tête (The Rock Masters → rock masters)
 *   - réduit la ponctuation
 */
function normalizeArtist(artist) {
  return (artist || '')
    .toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Logique confiance via deezerRank ─────────────────────────────────────────
//
// Sur Deezer : rank BAS = plus populaire (ex: rank 7400 = Stromae Formidable).
// candidateRank / originalRank :
//   > 10  → original 10× plus populaire  → HIGH
//   ≥  3  → original clairement plus pop → MEDIUM
//   ≥  1  → original légèrement plus pop → MEDIUM
//   <  1  → cover "semble plus pop" que l'original → probablement versions
//            différentes du même titre (trackId Deezer différent), pas fiable
//            → REVIEW (sécurité)

function evaluateRankConfidence(candidateRank, originalRank) {
  if (!candidateRank || !originalRank || candidateRank === 0 || originalRank === 0) {
    return 'MEDIUM';  // données manquantes → confiance par défaut
  }
  const ratio = candidateRank / originalRank;
  if (ratio > 10) return 'HIGH';
  if (ratio >= 1) return 'MEDIUM';   // original plus populaire (ratio ≥ 1 ou ≥ 3)
  return 'REVIEW';                   // ratio < 1 → incertain, données trackId probablement différentes
}

// ─── Scan principal ───────────────────────────────────────────────────────────

async function scan() {
  const db = mongoose.connection.db;

  // Charger tous les tracks en RAM : 2610 tracks ≈ 1–2 MB, gérable en mémoire
  const allTracks = await db.collection('tracks').find({}).toArray();
  console.log(`📦  ${allTracks.length} tracks chargés en mémoire\n`);

  const toBan       = [];  // blocage automatique (adminQualified=false uniquement)
  const toReview    = [];  // validation manuelle
  const processedIds = new Set();

  // ──────────────────────────────────────────────────────────────────────────
  // PASSE A — Regex explicites (covers auto-déclarées dans titre ou artiste)
  // ──────────────────────────────────────────────────────────────────────────
  for (const track of allTracks) {
    const titleMatch  = COVER_TITLE_REGEX.test(track.title);
    const artistMatch = COVER_ARTIST_REGEX.test(track.artist);

    if (!titleMatch && !artistMatch) continue;

    processedIds.add(String(track._id));

    // Identifier le keyword qui a matché
    const matchedKeyword = titleMatch
      ? (track.title.match(COVER_TITLE_REGEX) || [])[0]
      : (track.artist.match(COVER_ARTIST_REGEX) || [])[0];
    const matchZone = titleMatch ? 'titre' : 'artiste';

    // Chercher un original potentiel : même titre normalisé, adminQualified=true,
    // artiste différent
    const normTitle  = normalizeTitle(track.title);
    const normArtist = normalizeArtist(track.artist);
    const original   = allTracks.find(t =>
      String(t._id) !== String(track._id) &&
      t.adminQualified === true &&
      normalizeTitle(t.title) === normTitle &&
      normalizeArtist(t.artist) !== normArtist
    );

    const entry = {
      _id:            track._id,
      title:          track.title,
      artist:         track.artist,
      deezerRank:     track.deezerRank || 0,
      adminQualified: !!track.adminQualified,
      isBlocked:      !!track.isBlocked,
      cause:          `Passe A — regex "${matchedKeyword}" dans ${matchZone}`,
      confidence:     'HIGH',
      rankRatio:      null,
      original:       original
        ? { title: original.title, artist: original.artist, deezerRank: original.deezerRank || 0 }
        : null,
    };

    if (track.adminQualified) {
      // Doctrine : jamais bloquer auto un track qualifié manuellement
      toReview.push({ ...entry, reviewReason: 'adminQualified=true — décision manuelle requise' });
    } else {
      toBan.push(entry);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PASSE B — Matching par titre normalisé (covers silencieuses)
  //   Pour chaque groupe de tracks partageant le même titre normalisé :
  //     - S'il existe au moins un original adminQualified=true
  //     - Et un candidat avec artiste différent
  //     → Candidat cover potentiel, décision via adminQualified + rank
  // ──────────────────────────────────────────────────────────────────────────

  // Index par titre normalisé
  const byNormTitle = new Map();
  for (const track of allTracks) {
    const key = normalizeTitle(track.title);
    if (!key || key.length < 4) continue;   // titres trop courts = trop de faux positifs
    if (!byNormTitle.has(key)) byNormTitle.set(key, []);
    byNormTitle.get(key).push(track);
  }

  for (const [normTitle, group] of byNormTitle.entries()) {
    if (group.length < 2) continue;  // pas de doublon → rien à faire

    // Au moins un original qualifié dans le groupe ?
    const qualifiedOriginals = group.filter(t => t.adminQualified === true);
    if (qualifiedOriginals.length === 0) continue;

    for (const track of group) {
      if (processedIds.has(String(track._id))) continue;  // déjà traité en Passe A

      const normArtist = normalizeArtist(track.artist);

      // Original = adminQualified=true + artiste différent + rank le plus bas (populaire)
      const candidatesOriginal = qualifiedOriginals.filter(t =>
        String(t._id) !== String(track._id) &&
        normalizeArtist(t.artist) !== normArtist
      );

      if (candidatesOriginal.length === 0) continue;  // même artiste → pas une cover

      // Choisir l'original le plus populaire (rank le plus bas, en excluant rank=0)
      const original = candidatesOriginal.sort((a, b) => {
        const ra = a.deezerRank > 0 ? a.deezerRank : 9999999;
        const rb = b.deezerRank > 0 ? b.deezerRank : 9999999;
        return ra - rb;
      })[0];

      processedIds.add(String(track._id));

      const cRank    = track.deezerRank   > 0 ? track.deezerRank   : null;
      const oRank    = original.deezerRank > 0 ? original.deezerRank : null;
      const rankConf = evaluateRankConfidence(cRank, oRank);
      const ratio    = (cRank && oRank) ? (cRank / oRank).toFixed(1) + '×' : 'N/A';

      const entry = {
        _id:            track._id,
        title:          track.title,
        artist:         track.artist,
        deezerRank:     track.deezerRank || 0,
        adminQualified: !!track.adminQualified,
        isBlocked:      !!track.isBlocked,
        cause:          `Passe B — même titre normalisé "${normTitle}"`,
        confidence:     rankConf,
        rankRatio:      ratio,
        original:       { title: original.title, artist: original.artist, deezerRank: original.deezerRank || 0 },
      };

      if (track.adminQualified) {
        // Deux tracks qualifiés, même titre, artistes différents → ambiguité
        toReview.push({ ...entry, reviewReason: 'adminQualified=true — 2 versions qualifiées du même titre' });
      } else if (rankConf === 'REVIEW') {
        toReview.push({ ...entry, reviewReason: `rank ratio ${ratio} < 1 (trackId Deezer possiblement incohérent)` });
      } else {
        // adminQualified=false + confidence HIGH ou MEDIUM → ban automatique
        toBan.push(entry);
      }
    }
  }

  return { toBan, toReview, total: allTracks.length };
}

// ─── Affichage du rapport ─────────────────────────────────────────────────────

function printReport({ toBan, toReview, total }) {
  const line1 = '\u2550'.repeat(57);
  const line2 = '\u2500'.repeat(57);

  const toBanHigh   = toBan.filter(t => t.confidence === 'HIGH');
  const toBanMedium = toBan.filter(t => t.confidence !== 'HIGH');

  console.log(`\n\uD83D\uDD0D ANTI-COVERS SCAN \u2014 DRY RUN`);
  console.log(line1);
  console.log(`\uD83D\uDCCA Total tracks scann\u00e9s    : ${total}`);
  console.log(`\uD83D\uDEA8 \u00c0 bloquer par --apply    : ${toBanHigh.length}  (confidence HIGH uniquement)`);
  console.log(`\uD83D\uDFE1 \u00c0 valider manuellement   : ${toBanMedium.length + toReview.length}  (MEDIUM + REVIEW)`);
  console.log(`\u2705 Inchang\u00e9s               : ${total - toBan.length - toReview.length}`);

  // \u2500\u2500 SECTION 1A : HIGH (seront appliqu\u00e9s par --apply) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  console.log(`\n\uD83D\uDEA8 SECTION 1A \u2014 BLOCAGES AUTO (confidence HIGH \u2192 seront appliqu\u00e9s par --apply)`);
  console.log(`   ${toBanHigh.length} track(s) \u2014 adminQualified=false \u2014 Passe A regex uniquement`);
  console.log(line2);

  if (toBanHigh.length === 0) {
    console.log('  (aucun blocage HIGH d\u00e9tect\u00e9)');
  } else {
    toBanHigh.forEach((t, i) => {
      const already = t.isBlocked ? ' [d\u00e9j\u00e0 bloqu\u00e9]' : '';
      console.log(`\n  [${i + 1}] "${t.title}" \u2014 ${t.artist}${already}`);
      console.log(`       Cause      : ${t.cause}`);
      console.log(`       Confidence : ${t.confidence}  \u2192 SERA BLOQU\u00c9 par --apply`);
      if (t.original) {
        console.log(`       Original   : "${t.original.title}" \u2014 ${t.original.artist}`);
      }
    });
  }

  // \u2500\u2500 SECTION 1B : MEDIUM (NE seront PAS appliqu\u00e9s) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  console.log(`\n\uD83D\uDFE1 SECTION 1B \u2014 MEDIUM (confidence MEDIUM \u2192 ignor\u00e9s par --apply, review manuel)`);
  console.log(`   ${toBanMedium.length} track(s) \u2014 Passe B titre-matching \u2014 trop de faux positifs pour auto-ban`);
  console.log(line2);

  if (toBanMedium.length === 0) {
    console.log('  (aucun cas MEDIUM)');
  } else {
    toBanMedium.slice(0, 10).forEach((t, i) => {
      console.log(`\n  [${i + 1}] "${t.title}" \u2014 ${t.artist}`);
      console.log(`       Cause      : ${t.cause}`);
      console.log(`       Confidence : ${t.confidence}  |  ratio: ${t.rankRatio || 'N/A'}`);
      if (t.original) {
        console.log(`       Original   : "${t.original.title}" \u2014 ${t.original.artist}`);
      }
    });
    if (toBanMedium.length > 10) {
      console.log(`\n  ... et ${toBanMedium.length - 10} autres MEDIUM (voir dry-run complet)`);
    }
  }

  // \u2500\u2500 SECTION 2 : REVIEW \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  console.log(`\n\uD83D\uDFE1 SECTION 2 \u2014 REVIEW MANUELLE (adminQualified=true ou rank ratio incohérent)`);
  console.log(`   ${toReview.length} track(s) \u2014 jamais modifi\u00e9s par --apply`);
  console.log(line2);

  if (toReview.length === 0) {
    console.log('  (aucun cas ambigu d\u00e9tect\u00e9)');
  } else {
    // Trier par \u00e9vidence : adminQualified d'abord, puis ratio le plus \u00e9lev\u00e9
    const sorted = [...toReview].sort((a, b) => {
      // Priorit\u00e9 aux cas adminQualified=true (d\u00e9cision humaine urgente)
      if (!a.adminQualified && b.adminQualified) return -1;
      if (a.adminQualified && !b.adminQualified) return 1;
      // Puis par ratio d\u00e9croissant (plus \u00e9vident en premier)
      const ra = parseFloat(a.rankRatio) || 0;
      const rb = parseFloat(b.rankRatio) || 0;
      return rb - ra;
    });
    sorted.slice(0, 15).forEach((t, i) => {
      console.log(`\n  [${i + 1}] "${t.title}" \u2014 ${t.artist} [adminQualified: ${t.adminQualified}]`);
      console.log(`       Cause      : ${t.cause}`);
      console.log(`       Confidence : ${t.confidence}  |  ratio: ${t.rankRatio || 'N/A'}`);
      console.log(`       Raison     : ${t.reviewReason}`);
      if (t.original) {
        console.log(`       Original   : "${t.original.title}" \u2014 ${t.original.artist}`);
      }
    });
    if (toReview.length > 15) {
      console.log(`\n  ... et ${toReview.length - 15} autres REVIEW`);
    }
  }

  // \u2500\u2500 R\u00c9SUM\u00c9 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  console.log(`\n${line1}`);
  console.log(`\uD83D\uDCCB R\u00c9SUM\u00c9 FINAL`);
  console.log(`   \u2022 Bloqu\u00e9s par --apply (HIGH) : ${toBanHigh.length} tracks  \u2190 action imm\u00e9diate`);
  console.log(`   \u2022 MEDIUM (review Passe B)   : ${toBanMedium.length} tracks  \u2190 post-mortem`);
  console.log(`   \u2022 REVIEW (adminQual./rank)  : ${toReview.length} tracks  \u2190 d\u00e9cision manuelle`);
  console.log(`   \u2022 Inchang\u00e9s                 : ${total - toBan.length - toReview.length} tracks`);
  console.log(`\n   Pour appliquer les ${toBanHigh.length} blocages HIGH :`);
  console.log(`   node --env-file=.env scripts/clean-covers.js --apply`);
  console.log(`\n   Pour annuler (restore) :`);
  console.log(`   node --env-file=.env scripts/clean-covers.js --restore`);
  console.log(`\n   Les MEDIUM et REVIEW restent intacts jusqu\'\u00e0 validation manuelle de Jean-S\u00e9.`);
}

// ─── Apply ────────────────────────────────────────────────────────────────────

async function applyBan(toBanAll) {
  // Filtre : --apply ne traite que les tracks HIGH-confidence (décision 2026-06-25)
  const toBan = toBanAll.filter(t => t.confidence === APPLY_MIN_CONFIDENCE);
  const skippedByConf = toBanAll.length - toBan.length;

  if (skippedByConf > 0) {
    console.log(`\nℹ️   ${skippedByConf} tracks MEDIUM ignorés par --apply (confidence < HIGH).`);
    console.log('    Utilisez la SECTION 2 du dry-run pour les valider manuellement.');
  }

  if (toBan.length === 0) {
    console.log('ℹ️   Aucun track HIGH à bloquer — nothing to do.');
    return;
  }
  console.log(`\n⚡  Application sur ${toBan.length} tracks HIGH uniquement...`);

  const db  = mongoose.connection.db;
  const ids = toBan.map(t => t._id);

  // 1. Backup JSON AVANT modification (obligatoire)
  const beforeDocs  = await db.collection('tracks').find({ _id: { $in: ids } }).toArray();
  const backupPath  = path.join(BACKUP_DIR, 'before-apply-high-only.json');
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(beforeDocs, null, 2), 'utf-8');
  console.log(`💾  Backup JSON → ${backupPath}  (${beforeDocs.length} tracks)`);

  // 2. Mise à jour MongoDB — idempotente ($set pur)
  const now       = new Date().toISOString();
  let updated     = 0;
  let skipped     = 0;

  for (const track of toBan) {
    // Résoudre l'_id de l'original en BDD si possible
    let originalId = null;
    if (track.original) {
      const orig = await db.collection('tracks').findOne(
        {
          title:          { $regex: new RegExp('^' + track.original.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') },
          artist:         { $regex: new RegExp('^' + track.original.artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') },
          adminQualified: true,
        },
        { projection: { _id: 1 } }
      );
      if (orig) originalId = orig._id;
    }

    const result = await db.collection('tracks').updateOne(
      { _id: track._id },
      {
        $set: {
          isBlocked:         true,
          blockedReason:     track.cause,
          blockedBy:         SCRIPT_TAG,
          blockedAt:         now,
          blockedOriginalId: originalId,
          blockedConfidence: track.confidence,
        },
      }
    );

    if (result.modifiedCount > 0) {
      updated++;
      console.log(`  🚫 Bloqué  : "${track.title}" — ${track.artist}`);
    } else {
      skipped++;
      console.log(`  ↩️  Skip    : "${track.title}" — ${track.artist} (déjà bloqué ou introuvable)`);
    }
  }

  console.log(`\n✅  ${updated} tracks marqués isBlocked=true`);
  if (skipped > 0) console.log(`   (${skipped} skippés — déjà bloqués, idempotent)`);
}

// ─── Restore ──────────────────────────────────────────────────────────────────

async function restoreBlocked() {
  const db = mongoose.connection.db;

  const toRestore = await db.collection('tracks').find({ blockedBy: SCRIPT_TAG }).toArray();
  if (toRestore.length === 0) {
    console.log('ℹ️   Aucun track bloqué par ce script — nothing to restore.');
    return;
  }

  // Backup avant restore
  const backupPath = path.join(BACKUP_DIR, `before-restore-${Date.now()}.json`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(toRestore, null, 2), 'utf-8');
  console.log(`💾  Backup avant restore → ${backupPath}  (${toRestore.length} tracks)`);

  const result = await db.collection('tracks').updateMany(
    { blockedBy: SCRIPT_TAG },
    {
      $set:   { isBlocked: false },
      $unset: {
        blockedReason:     '',
        blockedBy:         '',
        blockedAt:         '',
        blockedOriginalId: '',
        blockedConfidence: '',
      },
    }
  );

  console.log(`🔄  Restore terminé : ${result.modifiedCount} tracks remis à isBlocked=false`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = args.includes('--apply')   ? 'apply'
           : args.includes('--restore') ? 'restore'
           : 'dry-run';

console.log(`\n🚀  clean-covers.js — mode: ${mode.toUpperCase()}`);
if (mode === 'dry-run') {
  console.log('    (aucune écriture en base — utilisez --apply pour appliquer)');
}

await connectDB();

if (mode === 'restore') {
  await restoreBlocked();
} else {
  const result = await scan();
  printReport(result);

  if (mode === 'apply') {
    console.log('\n⚡  Passage en mode --apply...');
    await applyBan(result.toBan);
  }
}

await mongoose.disconnect();
console.log('\n👋  Déconnecté.');
process.exit(0);
