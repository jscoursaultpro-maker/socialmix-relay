const fs = require('fs');
const path = require('path');

const renameList = JSON.parse(fs.readFileSync('tracks_to_rename.json', 'utf8'));

// 1. editorial_seed.json
const seedPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json');
let seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

seedData.tracks.forEach(t => {
  const tId = `seed_${t.providers?.deezer?.trackId || t.fallbackHash}`;
  const renameMatch = renameList.find(r => r.id === tId);
  if (renameMatch) {
    t.title = renameMatch.title;
    t.artist = renameMatch.artist;
    t.genre = renameMatch.genre;
    t.energy = renameMatch.energy;
    t.popularity = renameMatch.popularity;
    t.fallbackHash = (renameMatch.title+"_"+renameMatch.artist).toLowerCase().replace(/[^a-z0-9]/g,"");
  }
});

fs.writeFileSync(seedPath, JSON.stringify(seedData, null, 2));

// 2. DJBrain.swift
const djBrainPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift');
let djBrainContent = fs.readFileSync(djBrainPath, 'utf8');

const regexBrain = /^[ \t]*CuratedTrack\(deezerID:\s*(-?\d+),\s*genre:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*artist:\s*"([^"]+)"\),\n?/gm;
djBrainContent = djBrainContent.replace(regexBrain, (match, deezerID) => {
  const curId = `curated_${deezerID}`;
  const renameMatch = renameList.find(r => r.id === curId);
  if (renameMatch) {
    const indent = match.match(/^[ \t]*/)[0];
    return `${indent}CuratedTrack(deezerID: ${deezerID}, genre: "${renameMatch.genre}", title: "${renameMatch.title}", artist: "${renameMatch.artist}"),\n`;
  }
  return match;
});

fs.writeFileSync(djBrainPath, djBrainContent, 'utf8');
