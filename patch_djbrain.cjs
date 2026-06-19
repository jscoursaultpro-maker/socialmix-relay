const fs = require('fs');

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

const file = '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift';
let content = fs.readFileSync(file, 'utf8');

const regex = /CuratedTrack\(deezerID:\s*0,\s*genre:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*artist:\s*"([^"]+)"\)/g;

let count = 0;
content = content.replace(regex, (match, genre, title, artist) => {
    let hash = Math.abs(hashCode(title + "_" + artist));
    if (hash === 0) hash = 1;
    count++;
    return `CuratedTrack(deezerID: -${hash}, genre: "${genre}", title: "${title}", artist: "${artist}")`;
});

fs.writeFileSync(file, content, 'utf8');
console.log(`Replaced ${count} occurrences.`);
