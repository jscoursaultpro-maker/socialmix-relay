const fs = require('fs');

const macroCategories = {
    "Urbain": ["Hip-Hop", "R&B"],
    "Latino": ["Latin", "Reggaeton"],
    "Electro": ["Electro", "Techno"],
    "House": ["House", "Chill", "Unknown"],
    "Afro": ["Afro", "Dancehall"],
    "Pop": ["Pop"],
    "Disco": ["Disco"],
    "Rock": ["Rock"],
    "Variété": ["COCOVARIET", "Années 80"]
};

let totalTracks = 0;
const distribution = {};
const unmapped = [];

for (const cat in macroCategories) {
    distribution[cat] = 0;
}

for (let i = 1; i <= 8; i++) {
    const path = `/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_${i}.json`;
    if (fs.existsSync(path)) {
        const data = JSON.parse(fs.readFileSync(path, 'utf8'));
        totalTracks += data.length;
        
        for (const track of data) {
            const genre = track.newGenre;
            let mapped = false;
            
            for (const [macro, micros] of Object.entries(macroCategories)) {
                if (micros.includes(genre)) {
                    distribution[macro]++;
                    mapped = true;
                    break;
                }
            }
            
            if (!mapped) {
                unmapped.push(genre);
            }
        }
    }
}

console.log("=== VENTILATION DU CATALOGUE ===");
console.log(`Total Tracks : ${totalTracks}`);
console.log("--------------------------------");
const sortedCats = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
for (const [cat, count] of sortedCats) {
    const percentage = ((count / totalTracks) * 100).toFixed(1);
    console.log(`${cat.padEnd(12)}: ${String(count).padStart(4)} tracks (${percentage}%)`);
}

if (unmapped.length > 0) {
    console.log("\n⚠️ ATTENTION - Genres non couverts :");
    const uniqueUnmapped = [...new Set(unmapped)];
    for (const ug of uniqueUnmapped) {
        const count = unmapped.filter(g => g === ug).length;
        console.log(`- ${ug}: ${count} tracks`);
    }
} else {
    console.log("\n✅ Tous les titres sont couverts à 100% par le mapping.");
}
