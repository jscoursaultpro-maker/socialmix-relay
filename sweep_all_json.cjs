const fs = require('fs');

const files = fs.readdirSync('.').filter(f => f.endsWith('.json') && f.includes('batch'));

files.forEach(f => {
    try {
        const data = JSON.parse(fs.readFileSync(f, 'utf8'));
        const tracks = Array.isArray(data) ? data : data.tracks;
        if (!tracks) return;
        tracks.forEach(t => {
            const title = t.title || '';
            const artist = t.artist || '';
            const genre = t.genre || '';
            if (genre.toLowerCase() === 'jazz' || artist.toLowerCase().includes('chet baker') || artist.toLowerCase().includes('miles davis') || artist.toLowerCase().includes('norah jones') || artist.toLowerCase().includes('nina simone') || artist.toLowerCase().includes('frank sinatra') || artist.toLowerCase().includes('ella fitzgerald')) {
                console.log(`[${f}] ${artist} - ${title} [${genre}]`);
            }
        });
    } catch(e) {}
});
