const https = require('https');
const fs = require('fs');

// Load existing DB to check for duplicates
const existingIds = new Set();
const existingKeys = new Set(); // lowercase "title - artist"

const batches = [
    'genre_corrections_batch_1.json',
    'genre_corrections_batch_2.json',
    'genre_corrections_batch_3.json',
    'genre_corrections_batch_4.json',
    'genre_corrections_batch_5.json',
    'genre_corrections_batch_6.json',
    'genre_corrections_batch_7.json',
    'genre_corrections_batch_8.json',
    'genre_corrections_batch_9_salsa.json'
];

for (const b of batches) {
    if (fs.existsSync(b)) {
        const data = JSON.parse(fs.readFileSync(b, 'utf8'));
        for (const t of data) {
            if (t.id && t.id.startsWith('deezer_')) {
                existingIds.add(parseInt(t.id.replace('deezer_', '')));
            }
            if (t.title && t.artist) {
                const key = `${t.title.toLowerCase().trim()} - ${t.artist.toLowerCase().trim()}`;
                existingKeys.add(key);
            }
        }
    }
}

console.log(`Loaded ${existingKeys.size} unique existing tracks to check against.`);

https.get('https://api.deezer.com/playlist/178699142', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const json = JSON.parse(data);
        const tracks = json.tracks.data;
        
        const corrections = [];
        let swiftCode = `        // ── Fuego Latino curated tracks ──\n`;
        let dupCount = 0;
        
        for (const track of tracks) {
            const t = track.title.toLowerCase().trim();
            const a = track.artist.name.toLowerCase().trim();
            const key = `${t} - ${a}`;
            
            if (existingIds.has(track.id) || existingKeys.has(key)) {
                dupCount++;
                continue;
            }
            
            // Dispatch by genre
            let newGenre = "Latin"; // default
            let energy = 7;
            let popularity = 7;
            const fullSearch = t + " " + a;
            
            if (fullSearch.includes("bad bunny") || fullSearch.includes("j balvin") || fullSearch.includes("daddy yankee") || fullSearch.includes("karol g") || fullSearch.includes("ozuna") || fullSearch.includes("rosalía") || fullSearch.includes("rauw alejandro") || fullSearch.includes("maluma")) {
                newGenre = "Reggaeton";
                energy = 8;
                popularity = 8;
            } else if (fullSearch.includes("shakira") || fullSearch.includes("enrique iglesias") || fullSearch.includes("luis fonsi")) {
                newGenre = "Pop";
                popularity = 9;
            } else if (fullSearch.includes("romeo santos") || fullSearch.includes("aventura") || fullSearch.includes("prince royce")) {
                newGenre = "Latin"; // Bachata
                energy = 6;
            } else if (fullSearch.includes("dj snake") || fullSearch.includes("major lazer")) {
                newGenre = "Electro";
                energy = 8;
            } else if (fullSearch.includes("burna boy") || fullSearch.includes("rema")) {
                newGenre = "Afro";
                energy = 7;
            }
            
            corrections.push({
                id: `deezer_${track.id}`,
                title: track.title,
                artist: track.artist.name,
                currentGenre: "Unknown",
                newGenre: newGenre,
                energy: energy,
                popularity: popularity,
                confidence: "high",
                reasoning: "Playlist Fuego Latino"
            });
            
            const swiftTitle = track.title.replace(/"/g, '\\"');
            const swiftArtist = track.artist.name.replace(/"/g, '\\"');
            swiftCode += `        CuratedTrack(deezerID: ${track.id},  genre: "${newGenre}",    title: "${swiftTitle}", artist: "${swiftArtist}"),\n`;
            
            // Add to known so we don't duplicate within the playlist itself
            existingIds.add(track.id);
            existingKeys.add(key);
        }
        
        fs.writeFileSync('genre_corrections_batch_10_fuego.json', JSON.stringify(corrections, null, 2));
        fs.writeFileSync('fuego_tracks.swift', swiftCode);
        
        console.log(`Playlist has ${tracks.length} tracks.`);
        console.log(`Skipped ${dupCount} duplicates.`);
        console.log(`Saved ${corrections.length} NEW tracks to genre_corrections_batch_10_fuego.json`);
    });
});
