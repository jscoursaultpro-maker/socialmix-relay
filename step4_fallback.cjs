const fs = require('fs');

const path = '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('let finalGenre = (genreRaw == "Unknown" || genreRaw.isEmpty) ? "Pop" : genreRaw')) {
    // replace track.genre = "Unknown" with Pop?
    console.log("Need to patch DJBrain fallback");
}
