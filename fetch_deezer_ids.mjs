import fs from 'fs';
import https from 'https';

const seedPath = '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json';
const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const tracks = Object.values(seedData.tracks);

async function searchDeezer(title, artist) {
    return new Promise((resolve) => {
        const query = encodeURIComponent(`track:"${title}" artist:"${artist}"`);
        const url = `https://api.deezer.com/search?q=${query}&limit=1`;
        
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.data && json.data.length > 0) {
                        resolve(json.data[0].id);
                    } else {
                        // Fallback broader search
                        const broadQuery = encodeURIComponent(`${title} ${artist}`);
                        const broadUrl = `https://api.deezer.com/search?q=${broadQuery}&limit=1`;
                        https.get(broadUrl, (res2) => {
                            let data2 = '';
                            res2.on('data', chunk => data2 += chunk);
                            res2.on('end', () => {
                                try {
                                    const json2 = JSON.parse(data2);
                                    if (json2.data && json2.data.length > 0) {
                                        resolve(json2.data[0].id);
                                    } else {
                                        resolve(0);
                                    }
                                } catch(e) { resolve(0); }
                            });
                        }).on('error', () => resolve(0));
                    }
                } catch (e) {
                    resolve(0);
                }
            });
        }).on('error', () => resolve(0));
    });
}

async function run() {
    let updated = 0;
    for (const track of tracks) {
        if (!track.providers || !track.providers.deezer || !track.providers.deezer.trackId) {
            console.log(`Searching for: ${track.title} - ${track.artist}`);
            const id = await searchDeezer(track.title, track.artist);
            if (id > 0) {
                if (!track.providers) track.providers = {};
                if (!track.providers.deezer) track.providers.deezer = {};
                track.providers.deezer.trackId = id;
                console.log(`  -> Found ID: ${id}`);
                updated++;
            } else {
                console.log(`  -> Not found`);
            }
            // Sleep to avoid rate limiting
            await new Promise(r => setTimeout(r, 100));
        }
    }
    
    if (updated > 0) {
        fs.writeFileSync(seedPath, JSON.stringify(seedData, null, 2));
        console.log(`Successfully updated ${updated} tracks!`);
    } else {
        console.log('No tracks updated.');
    }
}

run();
