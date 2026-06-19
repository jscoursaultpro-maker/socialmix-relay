const fs = require('fs');

const brainPath = '/Users/Jean-Sebastien/App Workshop/Virtual DJ V3/SocialMixApp/SocialMixApp/Engine/DJBrain.swift';
let brainContent = fs.readFileSync(brainPath, 'utf8');

const skipped = JSON.parse(fs.readFileSync('skipped_tracks.json', 'utf8'));

// We need to inject them at the end of the curatedTracks array
const searchStr = '    ]';
const endIndex = brainContent.indexOf(searchStr, brainContent.indexOf('private var curatedTracks: [CuratedTrack] = ['));

if (endIndex === -1) {
    console.error("Could not find end of curatedTracks array");
    process.exit(1);
}

let newLines = `\n        // ── 435 RESCUED SEED TRACKS ──\n`;
let added = 0;

for (const t of skipped) {
    // Escape quotes
    const swiftTitle = (t.title || "Unknown").replace(/"/g, '\\"');
    const swiftArtist = (t.artist || "Unknown").replace(/"/g, '\\"');
    let g = t.genre || "Unknown";
    if (g === "Techno") g = "Electro";
    
    // Check if it's already in the swift file (e.g., Patrick Hernandez which I added manually)
    if (brainContent.includes(`title: "${swiftTitle}", artist: "${swiftArtist}"`)) {
        continue;
    }
    
    newLines += `        CuratedTrack(deezerID: 0, genre: "${g}", title: "${swiftTitle}", artist: "${swiftArtist}"),\n`;
    added++;
}

const before = brainContent.substring(0, endIndex);
const after = brainContent.substring(endIndex);

const newContent = before + newLines + after;

fs.writeFileSync(brainPath, newContent);
console.log(`Successfully injected ${added} rescued tracks into DJBrain.swift`);
