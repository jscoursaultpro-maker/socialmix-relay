const fs = require('fs');

const seedPath = './editorial_seed.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const tracks = data.tracks;

let found = [];
for (const track of tracks) {
    if (track.genre && track.genre.toLowerCase().includes('jazz')) {
        found.push(track);
    }
}

console.log(`Found ${found.length} tracks with genre Jazz`);

// Let's also check track title or artist for "jazz"
let found2 = [];
for (const track of tracks) {
    if ((track.artist && track.artist.toLowerCase().includes('jazz')) || (track.title && track.title.toLowerCase().includes('jazz'))) {
        found2.push(track);
    }
}
console.log(`Found ${found2.length} tracks with "jazz" in title/artist`);

// What about "Classique"?
let found3 = [];
for (const track of tracks) {
    if (track.genre && track.genre.toLowerCase().includes('classi')) {
        found3.push(track);
    }
}
console.log(`Found ${found3.length} tracks with genre Classique`);

