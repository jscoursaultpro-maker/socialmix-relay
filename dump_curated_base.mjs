#!/usr/bin/env node
/**
 * dump_curated_base.mjs
 * 
 * Génère un JSON propre de la base curated complète:
 * 1. Curated hard-codé (180 tracks) — extrait du Swift
 * 2. Editorial seeds avec deezerID (644 tracks) — du editorial_seed.json
 * 3. Enrichissement via Deezer API /track/{id} pour BPM manquants
 * 
 * Output: curated_base_clean.json
 */

import fs from 'fs';
import path from 'path';

const SEED_PATH = '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json';
const SWIFT_PATH = '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift';
const OUTPUT_PATH = './curated_base_clean.json';

// Rate limit helper
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchTrackInfo(deezerID) {
    try {
        const res = await fetch(`https://api.deezer.com/track/${deezerID}`);
        const data = await res.json();
        if (data.error) return null;
        return {
            bpm: data.bpm || 0,
            duration: data.duration || 0,
            rank: data.rank || 0,
            preview: data.preview || '',
            isrc: data.isrc || '',
            album: data.album?.title || '',
            albumId: data.album?.id || 0,
        };
    } catch (e) {
        return null;
    }
}

async function main() {
    console.log('=== DUMP CURATED BASE CLEAN ===\n');

    // 1. Parse curated tracks from Swift source
    const swift = fs.readFileSync(SWIFT_PATH, 'utf-8');
    const curatedRegex = /CuratedTrack\(deezerID:\s*(\d+),\s*genre:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*artist:\s*"([^"]+)"/g;
    const curatedTracks = [];
    let m;
    while ((m = curatedRegex.exec(swift)) !== null) {
        curatedTracks.push({
            deezerID: parseInt(m[1]),
            genre: m[2],
            title: m[3],
            artist: m[4],
            source: 'curated_hardcoded',
        });
    }
    console.log(`1. Curated hard-codé: ${curatedTracks.length} tracks`);

    // 2. Parse editorial seeds with deezerID
    const seedData = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
    const seedTracks = seedData.tracks || [];
    const curatedIDs = new Set(curatedTracks.map(t => t.deezerID));
    
    const seedWithID = seedTracks
        .filter(t => {
            const did = t.providers?.deezer?.trackId;
            return did && did > 0 && !curatedIDs.has(did);
        })
        .map(t => ({
            deezerID: t.providers.deezer.trackId,
            genre: t.genre || 'Unknown',
            title: t.title,
            artist: t.artist,
            bpm: t.bpm || 0,
            energy: t.energy || 0,
            isrc: t.isrc || '',
            source: 'editorial_seed',
        }));
    console.log(`2. Editorial seeds (avec deezerID): ${seedWithID.length} tracks`);

    // 3. Seeds WITHOUT deezerID (need resolution)
    const seedWithoutID = seedTracks
        .filter(t => {
            const did = t.providers?.deezer?.trackId;
            return !did || did <= 0;
        })
        .map(t => ({
            deezerID: 0,
            genre: t.genre || 'Unknown',
            title: t.title,
            artist: t.artist,
            bpm: t.bpm || 0,
            energy: t.energy || 0,
            isrc: t.isrc || '',
            source: 'seed_unresolved',
        }));
    console.log(`3. Seeds SANS deezerID (à résoudre): ${seedWithoutID.length} tracks`);

    // Combine all
    const allTracks = [...curatedTracks, ...seedWithID, ...seedWithoutID];
    console.log(`\nTotal combiné: ${allTracks.length} tracks`);

    // 4. Enrich with Deezer API for tracks missing BPM
    const needBPM = allTracks.filter(t => t.deezerID > 0 && (!t.bpm || t.bpm === 0));
    console.log(`\nEnrichissement BPM via Deezer API: ${needBPM.length} tracks à enrichir...`);
    
    let enriched = 0;
    for (let i = 0; i < needBPM.length; i++) {
        const info = await fetchTrackInfo(needBPM[i].deezerID);
        if (info) {
            if (info.bpm > 0) { needBPM[i].bpm = info.bpm; enriched++; }
            if (info.duration > 0) needBPM[i].duration = info.duration;
            if (info.rank > 0) needBPM[i].rank = info.rank;
            if (info.preview) needBPM[i].preview = info.preview;
            if (info.isrc) needBPM[i].isrc = info.isrc;
        }
        if ((i + 1) % 50 === 0) {
            console.log(`  ${i + 1}/${needBPM.length} enrichis (${enriched} BPM trouvés)...`);
            await sleep(1000); // Rate limit
        }
        await sleep(100); // 10 req/s
    }
    console.log(`Enrichissement terminé: ${enriched} BPM ajoutés`);

    // 5. Stats
    const stats = {
        total: allTracks.length,
        withDeezerID: allTracks.filter(t => t.deezerID > 0).length,
        withBPM: allTracks.filter(t => t.bpm > 0).length,
        withEnergy: allTracks.filter(t => t.energy > 0).length,
        byGenre: {},
        bySource: {},
        byEnergy: {},
    };
    allTracks.forEach(t => {
        stats.byGenre[t.genre] = (stats.byGenre[t.genre] || 0) + 1;
        stats.bySource[t.source] = (stats.bySource[t.source] || 0) + 1;
        if (t.energy > 0) stats.byEnergy[`E:${t.energy}`] = (stats.byEnergy[`E:${t.energy}`] || 0) + 1;
    });

    // 6. Output
    const output = {
        version: 1,
        generatedAt: new Date().toISOString(),
        stats,
        tracks: allTracks.sort((a, b) => {
            // Sort by genre, then by artist
            if (a.genre !== b.genre) return a.genre.localeCompare(b.genre);
            return a.artist.localeCompare(b.artist);
        }),
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    
    console.log(`\n=== OUTPUT: ${OUTPUT_PATH} ===`);
    console.log(`Total: ${stats.total}`);
    console.log(`Avec deezerID: ${stats.withDeezerID}`);
    console.log(`Avec BPM: ${stats.withBPM}`);
    console.log(`Avec Energy: ${stats.withEnergy}`);
    console.log(`\nPar genre:`);
    Object.entries(stats.byGenre).sort((a,b) => b[1]-a[1]).forEach(([g,c]) => {
        console.log(`  ${g.padEnd(18)}: ${c}`);
    });
    console.log(`\nPar source:`);
    Object.entries(stats.bySource).sort((a,b) => b[1]-a[1]).forEach(([s,c]) => {
        console.log(`  ${s.padEnd(22)}: ${c}`);
    });
}

main().catch(console.error);
