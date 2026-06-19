const fs = require('fs');
const seedPath = '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

data.tracks.forEach(t => {
    if (['Pop', 'COCOVARIET', 'Other', 'Unknown', 'R&B', 'Rock'].includes(t.genre)) {
        console.log(`${t.artist} - ${t.title} [${t.genre}]`);
    }
});
