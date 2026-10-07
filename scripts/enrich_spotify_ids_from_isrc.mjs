import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import querystring from 'querystring';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env (optionnel : absent sur Render, présent en local)
const envPath = path.join(__dirname, '..', '.env');
let env = {};
try {
  env = Object.fromEntries(
    fs.readFileSync(envPath, 'utf8').split('\n')
      .filter(l => l.match(/^[A-Z]/) && l.includes('='))
      .map(l => { const i = l.indexOf('='); return [l.substring(0, i).trim(), l.substring(i+1).replace(/^"|"$/g, '').trim()]; })
  );
} catch (_) {
  // .env absent (ex. Render Shell) — on retombe sur process.env
}

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || env.MONGO_URI || env.MONGODB_URI;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || env.SPOTIFY_CLIENT_SECRET;

const DRY_RUN = process.env.DRY_RUN === '1';
const LIMIT = parseInt(process.env.LIMIT) || 50;

let spotifyToken = null;
let tokenExpiresAt = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 2s + jitter ±500ms
async function extremeRateLimit() {
  const baseDelay = 2000;
  const jitter = Math.floor(Math.random() * 1000) - 500; // -500 to +500
  const delay = baseDelay + jitter;
  await sleep(delay);
}

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < tokenExpiresAt) {
    return spotifyToken;
  }
  
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({ grant_type: 'client_credentials' });
    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    
    const options = {
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'AhOuai/1.0 (contact@ahouai.com)'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const parsed = JSON.parse(data);
          spotifyToken = parsed.access_token;
          tokenExpiresAt = Date.now() + (parsed.expires_in - 300) * 1000; // 1h cache (minus 5 mins padding)
          resolve(spotifyToken);
        } else {
          reject(new Error(`Failed to get token: ${res.statusCode} - ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function requestSpotifySearchRaw(query, token) {
  return new Promise((resolve, reject) => {
    const encoded = querystring.escape(query);
    const options = {
      hostname: 'api.spotify.com',
      path: `/v1/search?type=track&q=${encoded}&limit=5`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'AhOuai/1.0 (contact@ahouai.com)'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, data: JSON.parse(data || '{}') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function requestSpotifySearch(isrc, token) {
  return requestSpotifySearchRaw(`isrc:${isrc}`, token);
}

// Normalize title for comparison: lowercase, strip common suffixes like "(Remastered)", "- Live", "(2024 Remaster)"
function normalizeForMatch(s) {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ')          // remove (...) and [...]
    .replace(/\s*-\s*(remaster|live|radio edit|mix|version|single|album version).*/i, ' ')
    .replace(/[^a-z0-9àâäéèêëïîôöùûüÿç ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function searchSpotifyByTitleArtist(title, artist, token) {
  if (!title || !artist) return null;
  // Build a precise fielded query first
  const q = `track:"${title.replace(/"/g, '')}" artist:"${artist.replace(/"/g, '')}"`;
  const retry429 = [10000, 30000, 60000];
  let attempt429 = 0;
  while (true) {
    const result = await requestSpotifySearchRaw(q, token);
    if (result.statusCode === 200) {
      const items = result.data.tracks?.items || [];
      if (!items.length) return null;
      // Confidence check: match on normalized title + artist
      const normTitle = normalizeForMatch(title);
      const normArtist = normalizeForMatch(artist);
      for (const it of items) {
        const itTitle = normalizeForMatch(it.name);
        const itArtists = (it.artists || []).map(a => normalizeForMatch(a.name));
        const titleOk = itTitle === normTitle || itTitle.includes(normTitle) || normTitle.includes(itTitle);
        const artistOk = itArtists.some(a => a === normArtist || a.includes(normArtist) || normArtist.includes(a));
        if (titleOk && artistOk) return it;
      }
      return null;  // some results but none matched confidently
    }
    if (result.statusCode === 429 && attempt429 < retry429.length) {
      const wait = retry429[attempt429];
      console.warn(`⚠️ 429 on fallback search! Retry in ${wait/1000}s...`);
      await sleep(wait);
      attempt429++;
      continue;
    }
    if (result.statusCode === 401 || result.statusCode === 403) {
      throw new Error(`🚨 CRITICAL: ${result.statusCode} on fallback. ABORTING.`);
    }
    return null;
  }
}

async function searchSpotifyByISRC(isrc) {
  const retry429 = [10000, 30000, 60000, 120000];
  const retry5xx = [5000, 15000];
  
  let attempt429 = 0;
  let attempt5xx = 0;
  
  while (true) {
    const token = await getSpotifyToken();
    const result = await requestSpotifySearch(isrc, token);
    
    if (result.statusCode === 200) {
      return result.data;
    }
    
    if (result.statusCode === 429) {
      if (attempt429 < retry429.length) {
        const wait = retry429[attempt429];
        console.warn(`⚠️ 429 Rate Limit Hit! Retrying in ${wait/1000}s...`);
        await sleep(wait);
        attempt429++;
        continue;
      } else {
        throw new Error("429 Rate Limit Max Retries Exceeded");
      }
    }
    
    if (result.statusCode >= 500) {
      if (attempt5xx < retry5xx.length) {
        const wait = retry5xx[attempt5xx];
        console.warn(`⚠️ ${result.statusCode} Server Error! Retrying in ${wait/1000}s...`);
        await sleep(wait);
        attempt5xx++;
        continue;
      } else {
        console.warn(`⏭️ Skipping track after max 5xx retries.`);
        return null;
      }
    }
    
    if (result.statusCode === 401 || result.statusCode === 403) {
      throw new Error(`🚨 CRITICAL: ${result.statusCode} Unauthorized/Forbidden. ABORTING COMPLETELY.`);
    }
    
    console.warn(`⏭️ Unexpected status ${result.statusCode}, skipping.`);
    return null;
  }
}

(async () => {
  if (!MONGO_URI) { console.error('❌ MONGO_URI manquant'); process.exit(1); }
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) { console.error('❌ SPOTIFY CREDENTIALS manquants'); process.exit(1); }

  console.log(`\n=============================================`);
  console.log(`  ENRICH SPOTIFY IDs - ${DRY_RUN ? 'DRY RUN' : 'LIVE MODE'}`);
  console.log(`=============================================\n`);

  try {
    await mongoose.connect(MONGO_URI);
    const Track = mongoose.model('Track', new mongoose.Schema({}, { strict: false }));

    const tracks = await Track.find({
      isrc: { $exists: true, $ne: null, $ne: '' },
      $or: [
        { 'providers.spotify.trackId': { $exists: false } },
        { 'providers.spotify.trackId': null }
      ],
      // Exclure les tracks déjà tentées et marquées notFound
      'providers.spotify.notFound': { $ne: true }
    }).limit(LIMIT).lean();

    console.log(`Total tracks to process this session: ${tracks.length}`);
    const startTime = Date.now();
    let updated = 0;
    let updatedViaISRC = 0;
    let updatedViaFallback = 0;
    let notFound = 0;
    let errors = 0;

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (i > 0) {
        await extremeRateLimit();
      }

      console.log(`[${i+1}/${tracks.length}] Searching ISRC ${t.isrc} for "${t.title}"...`);

      try {
        const data = await searchSpotifyByISRC(t.isrc);
        if (!data) {
          errors++;
          continue;
        }

        let spotifyId = null;
        let spotifyUri = null;
        let foundVia = null;

        const items = data.tracks?.items;
        if (items && items.length > 0) {
          const trackData = items[0];
          spotifyId = trackData.id;
          spotifyUri = trackData.uri;
          foundVia = 'isrc';
        }

        // Fallback title+artist si ISRC n'a rien donné (seul extra appel API)
        if (!spotifyId && t.title && t.artist) {
          await extremeRateLimit();  // rate limit avant le 2e appel
          console.log(`  🔍 Fallback: search by title+artist...`);
          const token = await getSpotifyToken();
          const match = await searchSpotifyByTitleArtist(t.title, t.artist, token);
          if (match) {
            spotifyId = match.id;
            spotifyUri = match.uri;
            foundVia = 'title_artist';
          }
        }

        if (spotifyId) {
          if (DRY_RUN) {
            console.log(`  ✅ [DRY-RUN] Found Spotify ID: ${spotifyId} (via ${foundVia})`);
          } else {
            await Track.updateOne(
              { _id: t._id },
              { $set: {
                'providers.spotify.trackId': spotifyId,
                'providers.spotify.uri': spotifyUri,
                'providers.spotify.resolvedVia': foundVia,
                'providersResolvedAt': new Date()
              },
              // Au cas où un run précédent avait marqué notFound (données obsolètes)
              $unset: {
                'providers.spotify.notFound': '',
                'providers.spotify.notFoundAt': ''
              }}
            );
            console.log(`  ✅ Updated DB: ${spotifyId} (via ${foundVia})`);
          }
          updated++;
          if (foundVia === 'isrc') updatedViaISRC++;
          else updatedViaFallback++;
        } else {
          console.log(`  ❌ Not found on Spotify (ISRC + title/artist).`);
          notFound++;
          if (!DRY_RUN) {
            await Track.updateOne(
              { _id: t._id },
              { $set: {
                'providers.spotify.notFound': true,
                'providers.spotify.notFoundAt': new Date()
              }}
            );
          }
        }

      } catch (err) {
        console.error(`\n🚨 FATAL ERROR: ${err.message}`);
        console.log(`Aborting session to protect the account.`);
        process.exit(1);
      }

      if ((i + 1) % 50 === 0 && (i + 1) < tracks.length) {
        console.log(`\n⏳ PAUSE OBLIGATOIRE DE 10 MINUTES après 50 requêtes...`);
        await sleep(10 * 60 * 1000);
      }
    }

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalSpotify = await Track.countDocuments({ 'providers.spotify.trackId': { $exists: true } });

    console.log(`\n--- SESSION REPORT ---`);
    console.log(`✅ Spotify IDs found  : ${updated}  (ISRC: ${updatedViaISRC}, title+artist: ${updatedViaFallback})`);
    console.log(`❌ Not found on Spot  : ${notFound}  (marquées notFound, ne reviendront plus)`);
    console.log(`⚠️ Errors / Skipped   : ${errors}`);
    console.log(`⏱️ Duration           : ${durationSeconds}s`);
    console.log(`📊 Global Spotify IDs : ${totalSpotify} tracks have an ID in DB.`);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
})();
