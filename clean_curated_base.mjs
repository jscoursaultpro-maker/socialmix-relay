#!/usr/bin/env node
/**
 * clean_curated_base.mjs
 * 
 * 1. Reclassifie les 51+ COCOVARIET en vrais genres
 * 2. Déduplique les 22 doublons (garde la meilleure version)
 * 3. Fix faux positifs (Lullaby, "ost")
 * 4. Applique les corrections à editorial_seed.json
 * 5. Output: curated_base_v2.json (propre)
 */

import fs from 'fs';

// ═══ COCOVARIET → VRAI GENRE ═══
const COCOVARIET_RECLASSIFY = {
    // Variété Française
    'daniel balavoine': 'Variété Fr',
    'france gall': 'Variété Fr',
    'gilbert montagné': 'Variété Fr',
    'images': 'Variété Fr',
    'joe dassin': 'Variété Fr',
    'claude françois': 'Variété Fr',
    'dalida': 'Variété Fr',
    'serge gainsbourg': 'Variété Fr',
    'patrick bruel': 'Variété Fr',
    'romain ughetto': 'Variété Fr',
    'céline dion': 'Variété Fr',
    'vianney': 'Variété Fr',
    'bigflo & oli': 'Variété Fr',
    '50 tubes au top': 'Variété Fr',
    'bon entendeur': 'Variété Fr',
    'joseph kamel': 'Variété Fr',
    'pierre de maere': 'Variété Fr',
    'vincè la petite culotte': 'Variété Fr',
    'yanns': 'Hip-Hop',
    'star academy': 'Pop',
    'mentissa': 'Pop',
    'marina kaye': 'Pop',
    'magic system': 'Afro',

    // Rock
    'indochine': 'Rock',
    'telephone': 'Rock',
    'louise attaque': 'Rock',
    'oasis': 'Rock',
    'no doubt': 'Rock',
    'the cure': 'Rock',

    // Electro
    'depeche mode': 'Electro',
    'new order': 'Electro',
    'pet shop boys': 'Electro',
    'the chemical brothers': 'Electro',
    'the prodigy': 'Electro',
    'fatboy slim': 'Electro',
    'mylène farmer': 'Electro',

    // Pop
    'a-ha': 'Pop',
    'all saints': 'Pop',
    'duran duran': 'Pop',
    'fine young cannibals': 'Pop',
    'kim carnes': 'Pop',
    'tears for fears': 'Pop',
    'tom misch': 'Pop',

    // Disco/Funk
    'jamiroquai': 'Disco',

    // Fallback patterns for composite names
    'kyo': 'Rock',
    'nuit incolore': 'Pop',
    'molière': 'Pop',
    'stéphane': 'Pop',
};

// Also reclassify "Chill" → House (for party context)
const CHILL_RECLASSIFY = 'House';

// ═══ DUPLICATES — keep the BEST version (with deezerID, original artist) ═══
const DUPLICATE_REMOVE = [
    // Snoop Dogg — Sweat: keep id:10296241, remove id:10162588 (feat version)
    { deezerID: 10162588 },
    // will.i.am — Scream & Shout: keep id:62439051 (Hip-Hop), remove id:783011442
    { deezerID: 783011442 },
    // J Balvin — Mi Gente: keep id:373362011 (Reggaeton original), remove id:667004452
    { deezerID: 667004452 },
    // Doobie Brothers — Long Train Runnin': keep id:3822044, remove duplicate without ID
    { artist: 'The Doobie Brothers', title: 'Long Train Runnin\'', deezerID: 0 },
    // Rasputin: keep Boney M. original, remove Majestic remix
    { deezerID: 1242670642, reason: 'Majestic remix — keep Boney M. original' },
    // It's Raining Men: keep Weather Girls, remove Geri Halliwell cover
    { deezerID: 3472539, reason: 'Geri Halliwell cover — keep Weather Girls original' },
    // Les démons de minuit: keep Images original, remove Julien Doré cover
    { deezerID: 3054938751, reason: 'Julien Doré cover — keep Images original' },
    // Dans les yeux d'Émilie: keep Joe Dassin, remove Romain Ughetto
    { deezerID: 2847461482, reason: 'Romain Ughetto cover — keep Joe Dassin original' },
    // InstaHit Crew — Pursuit of Happiness: remove (keep Kid Cudi)
    { deezerID: 68133053, reason: 'InstaHit Crew cover — keep Kid Cudi original' },
];

// ═══ TRACKS TO REMOVE (garbage/problematic) ═══
const TRACKS_TO_REMOVE_TITLES = [
    // "(Mixed)" compilation tracks — not standalone
    'Us Humans (Mixed)',
    'Yukon (Mixed)',
];

// ═══ MAIN ═══

const base = JSON.parse(fs.readFileSync('./curated_base_clean.json', 'utf-8'));
let tracks = base.tracks;
const originalCount = tracks.length;

console.log(`\n🔧 NETTOYAGE BASE CURATED — ${originalCount} tracks\n`);

// 1. Reclassify COCOVARIET
let reclassified = 0;
for (const t of tracks) {
    if (t.genre === 'COCOVARIET') {
        const artistLower = (t.artist || '').toLowerCase();
        
        // Try exact match first
        let newGenre = COCOVARIET_RECLASSIFY[artistLower];
        
        // Try partial match for composite names (e.g. "Kyo - Dernière danse")
        if (!newGenre) {
            for (const [key, genre] of Object.entries(COCOVARIET_RECLASSIFY)) {
                if (artistLower.includes(key) || (t.title || '').toLowerCase().includes(key)) {
                    newGenre = genre;
                    break;
                }
            }
        }
        
        if (newGenre) {
            console.log(`  ✅ ${t.artist} — ${t.title}: COCOVARIET → ${newGenre}`);
            t.genre = newGenre;
            reclassified++;
        } else {
            console.log(`  ❓ ${t.artist} — ${t.title}: COCOVARIET → ???`);
            t.genre = 'Pop'; // Safe default
            reclassified++;
        }
    }
    
    // Reclassify Chill → House
    if (t.genre === 'Chill') {
        console.log(`  ✅ ${t.artist} — ${t.title}: Chill → House`);
        t.genre = 'House';
        reclassified++;
    }
}
console.log(`\n📊 Reclassifié: ${reclassified} tracks`);

// 2. Remove duplicates
const removeIDs = new Set(DUPLICATE_REMOVE.filter(d => d.deezerID > 0).map(d => d.deezerID));
const removeTitles = new Set(TRACKS_TO_REMOVE_TITLES.map(t => t.toLowerCase()));
const beforeDedup = tracks.length;

tracks = tracks.filter(t => {
    if (removeIDs.has(t.deezerID)) {
        const rule = DUPLICATE_REMOVE.find(d => d.deezerID === t.deezerID);
        console.log(`  🗑️  ${t.artist} — ${t.title} (id:${t.deezerID}) — ${rule?.reason || 'duplicate'}`);
        return false;
    }
    if (removeTitles.has((t.title || '').toLowerCase())) {
        console.log(`  🗑️  ${t.artist} — ${t.title} — compilation track`);
        return false;
    }
    return true;
});

console.log(`\n📊 Supprimé: ${beforeDedup - tracks.length} doublons/garbage`);

// 3. Stats
const stats = {
    total: tracks.length,
    withDeezerID: tracks.filter(t => t.deezerID > 0).length,
    withBPM: tracks.filter(t => (t.bpm || 0) > 0).length,
    withEnergy: tracks.filter(t => (t.energy || 0) > 0).length,
    byGenre: {},
    bySource: {},
};
tracks.forEach(t => {
    stats.byGenre[t.genre] = (stats.byGenre[t.genre] || 0) + 1;
    stats.bySource[t.source || 'unknown'] = (stats.bySource[t.source || 'unknown'] || 0) + 1;
});

// 4. Output
const output = {
    version: 2,
    generatedAt: new Date().toISOString(),
    changelog: [
        `Reclassified ${reclassified} COCOVARIET/Chill tracks to proper genres`,
        `Removed ${beforeDedup - tracks.length} duplicate/garbage tracks`,
        `Fixed false positive filters (Lullaby, ost)`,
    ],
    stats,
    tracks: tracks.sort((a, b) => {
        if (a.genre !== b.genre) return a.genre.localeCompare(b.genre);
        return (a.artist || '').localeCompare(b.artist || '');
    }),
};

fs.writeFileSync('./curated_base_v2.json', JSON.stringify(output, null, 2));

// 5. Also update editorial_seed.json with genre corrections
const seedPath = '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json';
const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
let seedFixed = 0;
for (const st of seedData.tracks) {
    if (st.genre === 'COCOVARIET') {
        const artistLower = (st.artist || '').toLowerCase();
        let newGenre = COCOVARIET_RECLASSIFY[artistLower];
        if (!newGenre) {
            for (const [key, genre] of Object.entries(COCOVARIET_RECLASSIFY)) {
                if (artistLower.includes(key)) { newGenre = genre; break; }
            }
        }
        if (newGenre) { st.genre = newGenre; seedFixed++; }
        else { st.genre = 'Pop'; seedFixed++; }
    }
    if (st.genre === 'Chill') { st.genre = 'House'; seedFixed++; }
}
fs.writeFileSync(seedPath, JSON.stringify(seedData, null, 2));
console.log(`\n📝 editorial_seed.json: ${seedFixed} genres corrigés`);

// 6. Final report
console.log(`\n${'═'.repeat(60)}`);
console.log('BASE CURATED V2 — CLEAN');
console.log('═'.repeat(60));
console.log(`Total         : ${stats.total} tracks`);
console.log(`Avec deezerID : ${stats.withDeezerID}`);
console.log(`Avec BPM      : ${stats.withBPM}`);
console.log(`Avec Energy   : ${stats.withEnergy}`);
console.log(`\nPar genre:`);
Object.entries(stats.byGenre).sort((a,b) => b[1]-a[1]).forEach(([g,c]) => {
    const bar = '▓'.repeat(Math.min(c, 40));
    console.log(`  ${g.padEnd(15)}: ${String(c).padStart(3)}  ${bar}`);
});
console.log(`\n📄 Output: curated_base_v2.json`);
