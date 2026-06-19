const fs = require('fs');

const seedPath = './editorial_seed.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const initialCount = data.tracks.length;

data.tracks = data.tracks.filter(t => {
    const genre = t.genre || 'Unknown';
    if (genre === 'Classique') return false;
    
    if (genre === 'Chill') {
        const title = t.title || '';
        const artist = t.artist || '';
        if (title.includes('It Runs Through Me') || title.includes('Le temps est bon')) {
            return true; // KEEP
        }
        console.log(`Removing [${genre}]: ${artist} - ${title}`);
        return false;
    }
    
    return true;
});

data.trackCount = data.tracks.length;
fs.writeFileSync(seedPath, JSON.stringify(data, null, 2), 'utf8');

console.log(`Removed ${initialCount - data.tracks.length} tracks. New count: ${data.trackCount}`);
