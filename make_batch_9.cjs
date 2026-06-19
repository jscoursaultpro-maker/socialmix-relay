const https = require('https');
const fs = require('fs');

https.get('https://api.deezer.com/playlist/2045665684', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const json = JSON.parse(data);
        const tracks = json.tracks.data;
        
        const corrections = [];
        
        for (const track of tracks) {
            corrections.push({
                id: `deezer_${track.id}`,
                title: track.title,
                artist: track.artist.name,
                currentGenre: "Unknown",
                newGenre: "Latin",
                energy: 7,
                popularity: 6,
                confidence: "high",
                reasoning: "Playlist Salsa & Bachata"
            });
        }
        
        fs.writeFileSync('genre_corrections_batch_9_salsa.json', JSON.stringify(corrections, null, 2));
        console.log(`Saved ${corrections.length} tracks to genre_corrections_batch_9_salsa.json`);
    });
});
