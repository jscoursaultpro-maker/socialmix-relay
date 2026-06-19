const fs = require('fs');
const metaPath = '../SocialMixApp/SocialMixApp/Resources/track_metadata.json';
if (!fs.existsSync(metaPath)) {
    console.log("No track_metadata.json found");
    process.exit(0);
}
const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

const jazzArtists = [
    'chet baker', 'miles davis', 'norah jones', 'nina simone', 'frank sinatra', 
    'ella fitzgerald', 'louis armstrong', 'diana krall', 'duke ellington', 'john coltrane', 
    'bill evans', 'dave brubeck', 'stan getz', 'nat king cole', 'billie holiday', 
    'sarah vaughan', 'ray charles', 'aretha franklin', 'amy winehouse',
    'charlie parker', 'thelonious monk', 'herbie hancock', 'django reinhardt',
    'wynton marsalis', 'gregory porter', 'jamie cullum', 'michael bublé', 'michael buble',
    'melody gardot', 'madeleine peyroux', 'katie melua', 'stacey kent', 'ibrahim maalouf',
    'marcus miller', 'george benson', 'grover washington', 'kenny g'
];

let count = 0;
for (const [key, track] of Object.entries(data)) {
    let genre = track.genre || '';
    if (genre.toLowerCase().includes('jazz') || genre.toLowerCase() === 'classique' || genre.toLowerCase() === 'chill') {
        console.log(`[Genre] ${key} - ${genre}`);
        count++;
        continue;
    }
    if (jazzArtists.some(ja => key.includes(ja))) {
        console.log(`[Artist] ${key} - ${genre}`);
        count++;
    }
}
console.log(`Found ${count} jazz tracks in track_metadata.json`);
