const fs = require('fs');
const path = require('path');

// Normalization function (similar to DJBrain)
function normalizeMetadataGenre(g) {
    if (!g) return "";
    let low = g.toLowerCase().trim();
    if (low === "variété française" || low === "french pop") return "COCOVARIET";
    if (low === "rap" || low === "rap français" || low === "hip hop") return "Hip-Hop";
    if (low === "dance" || low === "electronic") return "Electro";
    if (low === "rnb" || low === "r&b") return "R&B";
    if (low === "afrobeats" || low === "afro pop") return "Afro";
    
    // Capitalize first letter logic for exact matches
    const map = {
        "electro": "Electro", "house": "House", "pop": "Pop", 
        "disco": "Disco", "hip-hop": "Hip-Hop", "latin": "Latin",
        "afro": "Afro", "reggaeton": "Reggaeton", "r&b": "R&B", "rock": "Rock"
    };
    return map[low] || g;
}

function normalizeKey(title, artist) {
    let t = (title || "").toLowerCase();
    let a = (artist || "").toLowerCase();
    
    // basic replace
    t = t.replace(/\(.*?\)/g, "").replace(/\[.*?\]/g, "");
    t = t.replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
    
    a = a.replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
    return `${t}_${a}`;
}

const allTracks = new Map(); // key -> object

// 1. Load editorial_seed.json
const seedPath = path.join(__dirname, 'editorial_seed.json');
if (fs.existsSync(seedPath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    for (const track of seed.tracks) {
        const key = track.fallbackHash || normalizeKey(track.title, track.artist);
        allTracks.set(key, {
            id: `seed_${track.providers?.deezer?.trackId || Math.random().toString(36).substr(2, 9)}`,
            title: track.title,
            artist: track.artist,
            album: null,
            currentGenre: track.genre,
            source: "editorial_seed"
        });
    }
}

// 2. Load track_metadata.json
const metaPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Resources/track_metadata.json');
if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    for (const [id, track] of Object.entries(meta)) {
        const title = track.title;
        const artist = track.artist;
        const rawGenre = track.genre || "";
        const genre = normalizeMetadataGenre(rawGenre);
        
        const key = normalizeKey(title, artist);
        if (!allTracks.has(key)) {
            allTracks.set(key, {
                id: `meta_${id}`,
                title: title,
                artist: artist,
                album: null,
                currentGenre: genre || "Unknown",
                source: "track_metadata"
            });
        }
    }
}

// 3. Extract Curated from DJBrain.swift
const djBrainPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift');
if (fs.existsSync(djBrainPath)) {
    const content = fs.readFileSync(djBrainPath, 'utf8');
    const regex = /CuratedTrack\(deezerID:\s*(-?\d+),\s*genre:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*artist:\s*"([^"]+)"/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const [_, id, genre, title, artist] = match;
        const key = normalizeKey(title, artist);
        if (!allTracks.has(key)) {
            allTracks.set(key, {
                id: `curated_${id}`,
                title: title,
                artist: artist,
                album: null,
                currentGenre: genre,
                source: "curated"
            });
        }
    }
}

// Export to array
const outArray = Array.from(allTracks.values()).map(t => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    currentGenre: t.currentGenre
}));

fs.writeFileSync(path.join(__dirname, 'bdd_export_for_classification.json'), JSON.stringify(outArray, null, 2));
console.log(`Exported ${outArray.length} unique tracks to bdd_export_for_classification.json`);
