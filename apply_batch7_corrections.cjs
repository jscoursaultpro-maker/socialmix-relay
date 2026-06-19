const fs = require('fs');

const path = '/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_7.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

for (const track of data) {
    if (track.id === 'meta_Nirvana - Smell like teen spirit.mp3') {
        track.newGenre = 'Rock';
        track.energy = 9;
        track.popularity = 10;
    } else if (track.id === "meta_11 - The next episode (ft Snoop Dogg, Kurupt & Nate Dogg).flac") {
        track.newGenre = 'Hip-Hop';
        track.energy = 8;
        track.popularity = 10;
    } else if (track.id === "meta_01_bingo_players_and_far_east_movement_-_get_up_(rattle).mp3") {
        track.newGenre = 'Electro';
        track.energy = 9;
        track.popularity = 7;
    } else if (track.id === "meta_215_radio_killer-lonely_heart-lzy.mp3") {
        track.newGenre = 'Electro';
    } else if (track.id === "meta_01-medhy_custos-elles_demandent.mp3") {
        track.newGenre = 'Afro';
    }
}

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('Batch 7 corrections applied.');
