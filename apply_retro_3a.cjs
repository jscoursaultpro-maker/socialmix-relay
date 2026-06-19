const fs = require('fs');

const retroData = JSON.parse(fs.readFileSync('retro_3a.json', 'utf8'));

const batchPath = '/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_3.json';
let batchData = JSON.parse(fs.readFileSync(batchPath, 'utf8'));

let updated = 0;
for (const track of batchData) {
    const retro = retroData.find(r => r.id === track.id);
    if (retro) {
        if (retro.energy !== undefined) track.energy = retro.energy;
        if (retro.popularity !== undefined) track.popularity = retro.popularity;
        updated++;
    }
}

fs.writeFileSync(batchPath, JSON.stringify(batchData, null, 2));
console.log(`Updated ${updated} tracks in batch 3.`);
