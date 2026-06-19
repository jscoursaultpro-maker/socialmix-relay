const fs = require('fs');

const seedPath = '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

let jazzCount = 0;
data.tracks.forEach(t => {
    const genre = t.genre || '';
    if (genre.toLowerCase().includes('jazz') || 
        (t.title && t.title.toLowerCase().includes('jazz')) || 
        (t.artist && t.artist.toLowerCase().includes('jazz'))) {
        console.log(`- ${t.artist} - ${t.title} [${genre}]`);
        jazzCount++;
    }
});
console.log(`Found ${jazzCount} jazz tracks in app DB.`);
