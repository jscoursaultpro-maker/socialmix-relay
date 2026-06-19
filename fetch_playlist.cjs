const https = require('https');
const fs = require('fs');

https.get('https://api.deezer.com/playlist/2045665684', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const json = JSON.parse(data);
        const tracks = json.tracks.data;
        
        let swiftCode = `        // ── Salsa & Bachata curated tracks ──\n`;
        
        for (const track of tracks) {
            // we default to Latin genre, popularity 7, energy 7 for now
            // But DJBrain CuratedTracks expect:
            // CuratedTrack(deezerID: 124603270,  genre: "Latin",  title: "Title", artist: "Artist"),
            // BPM is optional or can be 0.
            
            const title = track.title.replace(/"/g, '\\"');
            const artist = track.artist.name.replace(/"/g, '\\"');
            
            swiftCode += `        CuratedTrack(deezerID: ${track.id},  genre: "Latin",    title: "${title}", artist: "${artist}"),\n`;
        }
        
        fs.writeFileSync('playlist_tracks.swift', swiftCode);
        console.log(`Saved ${tracks.length} tracks to playlist_tracks.swift`);
    });
});
