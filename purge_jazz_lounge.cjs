const fs = require('fs');

const seedPaths = [
    './editorial_seed.json',
    '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json'
];

const blacklist = [
    'diana krall', 'tony bennett', 'frank sinatra', 'michael bublé', 'michael buble',
    'madeleine peyroux', 'stacey kent', 'melody gardot', 'gregory porter', 'jamie cullum', 
    'kenny g', 'george benson', 'pat metheny', 'antônio carlos jobim', 'antonio carlos jobim',
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
    return str.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
        .trim();
}

let breakdown = {};
let totalRemoved = 0;

seedPaths.forEach((seedPath, index) => {
    if (!fs.existsSync(seedPath)) {
        console.log(`Skipping missing file: ${seedPath}`);
        return;
    }
    
    const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const initialCount = data.tracks.length;
    let localRemoved = 0;
    
    data.tracks = data.tracks.filter(t => {
        const artistNorm = normalize(t.artist);
        const titleNorm = normalize(t.title);
        
        const isBlacklisted = blacklist.some(b => artistNorm.includes(b));
        if (isBlacklisted) {
            const isWhitelisted = whitelist.some(w => titleNorm.includes(w));
            if (isWhitelisted) {
                if (index === 0) console.log(`[WHITELISTED] Keeping: ${t.artist} - ${t.title}`);
                return true;
            } else {
                if (index === 0) {
                    console.log(`[PURGED] ${t.artist} - ${t.title}`);
                    // Find which artist caused the purge for the breakdown
                    const matchedArtist = blacklist.find(b => artistNorm.includes(b));
                    breakdown[matchedArtist] = (breakdown[matchedArtist] || 0) + 1;
                }
                localRemoved++;
                return false;
            }
        }
        return true;
    });
    
    data.trackCount = data.tracks.length;
    fs.writeFileSync(seedPath, JSON.stringify(data, null, 2), 'utf8');
    
    if (index === 0) {
        totalRemoved = localRemoved;
    }
});

console.log(`\n=== RÉCAPITULATIF ===`);
console.log(`Total de morceaux supprimés : ${totalRemoved}`);
console.log(`Breakdown par artiste :`);
Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([artist, count]) => {
        console.log(`- ${artist} : ${count}`);
    });

