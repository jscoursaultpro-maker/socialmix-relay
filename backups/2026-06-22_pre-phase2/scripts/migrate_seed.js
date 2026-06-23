#!/usr/bin/env node
/**
 * migrate_seed.js — Phase 1: Generate editorial_seed.json
 * 
 * Merges 3 sources into one deduplicated, ISRC-enriched JSON:
 *   1. curatedTracks (181 hardcoded in DJBrain.swift)
 *   2. track_metadata.json (307 tracks with filename keys)
 *   3. editorialCatalog (294 search queries per genre — artist+title extraction)
 * 
 * Usage:
 *   node scripts/migrate_seed.js                    # Generate without ISRC enrichment
 *   node scripts/migrate_seed.js --enrich           # + Deezer API ISRC enrichment (slow, ~5/sec)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DJBRAIN_PATH = path.join(__dirname, '..', '..', 'SocialMixApp', 'SocialMixApp', 'Engine', 'DJBrain.swift');
const METADATA_PATH = path.join(__dirname, '..', '..', 'SocialMixApp', 'SocialMixApp', 'Resources', 'track_metadata.json');
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'SocialMixApp', 'SocialMixApp', 'Resources', 'editorial_seed.json');

const ENRICH = process.argv.includes('--enrich');

// ─── Normalization ──────────────────────────────────────────────────

function fallbackHash(title, artist) {
  const normalize = (s) => s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove accents
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi, '')     // remove feat
    .replace(/\([^)]*\)/g, '')                           // remove parentheticals
    .replace(/\[[^\]]*\]/g, '')                          // remove brackets
    .replace(/[^a-z0-9\s]/g, '')                         // keep only alphanumeric
    .replace(/\s+/g, ' ')                                // compact spaces
    .trim();
  
  return `${normalize(title)}_${normalize(artist)}`;
}

// Genre normalization (same as normalizeMetadataGenre in DJBrain)
function normalizeGenre(raw) {
  const g = (raw || '').trim();
  const map = {
    'Electro/Dance': 'Electro',
    'Pop FR': 'COCOVARIET',
    'Afro House': 'Afro',
    'Chill/Lounge': 'Chill',
    'Latino': 'Latin',
    'Dancehall': 'Reggaeton',
    'Techno': 'Electro',
    'World': 'Afro',
    'Other': '',
    '0': '',
    '0 ': '',
    '': '',
    'House': 'Electro',
  };
  return map[g] !== undefined ? map[g] : g;
}

// ─── Source 1: Parse curatedTracks from DJBrain.swift ────────────────

function parseCuratedTracks() {
  const swift = fs.readFileSync(DJBRAIN_PATH, 'utf8');
  
  // More flexible regex: allows variable whitespace, special chars in fields
  // Handles BOTH formats: with and without trailing bpm field
  const regex = /CuratedTrack\(deezerID:\s*(\d+),\s*genre:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*artist:\s*"([^"]+)"(?:,\s*bpm:\s*(\d+))?\)/g;
  
  const tracks = [];
  let match;
  while ((match = regex.exec(swift)) !== null) {
    tracks.push({
      deezerID: parseInt(match[1]),
      genre: match[2].trim(),
      title: match[3],
      artist: match[4],
      bpm: match[5] ? parseInt(match[5]) : 0,
    });
  }
  
  // Also try multi-line CuratedTrack (some may span lines)
  if (tracks.length < 150) {
    // Fallback: line-by-line extraction
    const lines = swift.split('\n');
    for (const line of lines) {
      const m = line.match(/CuratedTrack\(deezerID:\s*(\d+),\s*genre:\s*"(.+?)",\s*title:\s*"(.+?)",\s*artist:\s*"(.+?)"(?:,\s*bpm:\s*(\d+))?\)/);
      if (m) {
        const deezerID = parseInt(m[1]);
        if (!tracks.find(t => t.deezerID === deezerID)) {
          tracks.push({
            deezerID,
            genre: m[2].trim(),
            title: m[3],
            artist: m[4],
            bpm: m[5] ? parseInt(m[5]) : 0,
          });
        }
      }
    }
  }
  
  console.log(`[Source 1] Parsed ${tracks.length} curatedTracks from DJBrain.swift`);
  return tracks;
}

// ─── Source 2: Parse track_metadata.json ─────────────────────────────

function parseTrackMetadata() {
  const raw = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
  
  const tracks = [];
  let skipped = 0;
  
  for (const [, entry] of Object.entries(raw)) {
    const title = entry.title;
    const artist = entry.artist;
    if (!title || !artist) { skipped++; continue; }
    
    // Skip entries with "Unknown Artist" — these are badly parsed
    if (artist === 'Unknown Artist') { skipped++; continue; }
    
    const genre = normalizeGenre(entry.genre);
    if (!genre) { skipped++; continue; }
    
    tracks.push({
      title,
      artist,
      genre,
      bpm: entry.bpm || 0,
      energy: entry.energy || 0,
    });
  }
  
  console.log(`[Source 2] Parsed ${tracks.length} from track_metadata.json (${skipped} skipped)`);
  return tracks;
}

// ─── Source 3: Parse editorialCatalog from DJBrain.swift ─────────────

function parseEditorialCatalog() {
  const swift = fs.readFileSync(DJBRAIN_PATH, 'utf8');
  
  // Find the editorialCatalog block
  const startIdx = swift.indexOf('private let editorialCatalog');
  if (startIdx === -1) { console.log('[Source 3] editorialCatalog not found'); return []; }
  
  // Extract genre sections with their queries
  const tracks = [];
  const genreRegex = /"(\w[^"]+)":\s*\[([\s\S]*?)\]/g;
  const catalogBlock = swift.substring(startIdx, swift.indexOf(']\n    ]\n', startIdx) + 10);
  
  let genreMatch;
  while ((genreMatch = genreRegex.exec(catalogBlock)) !== null) {
    const genre = genreMatch[1];
    const entries = genreMatch[2];
    
    // Extract individual query strings
    const queryRegex = /"([^"]+)"/g;
    let queryMatch;
    while ((queryMatch = queryRegex.exec(entries)) !== null) {
      const query = queryMatch[1];
      
      // Try to extract artist + title from the query
      // Most queries follow pattern: "Artist Title" or "Artist - Title"
      // We can't perfectly split artist/title from a free-text query,
      // but we'll use these as hints for Deezer search later
      tracks.push({
        query,
        genre: normalizeGenre(genre),
        source: 'editorial_catalog',
      });
    }
  }
  
  console.log(`[Source 3] Parsed ${tracks.length} editorial catalog queries`);
  return tracks;
}

// ─── Merge & Deduplicate ─────────────────────────────────────────────

function mergeAll(curated, metadata, editorial) {
  const merged = new Map(); // fallbackHash → track object
  
  // 1. curatedTracks — highest priority (have deezerID + verified genre)
  for (const t of curated) {
    const hash = fallbackHash(t.title, t.artist);
    merged.set(hash, {
      isrc: null,
      fallbackHash: hash,
      title: t.title,
      artist: t.artist,
      album: null,
      genre: t.genre,
      bpm: t.bpm || 0,
      energy: 0,
      releaseYear: null,
      providers: {
        deezer: { trackId: t.deezerID, albumId: null },
        spotify: { trackId: null },
        appleMusic: { trackId: null },
      },
      source: 'editorial',
    });
  }
  
  // 2. track_metadata — add new tracks, enrich existing with BPM/energy
  for (const t of metadata) {
    const hash = fallbackHash(t.title, t.artist);
    
    if (merged.has(hash)) {
      // Enrich existing with BPM and energy from metadata
      const existing = merged.get(hash);
      if (t.bpm > 0 && existing.bpm === 0) existing.bpm = t.bpm;
      if (t.energy > 0 && existing.energy === 0) existing.energy = t.energy;
    } else {
      merged.set(hash, {
        isrc: null,
        fallbackHash: hash,
        title: t.title,
        artist: t.artist,
        album: null,
        genre: t.genre,
        bpm: t.bpm,
        energy: t.energy,
        releaseYear: null,
        providers: {
          deezer: { trackId: null, albumId: null },
          spotify: { trackId: null },
          appleMusic: { trackId: null },
        },
        source: 'editorial',
      });
    }
  }
  
  // 3. editorialCatalog — these are search queries, not structured tracks
  //    We skip adding them as tracks (they'll remain as search queries in DJBrain)
  //    unless they match an existing track
  console.log(`[Merge] ${editorial.length} editorial catalog queries noted (kept as search hints in DJBrain)`);
  
  console.log(`[Merge] Total unique tracks: ${merged.size}`);
  
  // Genre distribution
  const genreCount = {};
  for (const t of merged.values()) {
    genreCount[t.genre] = (genreCount[t.genre] || 0) + 1;
  }
  const sorted = Object.entries(genreCount).sort((a, b) => b[1] - a[1]);
  console.log(`[Merge] Genre distribution: ${sorted.map(([g, c]) => `${g}:${c}`).join(', ')}`);
  
  return merged;
}

// ─── ISRC Enrichment via Deezer API ──────────────────────────────────

async function enrichWithDeezer(merged) {
  const toEnrich = [...merged.values()].filter(t => t.providers.deezer.trackId);
  console.log(`\n[Enrich] Resolving ISRC for ${toEnrich.length} tracks with deezerID...`);
  
  let resolved = 0;
  let errors = 0;
  
  for (let i = 0; i < toEnrich.length; i++) {
    const track = toEnrich[i];
    const deezerID = track.providers.deezer.trackId;
    
    try {
      const res = await fetch(`https://api.deezer.com/track/${deezerID}`);
      const json = await res.json();
      
      if (json.error) {
        errors++;
        continue;
      }
      
      // Extract ISRC
      if (json.isrc) {
        track.isrc = json.isrc;
        resolved++;
      }
      
      // Extract album ID
      if (json.album?.id) {
        track.providers.deezer.albumId = json.album.id;
      }
      
      // Extract BPM if not already set
      if (json.bpm > 0 && track.bpm === 0) {
        track.bpm = Math.round(json.bpm);
      }
      
      // Extract album name
      if (json.album?.title) {
        track.album = json.album.title;
      }
      
      // Extract release date year
      if (json.release_date) {
        track.releaseYear = parseInt(json.release_date.substring(0, 4));
      }
      
      // Update the merged map
      merged.set(track.fallbackHash, track);
      
    } catch (err) {
      errors++;
    }
    
    // Progress log
    if ((i + 1) % 20 === 0 || i === toEnrich.length - 1) {
      console.log(`[Enrich] ${i + 1}/${toEnrich.length} (${resolved} ISRC, ${errors} errors)`);
    }
    
    // Throttle: 5 requests/sec
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.log(`[Enrich] Done: ${resolved}/${toEnrich.length} ISRC resolved, ${errors} errors`);
  
  // Now try to resolve deezerIDs for tracks WITHOUT one (from track_metadata.json)
  const noID = [...merged.values()].filter(t => !t.providers.deezer.trackId);
  if (noID.length > 0) {
    console.log(`\n[Enrich] Searching deezerIDs for ${noID.length} tracks without deezerID...`);
    
    let searchResolved = 0;
    for (let i = 0; i < noID.length; i++) {
      const track = noID[i];
      const query = encodeURIComponent(`${track.artist} ${track.title}`);
      
      try {
        const res = await fetch(`https://api.deezer.com/search?q=${query}&limit=1&order=RANKING`);
        const json = await res.json();
        
        if (json.data?.[0]) {
          const result = json.data[0];
          track.providers.deezer.trackId = result.id;
          
          if (result.album?.id) {
            track.providers.deezer.albumId = result.album.id;
          }
          
          // Now fetch the track details for ISRC
          const detailRes = await fetch(`https://api.deezer.com/track/${result.id}`);
          const detail = await detailRes.json();
          
          if (detail.isrc) track.isrc = detail.isrc;
          if (detail.bpm > 0 && track.bpm === 0) track.bpm = Math.round(detail.bpm);
          if (detail.album?.title && !track.album) track.album = detail.album.title;
          if (detail.release_date) track.releaseYear = parseInt(detail.release_date.substring(0, 4));
          
          merged.set(track.fallbackHash, track);
          searchResolved++;
        }
      } catch (err) { /* skip */ }
      
      if ((i + 1) % 20 === 0 || i === noID.length - 1) {
        console.log(`[Enrich] Search ${i + 1}/${noID.length} (${searchResolved} found)`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 400)); // Slower for search (2 API calls per track)
    }
    
    console.log(`[Enrich] Search done: ${searchResolved}/${noID.length} deezerIDs found`);
  }
  
  return merged;
}

// ─── Output ──────────────────────────────────────────────────────────

function writeOutput(merged) {
  const tracks = [...merged.values()].sort((a, b) => {
    // Sort by genre, then by artist
    if (a.genre !== b.genre) return a.genre.localeCompare(b.genre);
    return a.artist.localeCompare(b.artist);
  });
  
  const output = {
    version: 1,
    generatedAt: new Date().toISOString().split('T')[0],
    trackCount: tracks.length,
    genreDistribution: {},
    tracks,
  };
  
  // Genre distribution summary
  for (const t of tracks) {
    output.genreDistribution[t.genre] = (output.genreDistribution[t.genre] || 0) + 1;
  }
  
  // Stats
  const withISRC = tracks.filter(t => t.isrc).length;
  const withBPM = tracks.filter(t => t.bpm > 0).length;
  const withDeezer = tracks.filter(t => t.providers.deezer.trackId).length;
  
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  EDITORIAL SEED — Summary`);
  console.log(`═══════════════════════════════════════`);
  console.log(`  Total tracks:     ${tracks.length}`);
  console.log(`  With ISRC:        ${withISRC} (${Math.round(withISRC/tracks.length*100)}%)`);
  console.log(`  With BPM:         ${withBPM} (${Math.round(withBPM/tracks.length*100)}%)`);
  console.log(`  With Deezer ID:   ${withDeezer} (${Math.round(withDeezer/tracks.length*100)}%)`);
  console.log(`  Genres:           ${Object.keys(output.genreDistribution).length}`);
  console.log(`═══════════════════════════════════════\n`);
  
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`✅ Written to: ${OUTPUT_PATH}`);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('🎵 SocialMix Editorial Seed Migration\n');
  
  // Parse sources
  const curated = parseCuratedTracks();
  const metadata = parseTrackMetadata();
  const editorial = parseEditorialCatalog();
  
  // Merge & dedup
  const merged = mergeAll(curated, metadata, editorial);
  
  // Optional ISRC enrichment
  if (ENRICH) {
    await enrichWithDeezer(merged);
  } else {
    console.log('\n⚠️  Skipping ISRC enrichment (use --enrich to resolve ISRCs via Deezer API)');
  }
  
  // Write output
  writeOutput(merged);
}

main().catch(console.error);
