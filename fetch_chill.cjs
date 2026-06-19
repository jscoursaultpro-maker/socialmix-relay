const https = require('https');
const fs = require('fs');

https.get('https://api.deezer.com/playlist/1371651955', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const json = JSON.parse(data);
        const tracks = json.tracks.data;
        
        let swiftCode = `        // ── Chill House (Vibe Phase) curated tracks ──\n`;
        
        for (const track of tracks) {
            const title = track.title.replace(/"/g, '\\"');
            const artist = track.artist.name.replace(/"/g, '\\"');
            swiftCode += `        CuratedTrack(deezerID: ${track.id}, genre: "Chill", title: "${title}", artist: "${artist}"),\n`;
        }
        
        fs.writeFileSync('chill_tracks.swift', swiftCode);
        console.log(`Saved ${tracks.length} tracks to chill_tracks.swift`);
    });
});
