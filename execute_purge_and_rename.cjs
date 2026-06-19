const fs = require('fs');
const path = require('path');

const keepAsIs = [
  "seed_2378226775", // 47Ter
  "seed_910693", // 2Pac
  "seed_87960517", // 2Pac
  "seed_12901264" // 2Pac
];

const renames = [
  { id: "seed_204gurujoshprojectinfinity2008_unknown", title: "Infinity 2008 (Klaas Radio Edit)", artist: "Guru Josh Project", genre: "Electro", energy: 8, popularity: 8 },
  { id: "seed_05 i gotta feeling_unknown", title: "I Gotta Feeling", artist: "Black Eyed Peas", genre: "Electro", energy: 8, popularity: 10 },
  { id: "seed_207pitbulliknowyouwantme_unknown", title: "I Know You Want Me (Calle Ocho)", artist: "Pitbull", genre: "Reggaeton", energy: 8, popularity: 9 },
  { id: "seed_01bingoplayersandfareastmovementgetup_unknown", title: "Rattle", artist: "Bingo Players", genre: "Electro", energy: 9, popularity: 7 },
  { id: "seed_219septembercryforyou_unknown", title: "Cry For You", artist: "September", genre: "Electro", energy: 8, popularity: 8 },
  { id: "seed_101thepussycatdollswhenigrowup_unknown", title: "When I Grow Up", artist: "The Pussycat Dolls", genre: "Pop", energy: 7, popularity: 8 },
  { id: "seed_04 cooler than me_unknown", title: "Cooler Than Me", artist: "Mike Posner", genre: "Pop", energy: 7, popularity: 8 },
  { id: "curated_-437735637", title: "The Next Episode", artist: "Dr. Dre feat. Snoop Dogg", genre: "Hip-Hop", energy: 8, popularity: 10 },
  { id: "curated_-183740088", title: "The Bomb! (These Sounds Fall Into My Mind)", artist: "The Bucketheads", genre: "House", energy: 8, popularity: 8 }
];

const purgeFile = '/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/tracks_to_purge.json';
const purgeData = JSON.parse(fs.readFileSync(purgeFile, 'utf8'));

const validatedPurge = [];
const renameList = [];

for (const track of purgeData) {
  if (keepAsIs.includes(track.id)) {
    console.log(`Keeping as is: ${track.id}`);
    continue;
  }
  
  const renameConfig = renames.find(r => r.id === track.id);
  if (renameConfig) {
    renameList.push(renameConfig);
    console.log(`Will rename: ${track.id} -> ${renameConfig.title}`);
    continue;
  }
  
  // Track #13 bucketheads check
  if (track.id === "curated_-183740088") {
    console.log(`Bucketheads fallback: ${track.id}`);
    // I put it in renames above, so it will be caught there.
  }
  
  validatedPurge.push(track);
}

fs.writeFileSync('tracks_to_purge_validated.json', JSON.stringify(validatedPurge, null, 2));
fs.writeFileSync('tracks_to_rename.json', JSON.stringify(renameList, null, 2));

console.log(`Total validated purge: ${validatedPurge.length}`);
console.log(`Total renames: ${renameList.length}`);

// -- APPLY PURGE & RENAME -- //

// 1. editorial_seed.json
const seedPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json');
let seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const initialSeedCount = seedData.tracks.length;
seedData.tracks = seedData.tracks.filter(t => {
  const tId = `seed_${t.providers?.deezer?.trackId || t.fallbackHash}`;
  return !validatedPurge.some(p => p.id === tId);
});
console.log(`Purged ${initialSeedCount - seedData.tracks.length} from seed`);

let renamedSeedCount = 0;
seedData.tracks.forEach(t => {
  const tId = `seed_${t.providers?.deezer?.trackId || t.fallbackHash}`;
  const renameMatch = renameList.find(r => r.id === tId);
  if (renameMatch) {
    t.title = renameMatch.title;
    t.artist = renameMatch.artist;
    t.genre = renameMatch.genre;
    t.energy = renameMatch.energy;
    t.popularity = renameMatch.popularity;
    // update fallbackhash so it remains stable
    t.fallbackHash = (renameMatch.title+"_"+renameMatch.artist).toLowerCase().replace(/[^a-z0-9]/g,"");
    renamedSeedCount++;
  }
});
console.log(`Renamed ${renamedSeedCount} in seed`);

seedData.trackCount = seedData.tracks.length;
fs.writeFileSync(seedPath, JSON.stringify(seedData, null, 2));

// 2. DJBrain.swift
const djBrainPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift');
let djBrainContent = fs.readFileSync(djBrainPath, 'utf8');

const regexBrain = /^[ \t]*CuratedTrack\(deezerID:\s*(-?\d+),\s*genre:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*artist:\s*"([^"]+)"\),\n?/gm;
let originalLength = djBrainContent.length;
let purgedBrainCount = 0;
let renamedBrainCount = 0;

djBrainContent = djBrainContent.replace(regexBrain, (match, deezerID, genre, title, artist) => {
  const curId = `curated_${deezerID}`;
  if (validatedPurge.some(p => p.id === curId)) {
    purgedBrainCount++;
    return ''; // Purge it
  }
  
  const renameMatch = renameList.find(r => r.id === curId);
  if (renameMatch) {
    renamedBrainCount++;
    // Keep the indentation
    const indent = match.match(/^[ \t]*/)[0];
    return `${indent}CuratedTrack(deezerID: ${deezerID}, genre: "${renameMatch.genre}", title: "${renameMatch.title}", artist: "${renameMatch.artist}"),\n`;
  }
  
  return match;
});

fs.writeFileSync(djBrainPath, djBrainContent, 'utf8');
console.log(`Purged ${purgedBrainCount} from DJBrain`);
console.log(`Renamed ${renamedBrainCount} in DJBrain`);

