const fs = require('fs');
const seedPath = 'SocialMixApp/SocialMixApp/Resources/editorial_seed.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

data.tracks.forEach(track => {
    if (track.artist === "Ter") track.artist = "47Ter";
    if (track.artist === "Savage") track.artist = "21 Savage";
    if (track.artist === "Tubes Au Top") track.artist = "50 Tubes Au Top";
    if (track.artist === "tree") track.artist = "12tree";
});

fs.writeFileSync(seedPath, JSON.stringify(data, null, 2), 'utf8');
console.log("Reverted bad artist names.");
