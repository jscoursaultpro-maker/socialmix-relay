const fs = require('fs');
const seedPath = './editorial_seed.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

let genreCounts = {};
for (const track of data.tracks) {
    const genre = track.genre || 'Unknown';
    genreCounts[genre] = (genreCounts[genre] || 0) + 1;
}

console.log(Object.entries(genreCounts).sort((a,b) => b[1] - a[1]));
