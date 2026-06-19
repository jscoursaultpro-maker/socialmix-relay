const https = require('https');
https.get('https://api.deezer.com/playlist/1371651955', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const json = JSON.parse(data);
        console.log(`Playlist: ${json.title}`);
        console.log(`Tracks: ${json.tracks.data.length}`);
    });
});
