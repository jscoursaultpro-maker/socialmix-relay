const fs = require('fs');

const seedPath = 'SocialMixApp/SocialMixApp/Resources/editorial_seed.json';
const data = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

let repairedCount = 0;

data.tracks.forEach(track => {
    if (track.artist === "Unknown" || track.artist === "Unknown Artist" || track.artist.match(/^\d{2,3}/)) {
        let originalTitle = track.title;
        let originalArtist = track.artist;
        let newArtist = track.artist;
        let newTitle = track.title;
        let repaired = false;

        // Pattern 1: 101-the_pussycat_dolls-when_i_grow_up
        const match1 = track.title.match(/^\d+-(.*?)-(.*?)(?:\(.*\))?$/);
        if (match1) {
            newArtist = match1[1].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            newTitle = match1[2].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            repaired = true;
        } 
        // Pattern 2: 05 I Gotta Feeling
        else if ((track.artist === "Unknown" || track.artist === "Unknown Artist") && /^\d{2,3}\s+(.+)$/.test(track.title)) {
            const match2 = track.title.match(/^\d{2,3}\s+(.+)$/);
            newTitle = match2[1];
            // Hardcode some famous ones we saw
            if (newTitle.toLowerCase().includes("gotta feeling") || newTitle.toLowerCase().includes("showdown")) {
                newArtist = "Black Eyed Peas";
            } else if (newTitle.toLowerCase().includes("cooler than me")) {
                newArtist = "Mike Posner";
            } else if (newTitle.toLowerCase().includes("brick by boring brick")) {
                newArtist = "Paramore";
            } else if (newTitle.toLowerCase() === "ghost") {
                newArtist = "Ella Henderson";
            } else {
                newArtist = "Unknown"; // still unknown but title cleaned
            }
            repaired = true;
        }
        // Pattern 3: Compilation fillers "01Salvatore Mancuso"
        else if (/^\d{2,3}(.+)$/.test(track.artist)) {
            const match3 = track.artist.match(/^\d{2,3}(.+)$/);
            newArtist = match3[1].trim();
            repaired = true;
        }

        if (repaired && newArtist !== "Unknown" && newArtist !== "Unknown Artist") {
            console.log(`Repaired: [${originalArtist}] ${originalTitle} -> Artist: ${newArtist} | Title: ${newTitle}`);
            track.artist = newArtist;
            track.title = newTitle;
            repairedCount++;
        }
    }
});

if (repairedCount > 0) {
    fs.writeFileSync(seedPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Successfully repaired ${repairedCount} tracks!`);
} else {
    console.log("No tracks were repaired.");
}
