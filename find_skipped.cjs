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
    'genre_corrections_batch_8.json'
];

let skippedTracks = [];

for (const b of batches) {
    const filePath = path.join(artifactDir, b);
    if (fs.existsSync(filePath)) {
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
            
            if (isNaN(trackId) || trackId === 0) {
                skippedTracks.push({
                    title: t.title,
                    artist: t.artist,
                    id: t.id,
                    genre: t.newGenre
                });
            }
        }
    }
}

fs.writeFileSync('skipped_tracks.json', JSON.stringify(skippedTracks, null, 2));
console.log(`Found ${skippedTracks.length} skipped tracks.`);
