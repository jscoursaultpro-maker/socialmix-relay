const fs = require('fs');

const blacklist = [
    'diana krall', 'tony bennett', 'frank sinatra', 'michael bublé', 'michael buble',
    'madeleine peyroux', 'stacey kent', 'melody gardot', 'gregory porter', 'jamie cullum', 
    'kenny g', 'george benson', 'pat metheny', 'antônio carlos jobim', 'antonio carlos jobim',
    'stan getz', 'astrud gilberto', 'sade', 'anita baker', 'keith jarrett', 'brad mehldau', 
    'esperanza spalding', 'bill frisell', 'bill evans', 'dave brubeck', 'john coltrane', 
    'sonny rollins', 'wayne shorter', 'charles mingus', 'oscar peterson', 'erykah badu', 
    'jill scott', 'bilal', 'd\'angelo'
];

function normalize(str) {
    if (!str) return '';
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

const data = JSON.parse(fs.readFileSync('./genre_corrections_batch_1.json', 'utf8'));
let count = 0;
data.forEach(t => {
    const artistNorm = normalize(t.artist);
    if (blacklist.some(b => artistNorm.includes(b))) {
        console.log(`${t.artist} - ${t.title}`);
        count++;
    }
});
console.log(`Found ${count} tracks in genre_corrections_batch_1`);
