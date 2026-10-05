// Resolve Apple Music trackId via iTunes Search API (ISRC lookup) — 06/10/2026.
// Target : les tracks éligibles DJ Brain (complete+platine, phase set, non blocked, non filler)
// qui ont un ISRC mais pas de providers.appleMusic.trackId.
//
// iTunes Search API : https://itunes.apple.com/lookup?isrc=XXX&entity=musicTrack
// - Pas de clé API, pas d'auth, publique.
// - Soft rate limit non documenté, ~20 req/sec safe. On fait 8 req/sec avec jitter.
// - User-Agent explicite "AhOuai-curation/1.0".
// - Pause 2 min toutes les 500 tracks (hygiène).
//
// Doctrine :
// - ISRC prime (match exact cross-platform, confiance maximale).
// - Jamais d'écrasement d'un appleMusic.trackId existant.
// - Jamais de touche à isVerified=true sans FORCE_VERIFIED=1.
// - Backup MigrationBackup_AppleMusicResolve avant chaque write.
// - Dry-run par défaut si DRY_RUN=1.
// - Populate aussi appleMusicMetadata si vide (releaseDate, genreNames, artworkUrl).
//
// Usage :
//   DRY_RUN=1 node scripts/curation/resolve_apple_music_isrc_2026-10-06.mjs
//   LIMIT=50 node scripts/curation/resolve_apple_music_isrc_2026-10-06.mjs
//   node scripts/curation/resolve_apple_music_isrc_2026-10-06.mjs

import mongoose from 'mongoose';
import { connectMongo } from './lib.mjs';

const DRY = process.env.DRY_RUN === '1';
const FORCE_VERIFIED = process.env.FORCE_VERIFIED === '1';
const LIMIT = Number(process.env.LIMIT || 0);
const MIN_INTERVAL_MS = Number(process.env.APPLE_MIN_INTERVAL_MS || 125);  // ~8 req/sec
const PAUSE_EVERY = Number(process.env.PAUSE_EVERY || 500);
const PAUSE_MS = Number(process.env.PAUSE_MS || 120000);  // 2 min

const USER_AGENT = 'AhOuai-curation/1.0 (contact@ahouai.com)';

let lastCall = 0;
async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait + Math.random() * 50));
  lastCall = Date.now();
}

async function itunesFetch(url) {
  await throttle();
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
  if (res.status === 403 || res.status === 429) {
    console.error(`⚠️  Status ${res.status} on ${url} — pausing 30s`);
    await new Promise(r => setTimeout(r, 30000));
    return null;
  }
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

function pickSong(results) {
  if (!results?.length) return null;
  return results.find(r => (r.kind === 'song' || r.wrapperType === 'track') && r.trackId) || null;
}

async function appleLookup(isrc, title, artist) {
  // Country based on ISRC country code prefix (2 letters)
  const country = (isrc || '').substring(0, 2).toLowerCase() || 'us';
  // Try 1: lookup?isrc with country matching ISRC prefix
  const u1 = `https://itunes.apple.com/lookup?isrc=${encodeURIComponent(isrc)}&entity=musicTrack&country=${country}&limit=5`;
  let data = await itunesFetch(u1);
  let song = pickSong(data?.results);
  if (song) return { song, via: `lookup_isrc_${country}` };
  // Try 2: lookup?isrc fallback US
  if (country !== 'us') {
    const u1b = `https://itunes.apple.com/lookup?isrc=${encodeURIComponent(isrc)}&entity=musicTrack&country=us&limit=5`;
    data = await itunesFetch(u1b);
    song = pickSong(data?.results);
    if (song) return { song, via: 'lookup_isrc_us_fallback' };
  }
  // Try 3: search by title+artist (fuzzy)
  if (title && artist) {
    const term = `${title} ${artist}`.replace(/\s+/g, ' ').trim();
    const u2 = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=musicTrack&limit=10&media=music`;
    data = await itunesFetch(u2);
    song = pickSong(data?.results);
    if (song) return { song, via: 'search_term' };
  }
  return { song: null, via: 'none' };
}

// Connect MongoDB
const db = await connectMongo();
const tracks = db.collection('tracks');
const backup = db.collection('MigrationBackup_AppleMusicResolve');

// Query cible : pool éligible DJ Brain avec ISRC et sans Apple ID
const query = {
  isrc: { $exists: true, $nin: [null, ''] },
  qualityLevel: { $in: ['complete', 'platine'] },
  phase: { $ne: null },
  isBlocked: { $ne: true },
  isFiller: { $ne: true },
  'providers.appleMusic.trackId': { $in: [null, ''] },
  $or: [{ appleMusicID: { $in: [null, ''] } }, { appleMusicID: { $exists: false } }],
};
if (!FORCE_VERIFIED) query.isVerified = { $ne: true };

const cursor = tracks.find(query, {
  projection: { _id: 1, title: 1, artist: 1, isrc: 1, appleMusicMetadata: 1, 'providers.appleMusic': 1 },
}).sort({ deezerRank: -1 });  // commence par les plus populaires

const total = await tracks.countDocuments(query);
console.log(`🎯 ${total} tracks à résoudre côté Apple Music (ISRC lookup).`);
if (LIMIT) console.log(`   LIMIT=${LIMIT} → traitement partiel.`);
if (DRY) console.log(`   DRY_RUN=1 → aucun write.`);

// Instrumentation : write a run start log doc
const runId = `apple_music_${Date.now()}`;
const runLog = db.collection('ProvidersResolveRunLog');
await runLog.insertOne({ runId, kind: 'start', total, limit: LIMIT, dry: DRY, at: new Date() });

let processed = 0, matched = 0, nomatch = 0, skipped = 0, errors = 0;

for await (const t of cursor) {
  if (LIMIT && processed >= LIMIT) break;
  processed++;

  if (processed > 0 && processed % PAUSE_EVERY === 0) {
    console.log(`\n⏸️  Pause ${PAUSE_MS / 1000}s (hygiène rate limit — ${processed}/${total}) …\n`);
    await new Promise(r => setTimeout(r, PAUSE_MS));
  }

  try {
    const { song, via } = await appleLookup(t.isrc, t.title, t.artist);
    // Log sample attempts
    if (processed <= 10) {
      await runLog.insertOne({ runId, kind: 'attempt', processed, isrc: t.isrc, title: t.title?.slice(0,40), artist: t.artist?.slice(0,30), gotSong: !!song, trackId: song?.trackId || null, via, at: new Date() });
    }
    if (!song || !song.trackId) {
      nomatch++;
      if (processed % 50 === 0) console.log(`  … ${processed}/${total}  matched=${matched} nomatch=${nomatch}`);
      continue;
    }

    const set = {
      'providers.appleMusic.trackId': String(song.trackId),
    };
    // Enrichir appleMusicMetadata si vide
    if (!t.appleMusicMetadata?.releaseDate) {
      set['appleMusicMetadata.genreNames'] = song.primaryGenreName ? [song.primaryGenreName] : [];
      set['appleMusicMetadata.releaseDate'] = song.releaseDate || null;
      set['appleMusicMetadata.previewUrl'] = song.previewUrl || null;
      set['appleMusicMetadata.artworkUrl'] = song.artworkUrl100 || song.artworkUrl60 || null;
      set['appleMusicMetadata.durationInMillis'] = song.trackTimeMillis || 0;
    }

    if (DRY) {
      console.log(`  [DRY] ${t.artist} — ${t.title}  →  appleMusic=${song.trackId}  (${song.primaryGenreName || '?'})`);
      matched++;
      continue;
    }

    await backup.insertOne({
      _snapshotAt: new Date(),
      _hotfix: 'resolve_apple_music_isrc_2026-10-06',
      _originalId: t._id,
      doc: { _id: t._id, title: t.title, artist: t.artist, isrc: t.isrc, apple_before: t.providers?.appleMusic ?? null },
    });

    const r = await tracks.updateOne({ _id: t._id }, { $set: set });
    if (r.modifiedCount === 1) {
      matched++;
      if (matched % 50 === 0) console.log(`  ✓ ${matched} matched / ${processed} processed`);
    } else {
      skipped++;
    }
  } catch (err) {
    errors++;
    if (errors < 5) console.error(`  ❌ ${t.title}: ${err.message}`);
  }
}

console.log(`\n═══════════════════════════════════════════════`);
console.log(`✓ Done. Processed: ${processed}  Matched: ${matched}  NoMatch: ${nomatch}  Skipped: ${skipped}  Errors: ${errors}`);
console.log(`  Coverage gain : +${matched} tracks avec Apple Music trackId.`);

await runLog.insertOne({ runId, kind: 'end', processed, matched, nomatch, skipped, errors, at: new Date() });
await mongoose.disconnect();
