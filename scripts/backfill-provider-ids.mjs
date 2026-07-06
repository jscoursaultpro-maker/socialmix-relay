/**
 * scripts/backfill-provider-ids.mjs
 * One-shot ISRC → providerIds backfill pour le catalogue SocialMix.
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-provider-ids.mjs --dry-run    (simulation)
 *   node --env-file=.env scripts/backfill-provider-ids.mjs              (écriture réelle)
 *   node --env-file=.env scripts/backfill-provider-ids.mjs --limit 50   (test sur 50 tracks)
 *
 * Idempotent: skip les tracks dont providerIdsResolvedAt < STALE_DAYS (30j).
 * Force re-run: node ... --force
 *
 * Sécurité:
 *   - MONGODB_URI depuis process.env uniquement
 *   - SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET depuis process.env (skip si absent)
 *   - APPLE_MUSIC_DEV_TOKEN depuis process.env (skip si absent)
 *   - Aucun secret dans les logs
 */

import mongoose from 'mongoose';
import { writeFileSync } from 'fs';
import {
  resolveDeezer,
  resolveSpotify,
  resolveAppleMusic,
  getSpotifyToken,
  BACKFILL_VERSION,
} from '../lib/providerResolver.mjs';
import Track from '../models/Track.js';

// ─── Config ───────────────────────────────────────────────────────────────────
const isDryRun  = process.argv.includes('--dry-run');
const isForce   = process.argv.includes('--force');
const limitArg  = process.argv.indexOf('--limit');
const limit     = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : null;
const STALE_DAYS    = 30;
const SLEEP_MS      = 250;   // rate limit entre tracks
const STALE_CUTOFF  = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Header ───────────────────────────────────────────────────────────────────
console.log('\n📀 SocialMix — Backfill providerIds via ISRC');
console.log(`   Mode      : ${isDryRun ? '🔵 DRY-RUN (aucune écriture DB)' : '🟢 LIVE (écriture DB)'}`);
console.log(`   Version   : ${BACKFILL_VERSION}`);
console.log(`   Stale cutoff : < ${STALE_DAYS}j → skip`);
if (limit) console.log(`   Limit     : ${limit} tracks`);
if (isForce) console.log('   Force re-run: oui (ignore providerIdsResolvedAt)');
console.log('');

// ─── Env checks ───────────────────────────────────────────────────────────────
const hasAppleToken   = !!process.env.APPLE_MUSIC_DEV_TOKEN;
const hasSpotifyCreds = !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

if (!hasAppleToken) {
  console.warn('⚠️  Apple Music skipped: APPLE_MUSIC_DEV_TOKEN missing.');
  console.warn('   → Créer task suivi: "Setup APPLE_MUSIC_DEV_TOKEN (JWT ES256 MusicKit) pour backfill V1.1"\n');
}
if (!hasSpotifyCreds) {
  console.warn('⚠️  Spotify skipped: SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET missing.\n');
}

// ─── Connect DB ───────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not set in environment. Aborting.');
  process.exit(1);
}

await mongoose.connect(MONGODB_URI, { dbName: 'socialmix' });
console.log('✅ MongoDB connecté\n');

// ─── Get Spotify token ────────────────────────────────────────────────────────
let spotifyToken = null;
if (hasSpotifyCreds) {
  console.log('🔑 Obtaining Spotify token (client_credentials)...');
  spotifyToken = await getSpotifyToken();
  if (spotifyToken) {
    console.log('✅ Spotify token obtained\n');
  } else {
    console.warn('⚠️  Spotify token request failed — Spotify will be skipped\n');
  }
}

// ─── Query: tracks with ISRC ──────────────────────────────────────────────────
const baseQuery = {
  isrc: { $ne: null, $exists: true, $ne: '' },
};

if (!isForce) {
  // Skip tracks already resolved recently
  baseQuery.$or = [
    { providerIdsResolvedAt: null },
    { providerIdsResolvedAt: { $lt: STALE_CUTOFF } },
  ];
}

let query = Track.find(baseQuery)
  .select('_id isrc title artist providers availableOn providerIdsResolvedAt')
  .lean();

if (limit) query = query.limit(limit);

const tracks = await query.exec();
const total = tracks.length;

console.log(`📋 Tracks à traiter : ${total} (avec ISRC, non résolus récemment)\n`);

if (total === 0) {
  console.log('✅ Rien à faire — tous les tracks récemment résolus.');
  await mongoose.disconnect();
  process.exit(0);
}

// ─── Stats ────────────────────────────────────────────────────────────────────
const stats = {
  processed: 0,
  skipped:   0,
  deezer:    { resolved: 0, notFound: 0, alreadySet: 0 },
  spotify:   { resolved: 0, notFound: 0, alreadySet: 0, skipped: 0 },
  apple:     { resolved: 0, notFound: 0, alreadySet: 0, skipped: 0 },
  errors:    [],
  orphans:   [],  // tracks où aucun provider trouvé
};

// ─── Main loop ────────────────────────────────────────────────────────────────
for (let i = 0; i < tracks.length; i++) {
  const track = tracks[i];
  const isrc = track.isrc;

  if (i > 0 && i % 50 === 0) {
    console.log(`   [${i}/${total}] ${stats.deezer.resolved} Deezer, ${stats.spotify.resolved} Spotify resolved so far...`);
  }

  const update = {
    availableOn: [...(track.availableOn || [])],
  };
  let anyResolved = false;

  // ── Deezer ────────────────────────────────────────────────────────
  if (track.providers?.deezer?.trackId) {
    stats.deezer.alreadySet++;
    if (!update.availableOn.includes('deezer')) update.availableOn.push('deezer');
    anyResolved = true;
  } else {
    const deezerResult = await resolveDeezer(isrc);
    if (deezerResult) {
      update['providers.deezer.trackId'] = deezerResult.trackId;
      if (deezerResult.albumId) update['providers.deezer.albumId'] = deezerResult.albumId;
      if (!update.availableOn.includes('deezer')) update.availableOn.push('deezer');
      stats.deezer.resolved++;
      anyResolved = true;
    } else {
      stats.deezer.notFound++;
    }
  }

  // ── Spotify ───────────────────────────────────────────────────────
  if (!spotifyToken) {
    stats.spotify.skipped++;
  } else if (track.providers?.spotify?.trackId) {
    stats.spotify.alreadySet++;
    if (!update.availableOn.includes('spotify')) update.availableOn.push('spotify');
    anyResolved = true;
  } else {
    const spotifyResult = await resolveSpotify(isrc, spotifyToken);
    if (spotifyResult) {
      update['providers.spotify.trackId'] = spotifyResult.trackId;
      if (!update.availableOn.includes('spotify')) update.availableOn.push('spotify');
      stats.spotify.resolved++;
      anyResolved = true;
    } else {
      stats.spotify.notFound++;
    }
  }

  // ── Apple Music ───────────────────────────────────────────────────
  if (!hasAppleToken) {
    stats.apple.skipped++;
  } else if (track.providers?.appleMusic?.trackId) {
    stats.apple.alreadySet++;
    if (!update.availableOn.includes('appleMusic')) update.availableOn.push('appleMusic');
    anyResolved = true;
  } else {
    const appleResult = await resolveAppleMusic(isrc);
    if (appleResult) {
      update['providers.appleMusic.trackId'] = appleResult.trackId;
      if (!update.availableOn.includes('appleMusic')) update.availableOn.push('appleMusic');
      stats.apple.resolved++;
      anyResolved = true;
    } else {
      stats.apple.notFound++;
    }
  }

  // ── Track orphelin ────────────────────────────────────────────────
  if (!anyResolved) {
    stats.orphans.push({
      isrc,
      title: track.title,
      artist: track.artist,
    });
  }

  // ── Write to DB ───────────────────────────────────────────────────
  update.providerIdsResolvedAt      = new Date();
  update.providerIdsResolvedVersion = BACKFILL_VERSION;

  if (!isDryRun) {
    try {
      await Track.updateOne({ _id: track._id }, { $set: update });
    } catch (err) {
      stats.errors.push({ isrc, error: err.message });
    }
  }

  stats.processed++;
  await sleep(SLEEP_MS);
}

// ─── Final report ─────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log(`📊 RAPPORT BACKFILL PROVIDER IDs — ${isDryRun ? 'DRY-RUN' : 'LIVE'}`);
console.log('══════════════════════════════════════════════════════');
console.log(`Tracks traités     : ${stats.processed} / ${total}`);
console.log('');
console.log(`Deezer   ✅ résolu : ${stats.deezer.resolved} (+${stats.deezer.alreadySet} déjà en base)`);
console.log(`Deezer   ❌ non trouvé : ${stats.deezer.notFound}`);
if (spotifyToken) {
  console.log(`Spotify  ✅ résolu : ${stats.spotify.resolved} (+${stats.spotify.alreadySet} déjà en base)`);
  console.log(`Spotify  ❌ non trouvé : ${stats.spotify.notFound}`);
} else {
  console.log(`Spotify  ⏭️  skipped (SPOTIFY_CLIENT_ID/SECRET manquant ou token failed)`);
}
if (hasAppleToken) {
  console.log(`Apple M. ✅ résolu : ${stats.apple.resolved} (+${stats.apple.alreadySet} déjà en base)`);
  console.log(`Apple M. ❌ non trouvé : ${stats.apple.notFound}`);
} else {
  console.log(`Apple M. ⏭️  skipped — task suivi: Setup APPLE_MUSIC_DEV_TOKEN (V1.1)`);
}
console.log('');
console.log(`Tracks orphelins (0 provider) : ${stats.orphans.length}`);
if (stats.errors.length > 0) {
  console.error(`Erreurs DB         : ${stats.errors.length}`);
}

if (isDryRun) {
  console.log('\n🔵 DRY-RUN terminé — aucune modification en base.');
  console.log('   Pour appliquer: node --env-file=.env scripts/backfill-provider-ids.mjs');
}

// ─── CSV orphelines ───────────────────────────────────────────────────────────
if (stats.orphans.length > 0) {
  const csvPath = `./backfill-orphans-${Date.now()}.csv`;
  const csvRows = ['isrc,title,artist', ...stats.orphans.map(o => `"${o.isrc}","${o.title.replace(/"/g, '""')}","${o.artist.replace(/"/g, '""')}"`)];
  if (!isDryRun) {
    writeFileSync(csvPath, csvRows.join('\n'));
    console.log(`\n📄 CSV orphelines écrit : ${csvPath}`);
  } else {
    console.log(`\n📄 CSV orphelines (dry-run, non écrit) : ${stats.orphans.length} tracks`);
    // Afficher les 10 premiers en preview
    console.log('   Preview (10 premiers):');
    stats.orphans.slice(0, 10).forEach(o => {
      console.log(`   - ${o.isrc} — ${o.title} / ${o.artist}`);
    });
  }
}

console.log('\n══════════════════════════════════════════════════════\n');

await mongoose.disconnect();
process.exit(stats.errors.length > 0 ? 1 : 0);
