const fs = require('fs');

const processBatch = (filename) => {
    const path = `/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/${filename}`;
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));

    let updated = 0;
    for (const track of data) {
        let e = 6;
        let p = 5;
        
        const g = track.newGenre;
        const t = (track.title || "").toLowerCase();
        const a = (track.artist || "").toLowerCase();
        const fullSearch = t + " " + a;

        // Base energy & popularity from genre
        if (g === 'Electro' || g === 'Rock') { e = 8; p = 6; }
        else if (g === 'House' || g === 'Disco') { e = 7; p = 5; }
        else if (g === 'Hip-Hop' || g === 'Afro' || g === 'Latin' || g === 'Reggaeton') { e = 7; p = 7; }
        else if (g === 'Pop' || g === 'COCOVARIET') { e = 6; p = 7; }
        else if (g === 'R&B') { e = 5; p = 6; }
        else if (g === 'Unknown') { e = 5; p = 3; }
        
        // Specific Overrides for Popularity and Energy based on artist
        if (fullSearch.includes("queen") || fullSearch.includes("michael jackson") || fullSearch.includes("daft punk") || fullSearch.includes("david guetta") || fullSearch.includes("avicii") || fullSearch.includes("rihanna") || fullSearch.includes("shakira") || fullSearch.includes("daddy yankee") || fullSearch.includes("eminem")) {
            p = 9;
            if (e < 7) e = 8;
        }
        if (fullSearch.includes("jul") || fullSearch.includes("gims") || fullSearch.includes("aya nakamura") || fullSearch.includes("indochine") || fullSearch.includes("stromae")) {
            p = 9; // very popular in FR
        }
        if (fullSearch.includes("beyoncé") || fullSearch.includes("lady gaga") || fullSearch.includes("katy perry") || fullSearch.includes("bruno mars") || fullSearch.includes("coldplay")) {
            p = 9;
        }

        // Banger / Chill overrides
        if (g === 'Unknown' && (track.reasoning || "").toLowerCase().includes("chill")) {
            e = 3; p = 4;
        }
        if ((track.reasoning || "").toLowerCase().includes("classique")) {
            e = 2; p = 2;
        }

        // Set them
        track.energy = track.energy !== undefined ? track.energy : e;
        track.popularity = track.popularity !== undefined ? track.popularity : p;
        updated++;
    }

    fs.writeFileSync(path, JSON.stringify(data, null, 2));
    return updated;
};

const count3 = processBatch('genre_corrections_batch_3.json');
const count4 = processBatch('genre_corrections_batch_4.json');

console.log(`Updated ${count3} tracks in batch 3.`);
console.log(`Updated ${count4} tracks in batch 4.`);
