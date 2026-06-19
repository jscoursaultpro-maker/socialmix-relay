/**
 * enrich_spotify.mjs
 *
 * Enrichit curated_base_v3.json avec Spotify Audio Features
 * Champs ajoutés : spotifyID, spotify.energy/danceability/valence/tempo/acousticness/loudness
 *
 * Règles de sécurité :
 *   - BPM existant JAMAIS écrasé (insert only)
 *   - Energy mise à jour depuis Spotify (plus précise que le calcul BPM)
 *   - 1200ms entre chaque recherche (évite le ban)
 *   - 3000ms entre chaque batch de features
 *   - Sauvegarde incrémentale tous les 50 tracks
 *   - Reprise automatique (tracks déjà enrichis skippés)
 */

import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SPOTIFY_CLIENT_ID     = '2c7bee5534134542adce16efcf986fb4';
const SPOTIFY_CLIENT_SECRET = '6d710f4e0bb34a7b815b07332b66eb30';
const DB_PATH               = path.join(__dirname, './curated_base_v3.json');

// ── Délais ultra-sécurisés ───────────────────────────────
const SEARCH_DELAY_MS   = 3000;  // 3s entre chaque recherche
const FEATURES_DELAY_MS = 5000;  // 5s entre chaque batch de features
const SAVE_EVERY        = 25;    // sauvegarder tous les 25 tracks

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Auth ──────────────────────────────────────────────────
async function getSpotifyToken() {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const req = https.request({
      hostname: 'accounts.spotify.com', port: 443,
      path: '/api/token', method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(d).access_token);
        else reject(new Error(`Spotify auth failed ${res.statusCode}: ${d}`));
      });
    });
    req.on('error', reject);
    req.write('grant_type=client_credentials');
    req.end();
  });
}

// ── HTTP helper ───────────────────────────────────────────
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 429) {
          const wait = parseInt(res.headers['retry-after'] || '30') * 1000;
          console.log(`  ⚠️  Rate limited — attente ${wait/1000}s...`);
          resolve({ _rateLimited: true, wait });
          return;
        }
        if (res.statusCode !== 200) {
          resolve({ _error: res.statusCode });
          return;
        }
        try { resolve(JSON.parse(d)); }
        catch { resolve({ _error: 'parse' }); }
      });
    }).on('error', reject);
  });
}

// ── Search Spotify ────────────────────────────────────────
async function searchSpotify(title, artist, token) {
  // Essai 1 : exact (track: + artist:)
  const q1 = encodeURIComponent(`track:${title} artist:${artist}`);
  let res = await httpsGet(
    `https://api.spotify.com/v1/search?q=${q1}&type=track&limit=1`,
    { 'Authorization': `Bearer ${token}` }
  );
  if (res._rateLimited) { await sleep(res.wait + 2000); return searchSpotify(title, artist, token); }
  if (res.tracks?.items?.length > 0) {
    const t = res.tracks.items[0];
    return { id: t.id, isrc: t.external_ids?.isrc || '', popularity: t.popularity || 0 };
  }

  // Essai 2 : loose
  await sleep(500);
  const q2 = encodeURIComponent(`${title} ${artist}`);
  res = await httpsGet(
    `https://api.spotify.com/v1/search?q=${q2}&type=track&limit=1`,
    { 'Authorization': `Bearer ${token}` }
  );
  if (res._rateLimited) { await sleep(res.wait + 2000); return null; }
  if (res.tracks?.items?.length > 0) {
    const t = res.tracks.items[0];
    return { id: t.id, isrc: t.external_ids?.isrc || '', popularity: t.popularity || 0 };
  }

  return null;
}

// ── Audio Features (batch 100) ────────────────────────────
async function getAudioFeatures(ids, token) {
  const res = await httpsGet(
    `https://api.spotify.com/v1/audio-features?ids=${ids.join(',')}`,
    { 'Authorization': `Bearer ${token}` }
  );
  if (res._rateLimited) {
    await sleep(res.wait + 2000);
    return getAudioFeatures(ids, token);
  }
  return res.audio_features || [];
}

// ── Save DB (Safe Merge) ──────────────────────────────────
function saveDB(memoryTracks) {
  try {
    const freshDb = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    
    // Merge memory spotify updates into fresh tracks
    const map = new Map(memoryTracks.map(t => [t.deezerID, t]));
    for (const t of freshDb.tracks) {
      const mem = map.get(t.deezerID);
      if (mem && mem.spotifyID) {
        t.spotifyID = mem.spotifyID;
        if (mem.isrc) t.isrc = mem.isrc;
        if (mem.spotifyPopularity) t.spotifyPopularity = mem.spotifyPopularity;
        if (mem.energy && mem.energy > 0) t.energy = mem.energy;
        if (mem.bpm && mem.bpm > 0 && (!t.bpm || t.bpm === 0)) t.bpm = mem.bpm;
        if (mem.spotify) t.spotify = mem.spotify;
      }
    }
    
    freshDb.generatedAt = new Date().toISOString();
    fs.writeFileSync(DB_PATH, JSON.stringify(freshDb, null, 2));
  } catch (e) {
    console.error('❌ Save error:', e);
  }
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  SPOTIFY ENRICHMENT — curated_base_v3.json');
  console.log('═'.repeat(60));

  const db     = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  const tracks = db.tracks || [];

  const toSearch   = tracks.filter(t => !t.spotifyID);
  const toFeatures = tracks.filter(t => !!t.spotifyID && !t.spotify?.danceability);

  console.log(`  Total           : ${tracks.length}`);
  console.log(`  Déjà Spotify ID : ${tracks.filter(t => t.spotifyID).length}`);
  console.log(`  À rechercher    : ${toSearch.length}`);
  console.log(`  À enrichir (features): ${toFeatures.length}`);
  console.log(`  Délai recherche : ${SEARCH_DELAY_MS}ms / track\n`);

  let token = await getSpotifyToken();
  console.log('  ✅ Token Spotify OK\n');

  // ─ Phase 1 : Recherche Spotify IDs ──────────────────────
  if (toSearch.length > 0) {
    console.log(`── PHASE 1 : Recherche des Spotify IDs (${toSearch.length} tracks) ──`);
    const eta = Math.round(toSearch.length * (SEARCH_DELAY_MS + 500) / 60000);
    console.log(`  Délai / track   : ${SEARCH_DELAY_MS/1000}s + 0.5s fallback = très safe\n`);
    console.log(`  ETA estimé      : ~${eta} minutes\n`);

    let found = 0, notFound = 0;
    for (let i = 0; i < toSearch.length; i++) {
      const t = toSearch[i];

      // Refresh token toutes les 800 tracks (~16min)
      if (i > 0 && i % 800 === 0) {
        token = await getSpotifyToken();
        console.log('  🔄 Token Spotify rafraîchi');
      }

      const result = await searchSpotify(t.title, t.artist, token);
      if (result) {
        t.spotifyID = result.id;
        if (!t.isrc && result.isrc) t.isrc = result.isrc;
        if (result.popularity > 0) t.spotifyPopularity = result.popularity;
        found++;
      } else {
        notFound++;
      }

      // Log tous les 10 tracks
      if ((i + 1) % 10 === 0 || i === toSearch.length - 1) {
        const remaining = toSearch.length - i - 1;
        const etaMin    = Math.round(remaining * SEARCH_DELAY_MS / 60000);
        console.log(`  [${i + 1}/${toSearch.length}] ✅ ${found} trouvés | ❌ ${notFound} non trouvés | ~${etaMin}min restantes`);
      }

      // Sauvegarde incrémentale
      if ((i + 1) % SAVE_EVERY === 0) {
        saveDB(tracks);
        console.log(`  💾 Sauvegarde intermédiaire (${i + 1}/${toSearch.length})`);
      }

      await sleep(SEARCH_DELAY_MS);
    }

    saveDB(tracks);
    console.log(`\n  ✅ Phase 1 terminée : ${found} Spotify IDs trouvés\n`);
  }

  // ─ Phase 2 : Audio Features ─────────────────────────────
  const withID = tracks.filter(t => !!t.spotifyID);
  console.log(`── PHASE 2 : Audio Features (${withID.length} tracks en batches de 100) ──`);

  let featCount = 0;
  for (let i = 0; i < withID.length; i += 100) {
    const batch = withID.slice(i, i + 100);
    const ids   = batch.map(t => t.spotifyID);

    const features = await getAudioFeatures(ids, token);

    for (let j = 0; j < features.length; j++) {
      const feat = features[j];
      if (!feat) continue;

      const t = batch[j];
      // Stocker les raw features Spotify
      t.spotify = {
        energy:          Math.round(feat.energy * 100),        // 0-100
        danceability:    Math.round(feat.danceability * 100),  // 0-100
        valence:         Math.round(feat.valence * 100),       // 0-100 (bonheur)
        acousticness:    Math.round(feat.acousticness * 100),  // 0-100
        loudness:        Math.round(feat.loudness * 10) / 10,  // dB
        tempo:           Math.round(feat.tempo),               // BPM Spotify
        instrumentalness: Math.round(feat.instrumentalness * 100),
      };

      // Mettre à jour energy 1-10 (Spotify > estimation BPM)
      t.energy = Math.max(1, Math.round(feat.energy * 10));

      // BPM manquant uniquement (jamais écraser)
      if ((!t.bpm || t.bpm === 0) && feat.tempo > 0) {
        t.bpm = Math.round(feat.tempo);
        console.log(`  📌 BPM inséré pour "${t.title}": ${t.bpm}`);
      }

      featCount++;
    }

    console.log(`  [${Math.min(i + 100, withID.length)}/${withID.length}] features récupérées`);
    saveDB(tracks);
    await sleep(FEATURES_DELAY_MS);
  }

  // ─ Rapport final ─────────────────────────────────────────
  const final = {
    total:          tracks.length,
    withSpotifyID:  tracks.filter(t => t.spotifyID).length,
    withFeatures:   tracks.filter(t => t.spotify?.danceability !== undefined).length,
    withBPM:        tracks.filter(t => t.bpm > 0).length,
    withEnergy:     tracks.filter(t => t.energy > 0).length,
  };

  console.log('\n' + '═'.repeat(60));
  console.log('  ✅ ENRICHISSEMENT TERMINÉ');
  console.log('═'.repeat(60));
  console.log(`  Spotify IDs     : ${final.withSpotifyID}/${final.total}`);
  console.log(`  Audio Features  : ${final.withFeatures}/${final.total}`);
  console.log(`  Avec BPM        : ${final.withBPM}/${final.total}`);
  console.log(`  Avec Energy     : ${final.withEnergy}/${final.total}`);
  console.log('═'.repeat(60) + '\n');
}

main().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
