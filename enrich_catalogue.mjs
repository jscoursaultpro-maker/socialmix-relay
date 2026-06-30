#!/usr/bin/env node
/**
 * enrich_catalogue.mjs
 * 
 * Ce script enrichit curated_base_v3.json avec les APIs Spotify et iTunes (Apple).
 * Il ajoute: spotifyID, appleID, isrc, danceability, energy exact.
 * Puis il re-calcule la phase.
 */

import fs from 'fs';
import https from 'https';

const SPOTIFY_CLIENT_ID = '2c7bee5534134542adce16efcf986fb4';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const BASE_V3_PATH = './curated_base_v3.json';
const OUTPUT_PATH = './curated_base_v4.json';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getSpotifyToken() {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
        const options = {
            hostname: 'accounts.spotify.com',
            port: 443,
            path: '/api/token',
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data).access_token);
                } else {
                    console.error("Spotify Auth Error:", data);
                    reject(new Error('Failed to get Spotify token'));
                }
            });
        });
        req.on('error', reject);
        req.write('grant_type=client_credentials');
        req.end();
    });
}

function httpsGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode === 429) {
                        const retryAfter = res.headers['retry-after'] || 1;
                        console.log(`Rate limited. Waiting ${retryAfter}s...`);
                        resolve({ error: 'rate_limit', retryAfter: parseInt(retryAfter) });
                        return;
                    }
                    if (res.statusCode !== 200) {
                        resolve({ error: `status ${res.statusCode}`, data });
                        return;
                    }
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ error: 'parse_error' });
                }
            });
        }).on('error', reject);
    });
}

async function searchSpotify(title, artist, token) {
    const query = encodeURIComponent(`track:${title} artist:${artist}`);
    const url = `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`;
    const res = await httpsGet(url, { 'Authorization': `Bearer ${token}` });
    
    if (res.error === 'rate_limit') {
        await sleep(res.retryAfter * 1000);
        return searchSpotify(title, artist, token); // retry
    }
    
    if (res.tracks && res.tracks.items && res.tracks.items.length > 0) {
        const track = res.tracks.items[0];
        return {
            id: track.id,
            isrc: track.external_ids?.isrc || ''
        };
    }
    
    // Fallback: search without "track:"/"artist:" exact match
    const looseQuery = encodeURIComponent(`${title} ${artist}`);
    const url2 = `https://api.spotify.com/v1/search?q=${looseQuery}&type=track&limit=1`;
    const res2 = await httpsGet(url2, { 'Authorization': `Bearer ${token}` });
    if (res2.tracks && res2.tracks.items && res2.tracks.items.length > 0) {
        const track = res2.tracks.items[0];
        return {
            id: track.id,
            isrc: track.external_ids?.isrc || ''
        };
    }
    
    return null;
}

async function getAudioFeatures(ids, token) {
    const url = `https://api.spotify.com/v1/audio-features?ids=${ids.join(',')}`;
    const res = await httpsGet(url, { 'Authorization': `Bearer ${token}` });
    if (res.error === 'rate_limit') {
        await sleep(res.retryAfter * 1000);
        return getAudioFeatures(ids, token);
    }
    return res.audio_features || [];
}

async function searchAppleMusic(title, artist) {
    const query = encodeURIComponent(`${title} ${artist}`.toLowerCase().replace(/[^a-z0-9 ]/g, ' '));
    const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`;
    try {
        const res = await httpsGet(url);
        if (res.results && res.results.length > 0) {
            return res.results[0].trackId;
        }
    } catch (e) {}
    return null;
}

// Phase classification rules based on BPM + energy
function classifyPhase(bpm, energy) {
    const e = energy || 0;
    const b = bpm || 0;
    
    if (e === 0 && b === 0) return 'unclassified';
    if (e <= 5 && e > 0) return 'arrival';
    if (e <= 7 && b > 0 && b < 115) return 'closing';
    if (e <= 7 && b >= 115 && b <= 128) return 'ambiance';
    if (e >= 7 && e <= 9 && b >= 125 && b <= 140) return 'takeoff';
    if (e >= 7 && b >= 90 && b <= 130) return 'groove';
    if (e >= 8 && b >= 128) return 'party';
    
    // fallback based on energy only
    if (e >= 8) return 'party';
    if (e >= 6) return 'groove';
    return 'arrival';
}

async function main() {
    console.log('═'.repeat(70));
    console.log('🚀 ENRICHISSEMENT CURATED V4: Spotify & Apple APIs');
    console.log('═'.repeat(70));

    let token = await getSpotifyToken();
    console.log('✅ Spotify Token généré.');

    const data = JSON.parse(fs.readFileSync(BASE_V3_PATH, 'utf-8'));
    const tracks = data.tracks;
    
    let spotifyCount = 0;
    let appleCount = 0;
    
    // 1. Fetch IDs (Spotify + Apple)
    console.log(`\n🔍 Recherche des IDs (Spotify & Apple) pour ${tracks.length} titres...`);
    for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        
        // Refresh token every 50 mins
        if (i > 0 && i % 1000 === 0) token = await getSpotifyToken();
        
        // Apple Search
        if (!t.appleID) {
            const appleID = await searchAppleMusic(t.title, t.artist);
            if (appleID) { t.appleID = appleID; appleCount++; }
        }
        
        // Spotify Search
        if (!t.spotifyID) {
            const spotData = await searchSpotify(t.title, t.artist, token);
            if (spotData) {
                t.spotifyID = spotData.id;
                if (!t.isrc) t.isrc = spotData.isrc;
                spotifyCount++;
            }
        }
        
        if ((i + 1) % 50 === 0) {
            console.log(`  ${i + 1}/${tracks.length} — 🟢 Spotify: ${spotifyCount} | 🔴 Apple: ${appleCount}`);
        }
        
        await sleep(50); // delay to avoid rate limits
    }

    // 2. Fetch Audio Features (DEPRECATED BY SPOTIFY)
    console.log('\n🎛️ Fetch Spotify Audio Features ignoré (API obsolète)...');
    let featuresCount = 0;

    
    // 3. Re-calculate phase & Stats
    let reclassified = 0;
    const stats = {
        total: tracks.length,
        withDeezerID: tracks.filter(t => t.deezerID > 0).length,
        withSpotifyID: tracks.filter(t => !!t.spotifyID).length,
        withAppleID: tracks.filter(t => !!t.appleID).length,
        withBPM: tracks.filter(t => (t.bpm || 0) > 0).length,
        withEnergy: tracks.filter(t => (t.energy || 0) > 0).length,
        withDanceability: tracks.filter(t => t.danceability !== undefined).length,
        byPhase: {}
    };

    for (const t of tracks) {
        // On respecte le tri manuel : on reclassifie uniquement si la phase est manquante ou unclassified
        if (!t.phase || t.phase === 'unclassified' || t.phase === '') {
            const newPhase = classifyPhase(t.bpm, t.energy);
            if (t.phase !== newPhase) {
                t.phase = newPhase;
                reclassified++;
            }
        }
        stats.byPhase[t.phase || 'unclassified'] = (stats.byPhase[t.phase || 'unclassified'] || 0) + 1;
    }

    const v4 = {
        version: 4,
        generatedAt: new Date().toISOString(),
        stats,
        tracks
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(v4, null, 2));

    console.log(`\n${'═'.repeat(70)}`);
    console.log('🎉 BASE CURATED V4 ULTIME — GÉNÉRÉE');
    console.log('═'.repeat(70));
    console.log(`Total           : ${stats.total}`);
    console.log(`+ Spotify IDs   : ${stats.withSpotifyID} trouvés`);
    console.log(`+ Apple IDs     : ${stats.withAppleID} trouvés`);
    console.log(`+ Audio Features: ${featuresCount} enrichies (Energy & Danceability)`);
    console.log(`+ Phases maj    : ${reclassified} titres reclassifiés`);
    console.log(`\n📄 Sauvegardé dans : ${OUTPUT_PATH}`);
}

main().catch(console.error);
