const fs = require('fs');

const allRetro = [
  {"id": "seed_2378226775", "energy": 7, "popularity": 5},
  {"id": "seed_1794017907", "energy": 6, "popularity": 6},
  {"id": "seed_923495502", "energy": 7, "popularity": 7},
  {"id": "seed_870821062", "energy": 7, "popularity": 5},
  {"id": "seed_1761408177", "energy": 7, "popularity": 7},
  {"id": "seed_2607111392", "energy": 7, "popularity": 6},
  {"id": "seed_2387373015", "energy": 7, "popularity": 9},
  {"id": "seed_128743595", "energy": 8, "popularity": 10},
  {"id": "seed_128743581", "energy": 8, "popularity": 10},
  {"id": "seed_124603270", "energy": 6, "popularity": 10},
  {"id": "seed_916424", "energy": 9, "popularity": 10},
  {"id": "seed_1109731", "energy": 9, "popularity": 10},
  {"id": "seed_9849814", "energy": 9, "popularity": 8},
  {"id": "seed_wa6eaidgr", "energy": 7, "popularity": 5},
  {"id": "seed_ybvw9oewz", "energy": 6, "popularity": 5},
  {"id": "seed_2150767297", "energy": 6, "popularity": 5},
  {"id": "seed_1584589772", "energy": 9, "popularity": 9},
  {"id": "seed_2486148031", "energy": 7, "popularity": 6},
  {"id": "seed_dkiwkvnm8", "energy": 8, "popularity": 9},
  {"id": "seed_2500843671", "energy": 7, "popularity": 5},
  {"id": "seed_2279800907", "energy": 7, "popularity": 8},
  {"id": "seed_2525649041", "energy": 7, "popularity": 8},
  {"id": "seed_2550505012", "energy": 7, "popularity": 8},
  {"id": "seed_mojbzvwkt", "energy": 7, "popularity": 8},
  {"id": "seed_2536642561", "energy": 8, "popularity": 5},
  {"id": "seed_2154046487", "energy": 7, "popularity": 8},
  {"id": "seed_2440390415", "energy": 7, "popularity": 5},
  {"id": "seed_1056838", "energy": 8, "popularity": 8},
  {"id": "seed_2330156075", "energy": 5, "popularity": 5},
  {"id": "seed_3788177632", "energy": 6, "popularity": 5},
  {"id": "seed_61424045", "energy": 8, "popularity": 10},
  {"id": "seed_61424044", "energy": 9, "popularity": 10},
  {"id": "seed_2525070311", "energy": 7, "popularity": 6},
  {"id": "seed_2004920127", "energy": 7, "popularity": 6},
  {"id": "seed_2047662477", "energy": 7, "popularity": 8},
  {"id": "seed_eyc115pdx", "energy": 7, "popularity": 5},
  {"id": "seed_2303767705", "energy": 7, "popularity": 5},
  {"id": "seed_38lhszive", "energy": 7, "popularity": 5},
  {"id": "seed_3616651", "energy": 8, "popularity": 9},
  {"id": "seed_2492986081", "energy": 7, "popularity": 5},
  {"id": "seed_2324042205", "energy": 6, "popularity": 3},
  {"id": "seed_1940385147", "energy": 6, "popularity": 5},
  {"id": "seed_2081099267", "energy": 7, "popularity": 5},
  {"id": "seed_2081099277", "energy": 7, "popularity": 5},
  {"id": "seed_2674130352", "energy": 7, "popularity": 5},
  {"id": "seed_2352206125", "energy": 7, "popularity": 6},
  {"id": "seed_zdpzxvr63", "energy": 8, "popularity": 9},
  {"id": "seed_j6m4yxlm4", "energy": 7, "popularity": 3},
  {"id": "seed_2482275341", "energy": 7, "popularity": 4},
  {"id": "seed_2459444615", "energy": 7, "popularity": 5}
];

const batch2Path = '/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_2.json';
const batch2 = JSON.parse(fs.readFileSync(batch2Path, 'utf8'));

let updated = 0;
for (const track of batch2) {
    const retro = allRetro.find(r => r.id === track.id);
    if (retro) {
        track.energy = retro.energy;
        track.popularity = retro.popularity;
        updated++;
    }
}

fs.writeFileSync(batch2Path, JSON.stringify(batch2, null, 2));
console.log(`Updated ${updated} tracks in batch 2.`);
