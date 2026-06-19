const fs = require('fs');

let countLatin = 0;
let countReggaeton = 0;
let trackLatin = [];
let trackReggaeton = [];

for (let i = 1; i <= 8; i++) {
    const path = `/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_${i}.json`;
    if (fs.existsSync(path)) {
        const data = JSON.parse(fs.readFileSync(path, 'utf8'));
        
        for (const track of data) {
            if (track.newGenre === 'Latin') {
                countLatin++;
                trackLatin.push(`${track.artist} - ${track.title}`);
            } else if (track.newGenre === 'Reggaeton') {
                countReggaeton++;
                trackReggaeton.push(`${track.artist} - ${track.title}`);
            }
        }
    }
}

console.log(`Total Latin: ${countLatin}`);
console.log(`Total Reggaeton: ${countReggaeton}`);
console.log("\nSample Latin:", trackLatin.slice(0, 5));
console.log("Sample Reggaeton:", trackReggaeton.slice(0, 5));
