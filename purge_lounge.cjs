const fs = require('fs');

const seedPaths = [
    './editorial_seed.json',
    '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json'
];

const metaPath = '../SocialMixApp/SocialMixApp/Resources/track_metadata.json';

const blacklist = [
    'diana krall', 'tony bennett', 'frank sinatra', 'michael buble', 
    'madeleine peyroux', 'stacey kent', 'melody gardot', 'gregory porter', 'jamie cullum', 
    'kenny g', 'george benson', 'pat metheny', 'antonio carlos jobim',
    'stan getz', 'astrud gilberto', 'sade', 'anita baker', 'keith jarrett', 'brad mehldau', 
    'esperanza spalding', 'bill frisell', 'bill evans', 'dave brubeck', 'john coltrane', 
    'sonny rollins', 'wayne shorter', 'charles mingus', 'oscar peterson', 'erykah badu', 
    'jill scott', 'bilal', 'd\'angelo'
];

const whitelist = [
    'new york, new york',
    'smooth operator',
    'give me the night',
    'rockit',
    'brown sugar'
];

function normalize(str) {
    if (!str) return '';
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

let removedCount = 0;

seedPaths.forEach(p => {
    if (!fs.existsSync(p)) return;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    data.tracks = data.tracks.filter(t => {
        const aNorm = normalize(t.artist);
        const tNorm = normalize(t.title);
        if (blacklist.some(b => aNorm.includes(b))) {
            if (whitelist.some(w => tNorm.includes(w))) return true;
            console.log(`[SEED] Purged: ${t.artist} - ${t.title}`);
            removedCount++;
            return false;
        }
        return true;
    });
    data.trackCount = data.tracks.length;
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
});

if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    let metaRemoved = 0;
    for (const key in meta) {
        const t = meta[key];
        const aNorm = normalize(t.artist || key);
        const tNorm = normalize(t.title || key);
        if (blacklist.some(b => aNorm.includes(b))) {
            if (whitelist.some(w => tNorm.includes(w))) continue;
            console.log(`[META] Purged: ${t.artist || key} - ${t.title}`);
            delete meta[key];
            removedCount++;
            metaRemoved++;
        }
    }
    if (metaRemoved > 0) fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

console.log(`Total purged: ${removedCount}`);
