const fs = require('fs');

const allRetro = [
  {"id": "seed_3023551771", "energy": 7, "popularity": 5},
  {"id": "seed_0z450q00f", "energy": 6, "popularity": 4},
  {"id": "seed_2477249181", "energy": 7, "popularity": 5},
  {"id": "seed_603415762", "energy": 7, "popularity": 5},
  {"id": "seed_14383880", "energy": 9, "popularity": 10},
  {"id": "seed_798382542", "energy": 7, "popularity": 6},
  {"id": "seed_13040252", "energy": 7, "popularity": 9},
  {"id": "seed_103996098", "energy": 8, "popularity": 9},
  {"id": "seed_88936747", "energy": 8, "popularity": 10},
  {"id": "seed_907649", "energy": 6, "popularity": 8},
  {"id": "seed_3155977", "energy": 8, "popularity": 7},
  {"id": "seed_1372670872", "energy": 8, "popularity": 5},
  {"id": "seed_uyctwt0m8", "energy": 8, "popularity": 9},
  {"id": "seed_3348770961", "energy": 8, "popularity": 6},
  {"id": "seed_14405161", "energy": 8, "popularity": 6},
  {"id": "seed_1239694902", "energy": 7, "popularity": 6},
  {"id": "seed_2855541182", "energy": 8, "popularity": 10},
  {"id": "seed_3155984871", "energy": 7, "popularity": 4},
  {"id": "seed_2100102627", "energy": 8, "popularity": 8},
  {"id": "seed_10284909", "energy": 7, "popularity": 9},
  {"id": "seed_721269682", "energy": 6, "popularity": 4},
  {"id": "seed_15165360", "energy": 6, "popularity": 8},
  {"id": "seed_669567072", "energy": 8, "popularity": 6},
  {"id": "seed_3808859012", "energy": 7, "popularity": 6},
  {"id": "seed_373219601", "energy": 7, "popularity": 5},
  {"id": "seed_3639536972", "energy": 7, "popularity": 7},
  {"id": "seed_3155635951", "energy": 7, "popularity": 5},
  {"id": "seed_695110932", "energy": 7, "popularity": 9},
  {"id": "seed_1484242262", "energy": 8, "popularity": 5},
  {"id": "seed_78115474", "energy": 7, "popularity": 6},
  {"id": "seed_510287882", "energy": 7, "popularity": 6},
  {"id": "seed_468390352", "energy": 7, "popularity": 5},
  {"id": "seed_77542036", "energy": 6, "popularity": 7},
  {"id": "seed_2170492547", "energy": 7, "popularity": 7},
  {"id": "seed_429989292", "energy": 7, "popularity": 8},
  {"id": "seed_6u2jsuqkp", "energy": 8, "popularity": 7},
  {"id": "seed_bfn7vyvd2", "energy": 7, "popularity": 5},
  {"id": "seed_123345682", "energy": 7, "popularity": 7},
  {"id": "seed_2609095102", "energy": 5, "popularity": 5},
  {"id": "seed_438850292", "energy": 8, "popularity": 8},
  {"id": "seed_671285982", "energy": 6, "popularity": 3},
  {"id": "seed_79589178", "energy": 7, "popularity": 8},
  {"id": "seed_79589202", "energy": 7, "popularity": 7},
  {"id": "seed_1662709912", "energy": 7, "popularity": 6},
  {"id": "seed_92719900", "energy": 9, "popularity": 10},
  {"id": "seed_2576769042", "energy": 5, "popularity": 4},
  {"id": "seed_l8l8rumb4", "energy": 6, "popularity": 6},
  {"id": "seed_2496474661", "energy": 7, "popularity": 6},
  {"id": "seed_576851252", "energy": 7, "popularity": 9},
  {"id": "seed_576851222", "energy": 7, "popularity": 9}
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
