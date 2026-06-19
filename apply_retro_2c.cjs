const fs = require('fs');

const allRetro = [
  {"id": "seed_1881003417", "energy": 6, "popularity": 7},
  {"id": "seed_2485118", "energy": 7, "popularity": 10},
  {"id": "seed_2435238", "energy": 8, "popularity": 8},
  {"id": "seed_7375556", "energy": 8, "popularity": 9},
  {"id": "seed_772603752", "energy": 7, "popularity": 7},
  {"id": "seed_136336110", "energy": 7, "popularity": 9},
  {"id": "seed_uf2fbbpab", "energy": 4, "popularity": 5},
  {"id": "seed_447098092", "energy": 6, "popularity": 9},
  {"id": "seed_2147487627", "energy": 5, "popularity": 6},
  {"id": "seed_3231101771", "energy": 5, "popularity": 6},
  {"id": "seed_l22d99imn", "energy": 7, "popularity": 9},
  {"id": "seed_797228462", "energy": 6, "popularity": 8},
  {"id": "seed_2433524015", "energy": 6, "popularity": 5},
  {"id": "seed_3030780521", "energy": 6, "popularity": 5},
  {"id": "seed_4162078", "energy": 8, "popularity": 9},
  {"id": "seed_65232772", "energy": 8, "popularity": 9},
  {"id": "seed_72717420", "energy": 7, "popularity": 9},
  {"id": "seed_o2l63hc3f", "energy": 5, "popularity": 7},
  {"id": "seed_2405369625", "energy": 5, "popularity": 4},
  {"id": "seed_2536747241", "energy": 5, "popularity": 4},
  {"id": "seed_124237488", "energy": 7, "popularity": 9},
  {"id": "seed_565127", "energy": 7, "popularity": 9},
  {"id": "seed_1324559462", "energy": 7, "popularity": 8},
  {"id": "seed_135412704", "energy": 7, "popularity": 6},
  {"id": "seed_135203382", "energy": 7, "popularity": 6},
  {"id": "seed_3528163", "energy": 5, "popularity": 6},
  {"id": "seed_12565421", "energy": 8, "popularity": 10},
  {"id": "seed_12565420", "energy": 9, "popularity": 10},
  {"id": "seed_2166864777", "energy": 7, "popularity": 8},
  {"id": "seed_2485949771", "energy": 6, "popularity": 6},
  {"id": "seed_2290823805", "energy": 4, "popularity": 6},
  {"id": "seed_1953253637", "energy": 4, "popularity": 6},
  {"id": "seed_623698142", "energy": 7, "popularity": 10},
  {"id": "seed_679217", "energy": 7, "popularity": 9},
  {"id": "seed_2135303217", "energy": 6, "popularity": 5},
  {"id": "seed_yxjkcbt4y", "energy": 5, "popularity": 4},
  {"id": "seed_1242670642", "energy": 7, "popularity": 7},
  {"id": "seed_j3v8n41p9", "energy": 7, "popularity": 7},
  {"id": "seed_4763165", "energy": 8, "popularity": 10},
  {"id": "seed_2266742737", "energy": 7, "popularity": 8},
  {"id": "seed_2425671805", "energy": 6, "popularity": 5},
  {"id": "seed_3442901201", "energy": 7, "popularity": 6},
  {"id": "seed_2440763155", "energy": 6, "popularity": 8},
  {"id": "seed_78098991", "energy": 7, "popularity": 9},
  {"id": "seed_2292149325", "energy": 6, "popularity": 6},
  {"id": "seed_2454947975", "energy": 6, "popularity": 4},
  {"id": "seed_10308117", "energy": 8, "popularity": 9},
  {"id": "seed_2886526102", "energy": 6, "popularity": 5},
  {"id": "seed_agcd5jl2t", "energy": 6, "popularity": 5},
  {"id": "seed_2422952525", "energy": 6, "popularity": 6}
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

// For remaining missing tracks in batch2, fill default dynamically
for (const track of batch2) {
    if (track.energy === undefined) {
        let e = 6;
        let p = 5;
        if (track.newGenre === 'Electro' || track.newGenre === 'Rock') { e = 8; p = 6; }
        else if (track.newGenre === 'House' || track.newGenre === 'Disco') { e = 7; p = 5; }
        else if (track.newGenre === 'Hip-Hop' || track.newGenre === 'Afro' || track.newGenre === 'Latin' || track.newGenre === 'Reggaeton') { e = 7; p = 7; }
        else if (track.newGenre === 'Pop' || track.newGenre === 'COCOVARIET') { e = 6; p = 7; }
        else if (track.newGenre === 'R&B') { e = 5; p = 6; }
        
        track.energy = e;
        track.popularity = p;
        updated++;
    }
}

fs.writeFileSync(batch2Path, JSON.stringify(batch2, null, 2));
console.log(`Updated ${updated} tracks in batch 2.`);
