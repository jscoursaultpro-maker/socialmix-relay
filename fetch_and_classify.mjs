#!/usr/bin/env node
/**
 * fetch_and_classify.mjs
 * 
 * 1. Fetch toutes les playlists Deezer (90 tracks each)
 * 2. Merge avec curated_base_v2.json (dedup)
 * 3. Enrichir BPM via /track/{id}
 * 4. Classifier chaque track : genre SocialMix + phase de soirée
 * 5. Générer curated_base_v3.json + prompt Claude pour audit
 */

import fs from 'fs';

const PLAYLISTS = [
    { id: 1677006641, genre: 'Hip-Hop',    name: 'Hip Hop Hits' },
    { id: 1996494362, genre: 'Hip-Hop',    name: 'Rap Bangers' },
    { id: 2015058202, genre: 'Disco',      name: 'Disco Essentials' },
    { id: 1562766932, genre: 'Electro',    name: 'Electronic Hits' },
    { id: 2784015704, genre: 'House',      name: 'IBIZA 2026' },
    { id: 1111141961, genre: 'Pop',        name: 'Pop Hits' },
    { id: 4403076402, genre: 'Latin',      name: 'Latin Party' },
    { id: 7841079122, genre: 'Latin',      name: 'City Sounds Havana' },
    { id: 1562754742, genre: 'Rock',       name: 'Rock Anthems' },
    { id: 2558770224, genre: 'Rock',       name: 'Rock the Party' },
    { id: 1562762092, genre: 'R&B',        name: 'R&B Hits' },
    { id: 1996495882, genre: 'Variété Fr', name: 'Hits Français' },
    { id: 944669465,  genre: 'Mixed',      name: 'COCOVARIET (hôte)' },
    { id: 6167621604, genre: 'Afro',       name: 'Afrobeats Hits' },
    { id: 1371651955, genre: 'House',      name: 'Chill House → House' },
    { id: 1560256341, genre: 'Mixed',      name: 'Soirée 2000' },
    { id: 1682663671, genre: 'Mixed',      name: 'Soirée 90' },
    { id: 1109890291, genre: 'Mixed',      name: 'Top France' },
    { id: 932386265,  genre: 'Mixed',      name: 'Hits de l\'été' },
];

// SocialMix Genres valides
const VALID_GENRES = ['House', 'Electro', 'Hip-Hop', 'Pop', 'Disco', 'Latin', 'Reggaeton', 'Rock', 'Afro', 'R&B', 'Variété Fr', 'Années 80', 'Ambient'];

// Known artist → genre (pour les playlists Mixed)
const ARTIST_GENRE_MAP = {
    // House
    'daft punk': 'House', 'calvin harris': 'House', 'david guetta': 'Electro',
    'martin solveig': 'House', 'bob sinclar': 'House', 'masters at work': 'House',
    'stardust': 'House', 'basement jaxx': 'House', 'roger sanchez': 'House',
    'avicii': 'House', 'swedish house mafia': 'House', 'disclosure': 'House',
    // Electro
    'deadmau5': 'Electro', 'skrillex': 'Electro', 'tiësto': 'Electro',
    'armin van buuren': 'Electro', 'martin garrix': 'Electro', 'hardwell': 'Electro',
    'afrojack': 'Electro', 'nervo': 'Electro', 'showtek': 'Electro',
    // Hip-Hop
    'eminem': 'Hip-Hop', 'jay-z': 'Hip-Hop', 'drake': 'Hip-Hop',
    'kanye west': 'Hip-Hop', 'snoop dogg': 'Hip-Hop', 'ludacris': 'Hip-Hop',
    '50 cent': 'Hip-Hop', 'missy elliott': 'Hip-Hop', 'nicki minaj': 'Hip-Hop',
    'cardi b': 'Hip-Hop', 'travis scott': 'Hip-Hop', 'kendrick lamar': 'Hip-Hop',
    // Pop
    'rihanna': 'Pop', 'beyoncé': 'Pop', 'lady gaga': 'Pop',
    'britney spears': 'Pop', 'madonna': 'Pop', 'michael jackson': 'Pop',
    'the weeknd': 'Pop', 'ed sheeran': 'Pop', 'taylor swift': 'Pop',
    'dua lipa': 'Pop', 'harry styles': 'Pop', 'sabrina carpenter': 'Pop',
    // Disco
    'abba': 'Disco', 'donna summer': 'Disco', 'earth, wind & fire': 'Disco',
    'kool & the gang': 'Disco', 'boney m.': 'Disco', 'gloria gaynor': 'Disco',
    'chic': 'Disco', 'sylvester': 'Disco', 'cerrone': 'Disco',
    // Latin/Reggaeton
    'shakira': 'Latin', 'j balvin': 'Reggaeton', 'bad bunny': 'Reggaeton',
    'daddy yankee': 'Reggaeton', 'maluma': 'Latin', 'ozuna': 'Reggaeton',
    'marc anthony': 'Latin', 'celia cruz': 'Latin', 'gloria estefan': 'Latin',
    // Variété Fr
    'stromae': 'Variété Fr', 'aya nakamura': 'Variété Fr', 'angèle': 'Variété Fr',
    'nikos aliagas': 'Variété Fr', 'patrick bruel': 'Variété Fr',
    // Afro
    'burna boy': 'Afro', 'wizkid': 'Afro', 'davido': 'Afro', 'rema': 'Afro',
    'ckay': 'Afro', 'fireboy dml': 'Afro',
};

// Phase classification rules based on BPM + energy
function classifyPhase(bpm, energy) {
    const e = energy || 0;
    const b = bpm || 0;
    
    // No data → unclassified
    if (e === 0 && b === 0) return 'unclassified';
    
    // arrival: calm, intro energy (E:3-5)
    if (e <= 5 && e > 0) return 'arrival';
    
    // closing: mid-energy classics (E:5-7, BPM < 125)
    if (e <= 7 && b > 0 && b < 115) return 'closing';
    
    // ambiance: mid-high energy (E:5-7, BPM 115-128)
    if (e <= 7 && b >= 115 && b <= 128) return 'ambiance';
    
    // takeoff: high energy burst (E:7-9, BPM 125-135)
    if (e >= 7 && e <= 9 && b >= 125 && b <= 140) return 'takeoff';
    
    // groove: sustained high energy (E:7-9, BPM 90-130)
    if (e >= 7 && b >= 90 && b <= 130) return 'groove';
    
    // party: peak energy (E:8-10, BPM 128+)
    if (e >= 8 && b >= 128) return 'party';
    
    // fallback based on energy only
    if (e >= 8) return 'party';
    if (e >= 6) return 'groove';
    return 'arrival';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPlaylist(id, limit = 90) {
    try {
        const res = await fetch(`https://api.deezer.com/playlist/${id}/tracks?limit=${limit}`);
        const data = await res.json();
        return data.data || [];
    } catch (e) {
        console.error(`Error fetching playlist ${id}: ${e.message}`);
        return [];
    }
}

async function fetchTrackBPM(id) {
    try {
        const res = await fetch(`https://api.deezer.com/track/${id}`);
        const data = await res.json();
        return { bpm: data.bpm || 0, duration: data.duration || 0, rank: data.rank || 0, preview: data.preview || '' };
    } catch (e) {
        return { bpm: 0, duration: 0, rank: 0, preview: '' };
    }
}

function guessGenre(artistName, playlistGenre) {
    if (playlistGenre !== 'Mixed') return playlistGenre;
    const lower = artistName.toLowerCase();
    for (const [key, genre] of Object.entries(ARTIST_GENRE_MAP)) {
        if (lower.includes(key)) return genre;
    }
    return 'Pop'; // safe default for Mixed playlists
}

async function main() {
    console.log('═'.repeat(70));
    console.log('FETCH & CLASSIFY — Deezer Playlists → Curated V3');
    console.log('═'.repeat(70));

    // Load existing V2 base
    const baseV2 = JSON.parse(fs.readFileSync('./curated_base_v2.json', 'utf-8'));
    const existingIDs = new Set(baseV2.tracks.filter(t => t.deezerID > 0).map(t => t.deezerID));
    const existingNormKeys = new Set(baseV2.tracks.map(t => 
        `${t.title.toLowerCase().replace(/[^a-z0-9]/g,'')}_${(t.artist||'').toLowerCase().replace(/[^a-z0-9]/g,'')}`
    ));
    
    console.log(`\nBase V2 existante: ${baseV2.tracks.length} tracks`);
    console.log(`IDs connus: ${existingIDs.size}`);

    // Fetch all playlists
    const newTracks = [];
    console.log(`\n📡 Fetch des ${PLAYLISTS.length} playlists (90 tracks each)...\n`);
    
    for (const pl of PLAYLISTS) {
        const raw = await fetchPlaylist(pl.id);
        let added = 0;
        
        for (const item of raw) {
            const id = item.id || 0;
            const title = item.title || '';
            const artist = (item.artist?.name) || '';
            const duration = item.duration || 0;
            
            if (!id || !title || !artist) continue;
            if (duration < 90 || duration > 600) continue;
            
            const normKey = `${title.toLowerCase().replace(/[^a-z0-9]/g,'')}_${artist.toLowerCase().replace(/[^a-z0-9]/g,'')}`;
            
            if (existingIDs.has(id) || existingNormKeys.has(normKey)) continue;
            
            const genre = guessGenre(artist, pl.genre);
            
            newTracks.push({
                deezerID: id,
                genre,
                title,
                artist,
                bpm: item.bpm || 0,
                energy: 0, // will need manual or Claude classification
                duration,
                source: `deezer_playlist_${pl.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
                phase: 'unclassified',
            });
            existingIDs.add(id);
            existingNormKeys.add(normKey);
            added++;
        }
        
        console.log(`  ✅ ${pl.name.padEnd(25)} → ${raw.length} fetched, ${added} nouveaux`);
        await sleep(200);
    }
    
    console.log(`\n📦 ${newTracks.length} nouvelles tracks des playlists Deezer`);

    // Enrich BPMs for new tracks missing BPM
    const needBPM = newTracks.filter(t => t.bpm === 0);
    console.log(`\n🎵 Enrichissement BPM: ${needBPM.length} tracks...`);
    
    for (let i = 0; i < needBPM.length; i++) {
        const info = await fetchTrackBPM(needBPM[i].deezerID);
        if (info.bpm > 0) needBPM[i].bpm = info.bpm;
        if (info.duration > 0) needBPM[i].duration = info.duration;
        if (info.rank > 0) needBPM[i].rank = info.rank;
        if (info.preview) needBPM[i].preview = info.preview;
        
        if ((i + 1) % 100 === 0) {
            const withBPM = needBPM.slice(0, i+1).filter(t => t.bpm > 0).length;
            console.log(`  ${i + 1}/${needBPM.length} — ${withBPM} BPM trouvés`);
            await sleep(1000);
        }
        await sleep(80);
    }

    // Classify phase for all new tracks
    let classified = 0;
    for (const t of newTracks) {
        t.phase = classifyPhase(t.bpm, t.energy);
        if (t.phase !== 'unclassified') classified++;
    }
    console.log(`\n📊 Phase classifiée: ${classified}/${newTracks.length} tracks`);

    // Combine V2 + new playlist tracks
    // Also classify phase for V2 tracks that don't have it
    for (const t of baseV2.tracks) {
        if (!t.phase) t.phase = classifyPhase(t.bpm, t.energy);
    }

    const allTracks = [...baseV2.tracks, ...newTracks];

    // Stats
    const stats = {
        total: allTracks.length,
        withDeezerID: allTracks.filter(t => t.deezerID > 0).length,
        withBPM: allTracks.filter(t => (t.bpm || 0) > 0).length,
        withEnergy: allTracks.filter(t => (t.energy || 0) > 0).length,
        byGenre: {},
        byPhase: {},
        bySource: {},
        newFromPlaylists: newTracks.length,
    };
    allTracks.forEach(t => {
        stats.byGenre[t.genre] = (stats.byGenre[t.genre] || 0) + 1;
        stats.byPhase[t.phase || 'unclassified'] = (stats.byPhase[t.phase || 'unclassified'] || 0) + 1;
        const src = t.source?.startsWith('deezer_playlist') ? 'deezer_playlist' : t.source || 'unknown';
        stats.bySource[src] = (stats.bySource[src] || 0) + 1;
    });

    // Save V3
    const v3 = {
        version: 3,
        generatedAt: new Date().toISOString(),
        stats,
        tracks: allTracks.sort((a, b) => {
            if (a.genre !== b.genre) return a.genre.localeCompare(b.genre);
            return (a.artist || '').localeCompare(b.artist || '');
        }),
    };
    fs.writeFileSync('./curated_base_v3.json', JSON.stringify(v3, null, 2));

    // Print report
    console.log(`\n${'═'.repeat(70)}`);
    console.log('CURATED BASE V3 — RAPPORT');
    console.log('═'.repeat(70));
    console.log(`Total          : ${stats.total}`);
    console.log(`+Playlist      : +${newTracks.length} nouvelles tracks`);
    console.log(`Avec deezerID  : ${stats.withDeezerID}`);
    console.log(`Avec BPM       : ${stats.withBPM}`);
    console.log(`Avec Energy    : ${stats.withEnergy}`);

    console.log('\nPar genre:');
    Object.entries(stats.byGenre).sort((a,b) => b[1]-a[1]).forEach(([g,c]) => {
        console.log(`  ${g.padEnd(15)}: ${String(c).padStart(3)}`);
    });

    console.log('\nPar phase:');
    Object.entries(stats.byPhase).sort((a,b) => b[1]-a[1]).forEach(([p,c]) => {
        console.log(`  ${p.padEnd(15)}: ${String(c).padStart(3)}`);
    });

    // Generate Claude prompt
    const tracksForClaude = allTracks
        .filter(t => t.deezerID > 0) // only resolved tracks
        .map(t => `${t.artist} — ${t.title} | genre:${t.genre} | bpm:${t.bpm||'?'} | energy:${t.energy||'?'} | phase:${t.phase||'?'}`);

    const claudePrompt = `Tu es un expert DJ et curateur musical pour SocialMix, une app de DJ intelligent pour soirées privées.

SocialMix a 6 phases de soirée:
- arrival   : accueil des invités (E:3-5, BPM doux, ambiance légère)
- ambiance  : montée progressive (E:5-7, BPM 110-125, genre principal s'installe)
- takeoff   : décollage (E:7-9, BPM 125-135, énergie monte vite)
- groove    : plateau dansant (E:7-9, BPM 120-130, varié mais cohérent)
- party     : pic de soirée (E:8-10, BPM 128+, énergie max)
- closing   : fin de soirée (E:5-7, BPM 80-120, classiques intemporels)

Genres SocialMix valides: House, Electro, Hip-Hop, Pop, Disco, Latin, Reggaeton, Rock, Afro, R&B, Variété Fr, Années 80

Pour CHAQUE track ci-dessous, réponds sur UNE LIGNE au format JSON:
{"id": "ARTIST — TITLE", "genre_ok": true/false, "genre_suggest": "...", "phase_ok": true/false, "phase_suggest": "...", "energy_suggest": N, "verdict": "✅ ok" | "⚠️ reclassifier" | "🔴 supprimer", "note": "..."}

Critères d'évaluation:
- genre_ok: le genre SocialMix est-il correct pour cet artiste/titre ?
- phase_ok: la phase assignée est-elle cohérente avec l'énergie et le style ?
- energy_suggest: estime l'énergie de 1-10 si elle est à 0 ou incorrecte
- verdict "supprimer" si: karaoke, cover, 8-bit, compilaton, ambient, titre non-fête

TRACKS À ANALYSER (${tracksForClaude.length} tracks):

${tracksForClaude.join('\n')}

Réponds uniquement avec les JSONs, un par ligne, sans markdown, sans explication.`;

    fs.writeFileSync('./claude_audit_prompt.txt', claudePrompt);
    
    const tokenEstimate = Math.round(claudePrompt.length / 4);
    console.log(`\n✅ curated_base_v3.json sauvé (${stats.total} tracks)`);
    console.log(`✅ claude_audit_prompt.txt généré`);
    console.log(`   ${tracksForClaude.length} tracks à auditer | ~${tokenEstimate} tokens estimés`);
    console.log(`\nProchain: node run_claude_audit.mjs (appel Claude API)`);
}

main().catch(console.error);
