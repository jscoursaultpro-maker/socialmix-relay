import fs from 'fs';

const DB_PATH = './curated_base_v3.json';
const DJBRAIN_PATH = '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift';

// Extract from DJBrain.swift
const swift = fs.readFileSync(DJBRAIN_PATH, 'utf-8');
const regex = /CuratedTrack\(deezerID:\s*(\d+),\s*genre:\s*"([^"]+)",\s*title:\s*"([^"]*)",\s*artist:\s*"([^"]*)"(?:,\s*bpm:\s*([\d.]+))?\)/g;
const swiftTracks = [];
let m;
while ((m = regex.exec(swift)) !== null) {
  const bpm = m[5] ? parseFloat(m[5]) : 0;
  if (bpm > 170) swiftTracks.push({ deezerID: parseInt(m[1]), genre: m[2], title: m[3], artist: m[4], bpm, source: 'DJBrain.swift' });
}

// Extract from curated_base_v3.json
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const dbTracks = (db.tracks || []).filter(t => t.bpm > 170);

console.log('=== BPM > 170 dans DJBrain.swift ===');
swiftTracks.sort((a,b) => b.bpm - a.bpm).forEach(t => {
  const halfTime = Math.round(t.bpm / 2);
  console.log('  [' + t.bpm + ' BPM -> /2=' + halfTime + '] ' + t.genre.padEnd(12) + ' ' + t.title + ' — ' + t.artist + '  (ID:' + t.deezerID + ')');
});
console.log('\nTotal DJBrain.swift: ' + swiftTracks.length + ' tracks');

console.log('\n=== BPM > 170 dans curated_base_v3.json (non-hardcoded) ===');
dbTracks.sort((a,b) => b.bpm - a.bpm).forEach(t => {
  const halfTime = Math.round(t.bpm / 2);
  console.log('  [' + t.bpm + ' BPM -> /2=' + halfTime + '] ' + (t.genre||'?').padEnd(12) + ' ' + t.title + ' — ' + t.artist);
});
console.log('\nTotal DB: ' + dbTracks.length + ' tracks');
