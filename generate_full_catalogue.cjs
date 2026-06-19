const fs = require('fs');
const path = require('path');

const artifactDir = '/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/';
const batches = [
    'genre_corrections_batch_1.json',
    'genre_corrections_batch_2.json',
    'genre_corrections_batch_3.json',
    'genre_corrections_batch_4.json',
    'genre_corrections_batch_5.json',
    'genre_corrections_batch_6.json',
    'genre_corrections_batch_7.json',
    'genre_corrections_batch_8.json',
    'genre_corrections_batch_9_salsa.json',
    'genre_corrections_batch_10_fuego.json'
];

const uniqueIds = new Set();
let swiftCode = `    // ★ THE ULTIMATE SOCIALMIX CATALOGUE (Generated from Batches 1-10) ★\n    private let curatedTracks: [CuratedTrack] = [\n`;
let totalTracks = 0;

for (const b of batches) {
    const filePath = path.join(artifactDir, b);
    if (fs.existsSync(filePath)) {
        console.log(`Loading ${b}...`);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        for (const t of data) {
            let trackId = 0;
            if (t.id && t.id.startsWith('deezer_')) {
                trackId = parseInt(t.id.replace('deezer_', ''));
            } else if (t.id && t.id.startsWith('seed_')) {
                trackId = parseInt(t.id.replace('seed_', ''));
            } else {
                trackId = parseInt(t.id);
            }
            
            if (isNaN(trackId) || trackId === 0) continue;
            
            if (uniqueIds.has(trackId)) continue;
            uniqueIds.add(trackId);
            
            const swiftTitle = (t.title || "Unknown").replace(/"/g, '\\"');
            const swiftArtist = (t.artist || "Unknown").replace(/"/g, '\\"');
            let g = t.newGenre || "Unknown";
            if (g === "Techno") g = "Electro";
            
            swiftCode += `        CuratedTrack(deezerID: ${trackId}, genre: "${g}", title: "${swiftTitle}", artist: "${swiftArtist}"),\n`;
            totalTracks++;
        }
    } else {
        // Fallback to relay-server directory just in case
        if (fs.existsSync(b)) {
            console.log(`Loading ${b} from relay-server...`);
            const data = JSON.parse(fs.readFileSync(b, 'utf8'));
            for (const t of data) {
                let trackId = 0;
                if (t.id && t.id.startsWith('deezer_')) {
                    trackId = parseInt(t.id.replace('deezer_', ''));
                } else if (t.id && t.id.startsWith('seed_')) {
                    trackId = parseInt(t.id.replace('seed_', ''));
                } else {
                    trackId = parseInt(t.id);
                }
                
                if (isNaN(trackId) || trackId === 0) continue;
                if (uniqueIds.has(trackId)) continue;
                uniqueIds.add(trackId);
                
                const swiftTitle = (t.title || "Unknown").replace(/"/g, '\\"');
                const swiftArtist = (t.artist || "Unknown").replace(/"/g, '\\"');
                let g = t.newGenre || "Unknown";
                if (g === "Techno") g = "Electro";
                
                swiftCode += `        CuratedTrack(deezerID: ${trackId}, genre: "${g}", title: "${swiftTitle}", artist: "${swiftArtist}"),\n`;
                totalTracks++;
            }
        }
    }
}

swiftCode += `    ]\n`;
fs.writeFileSync('full_catalogue.swift', swiftCode);
console.log(`Generated ${totalTracks} tracks.`);
