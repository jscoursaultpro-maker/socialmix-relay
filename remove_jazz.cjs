const fs = require('fs');

const seedPath = './editorial_seed.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const initialCount = data.tracks.length;

const jazzTitlesToRemove = [
    "So What",
    "Don't Know Why",
    "My Funny Valentine"
];

data.tracks = data.tracks.filter(t => {
    if (!t.title) return true;
    for (const title of jazzTitlesToRemove) {
        if (t.title.includes(title)) {
            console.log(`Removing: ${t.artist} - ${t.title}`);
            return false;
        }
    }
    return true;
});

data.trackCount = data.tracks.length;

fs.writeFileSync(seedPath, JSON.stringify(data, null, 2), 'utf8');
console.log(`Removed ${initialCount - data.tracks.length} tracks. New count: ${data.trackCount}`);
