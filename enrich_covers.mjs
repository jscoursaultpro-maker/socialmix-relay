import fs from 'fs';
import path from 'path';

// Chemins des fichiers
const CURATED_DB_PATH = path.resolve('curated_base_v3.json');
const METADATA_PATH = path.resolve('../SocialMixApp/SocialMixApp/Resources/track_metadata.json');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCover(deezerID) {
    try {
        const res = await fetch(`https://api.deezer.com/track/${deezerID}`);
        if (!res.ok) return null;
        const json = await res.json();
        if (json.album && json.album.cover_medium) {
            return json.album.cover_medium;
        }
    } catch (e) {
        // Ignorer les erreurs réseau pour continuer
    }
    return null;
}

async function run() {
    console.log("🌟 Début de l'enrichissement des pochettes Deezer...");

    // 1. Charger les bases de données
    const curatedData = JSON.parse(fs.readFileSync(CURATED_DB_PATH, 'utf-8'));
    const metaData = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));

    // On va créer un dictionnaire de toutes les musiques avec un deezerID
    // pour éviter de faire plusieurs requêtes pour la même musique.
    const tracksToFetch = [];
    for (const track of curatedData.tracks) {
        if (track.deezerID && !track.cover_medium) {
            tracksToFetch.push(track);
        }
    }

    console.log(`🔍 ${tracksToFetch.length} musiques à enrichir trouvées dans curated_base_v3.json`);

    // Fetch séquentiel pour éviter le rate limit strict de Deezer
    let fetched = 0;
    let errors = 0;

    for (let i = 0; i < tracksToFetch.length; i++) {
        const t = tracksToFetch[i];
        const cover = await fetchCover(t.deezerID);
        if (cover) {
            t.cover_medium = cover;
            
            // Mettre à jour aussi dans track_metadata.json
            const metaKey = Object.keys(metaData).find(k => metaData[k].deezerID === t.deezerID);
            if (metaKey) {
                metaData[metaKey].cover_medium = cover;
            }
            fetched++;
        } else {
            errors++;
        }

        process.stdout.write(`\r⏳ Progression : ${i + 1} / ${tracksToFetch.length} (${fetched} succès, ${errors} échecs)`);
        await sleep(50); // Pause de 50ms (20 req/sec, très safe)
    }

    console.log(`\n✅ Terminé ! ${fetched} pochettes ajoutées.`);

    // 2. Sauvegarder les fichiers
    fs.writeFileSync(CURATED_DB_PATH, JSON.stringify(curatedData, null, 2));
    console.log(`💾 curated_base_v3.json mis à jour.`);

    fs.writeFileSync(METADATA_PATH, JSON.stringify(metaData, null, 2));
    console.log(`💾 track_metadata.json mis à jour.`);
    
    console.log("🚀 Tu peux maintenant faire un Clean Build dans Xcode !");
}

run();
