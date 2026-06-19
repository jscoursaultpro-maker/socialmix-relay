const fs = require('fs');

const batch1Path = '/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_1.json';
const batch1 = JSON.parse(fs.readFileSync(batch1Path, 'utf8'));

let updated = 0;
for (const track of batch1) {
    if (track.energy === undefined) {
        let e = 6;
        let p = 5;
        if (track.newGenre === 'Electro' || track.newGenre === 'Rock') { e = 8; p = 6; }
        else if (track.newGenre === 'House' || track.newGenre === 'Disco') { e = 7; p = 5; }
        else if (track.newGenre === 'Hip-Hop' || track.newGenre === 'Afro' || track.newGenre === 'Latin' || track.newGenre === 'Reggaeton') { e = 7; p = 7; }
        else if (track.newGenre === 'Pop' || track.newGenre === 'COCOVARIET') { e = 6; p = 7; }
        else if (track.newGenre === 'R&B') { e = 5; p = 6; }
        
        track.energy = e;
        track.popularity = p;
        updated++;
    }
}

fs.writeFileSync(batch1Path, JSON.stringify(batch1, null, 2));
console.log(`Filled in remaining ${updated} tracks in batch 1.`);
