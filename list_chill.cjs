const fs = require('fs');
const seedPath = './editorial_seed.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

let found = [];
for (const track of data.tracks) {
    const genre = track.genre || 'Unknown';
    if (genre === 'Chill' || genre === 'Classique') {
        found.push(track);
    }
}
found.forEach(t => console.log(`${t.artist} - ${t.title} [${t.genre}]`));
