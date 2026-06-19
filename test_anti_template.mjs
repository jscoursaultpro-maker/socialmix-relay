import fs from 'fs';
import path from 'path';

const arr = [];
for(let i=0; i<20; i++) {
  arr.push({
    "id": "1234"+i,
    "genreBDD": "Pop",
    "phase": "ambiance",
    "era": "2020s",
    "bpm": 120,
    "energy": 6
  });
}

const uniqueGenres = new Set(arr.map(t => t.genreBDD));
const uniquePhases = new Set(arr.map(t => t.phase));
const uniqueEras = new Set(arr.map(t => t.era));
const uniqueBpms = new Set(arr.map(t => t.bpm));
const uniqueEnergies = new Set(arr.map(t => t.energy));

const onesCount = [uniqueGenres, uniquePhases, uniqueEras, uniqueBpms, uniqueEnergies]
  .filter(s => s.size <= 1).length;

if (uniqueGenres.size < 3 || uniquePhases.size < 2 || onesCount === 5) {
  console.log("Template rejected!");
} else {
  console.log("Template accepted");
}
