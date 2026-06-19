const fs = require('fs');

const seedPath = './editorial_seed.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const tracks = data.tracks;

// The user mentioned: "Chet Baker ballads, Miles Davis 'Kind of Blue', Norah Jones ballades"
const jazzArtists = ['chet baker', 'miles davis', 'norah jones', 'nina simone', 'frank sinatra', 'ella fitzgerald', 'louis armstrong', 'diana krall', 'duke ellington', 'john coltrane', 'bill evans', 'dave brubeck', 'stan getz', 'nat king cole', 'billie holiday', 'sarah vaughan', 'ray charles', 'aretha franklin', 'amy winehouse'];

let found = [];
for (const track of tracks) {
    if (!track.artist) continue;
    const artistLower = track.artist.toLowerCase();
    
    // Check if artist matches jazz artists
    if (jazzArtists.some(ja => artistLower.includes(ja))) {
        found.push(track);
    }
}

console.log(`Found ${found.length} potential jazz tracks:`);
found.forEach(t => {
    console.log(`- ${t.id} | ${t.artist} - ${t.title} [${t.genre || 'No genre'}]`);
});
