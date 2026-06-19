const fs = require('fs');

const seedPath = '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const jazzArtists = [
    'chet baker', 'miles davis', 'norah jones', 'nina simone', 'frank sinatra', 
    'ella fitzgerald', 'louis armstrong', 'diana krall', 'duke ellington', 'john coltrane', 
    'bill evans', 'dave brubeck', 'stan getz', 'nat king cole', 'billie holiday', 
    'sarah vaughan', 'ray charles', 'aretha franklin', 'amy winehouse',
    'charlie parker', 'thelonious monk', 'herbie hancock', 'django reinhardt',
    'wynton marsalis', 'gregory porter', 'jamie cullum', 'michael bublé', 'michael buble',
    'melody gardot', 'madeleine peyroux', 'katie melua', 'stacey kent', 'ibrahim maalouf',
    'marcus miller', 'george benson', 'grover washington', 'kenny g',
    'nena', 'snarky puppy', 'cory henry', 'esmerine', 'badbadnotgood', 'kamasi washington',
    'robert glasper', 'yussef dayes', 'alfajores'
];

let found = [];
for (const track of data.tracks) {
    if (!track.artist) continue;
    const artistLower = track.artist.toLowerCase();
    
    // Check if artist matches jazz artists
    if (jazzArtists.some(ja => artistLower.includes(ja))) {
        found.push(track);
    }
}

console.log(`Found ${found.length} tracks by extended jazz artists:`);
found.forEach(t => {
    console.log(`- ${t.artist} - ${t.title} [${t.genre || 'No genre'}]`);
});
