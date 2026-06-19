const fs = require('fs');

const extractRetro = () => {
    const lines = fs.readFileSync('/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/.system_generated/logs/transcript.jsonl', 'utf8').split('\n').filter(Boolean);
    const allRetro = [];

    for (const line of lines) {
        try {
            const step = JSON.parse(line);
            if (step.type === 'USER_INPUT' && step.content) {
                // Extract all lines that look like {"id": "...", "energy": x, "popularity": y}
                const matches = step.content.match(/\{"id":\s*"[^"]+",\s*"energy":\s*\d+,\s*"popularity":\s*\d+\}/g);
                if (matches) {
                    for (const m of matches) {
                        try {
                            allRetro.push(JSON.parse(m));
                        } catch(e){}
                    }
                }
            }
        } catch (e) {}
    }
    return allRetro;
}

const allRetro = extractRetro();
console.log(`Found ${allRetro.length} retro-fit items.`);

const batch1Path = '/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_1.json';
const batch1 = JSON.parse(fs.readFileSync(batch1Path, 'utf8'));

let updated = 0;
for (const track of batch1) {
    const retro = allRetro.find(r => r.id === track.id);
    if (retro) {
        track.energy = retro.energy;
        track.popularity = retro.popularity;
        updated++;
    }
}

fs.writeFileSync(batch1Path, JSON.stringify(batch1, null, 2));
console.log(`Updated ${updated} tracks in batch 1.`);
