const https = require('https');
https.get('https://itunes.apple.com/search?term=Daft+Punk+Get+Lucky&entity=song&limit=1', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log(JSON.parse(data).results[0].previewUrl);
    });
});
