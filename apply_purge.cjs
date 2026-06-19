const fs = require('fs');
const path = require('path');

const validatedPurge = JSON.parse(fs.readFileSync('tracks_to_purge_validated.json', 'utf8'));

// 1. editorial_seed.json
const seedPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json');
let seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

seedData.tracks = seedData.tracks.filter(t => {
  const tId = `seed_${t.providers?.deezer?.trackId || t.fallbackHash}`;
  return !validatedPurge.some(p => p.id === tId);
});
seedData.trackCount = seedData.tracks.length;
fs.writeFileSync(seedPath, JSON.stringify(seedData, null, 2));

// 2. DJBrain.swift
const djBrainPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift');
let djBrainContent = fs.readFileSync(djBrainPath, 'utf8');

const regexBrain = /^[ \t]*CuratedTrack\(deezerID:\s*(-?\d+),\s*genre:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*artist:\s*"([^"]+)"\),\n?/gm;
djBrainContent = djBrainContent.replace(regexBrain, (match, deezerID) => {
  const curId = `curated_${deezerID}`;
  if (validatedPurge.some(p => p.id === curId)) {
    return ''; // Purge it
  }
  return match;
});

fs.writeFileSync(djBrainPath, djBrainContent, 'utf8');
