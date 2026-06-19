/**
 * inject_vdj_curated.cjs
 * Injecte le tableau curatedTracks généré par import_vdj_csv.cjs
 * dans DJBrain.swift en remplaçant l'ancien tableau.
 */
const fs = require('fs');
const path = require('path');

const DJBRAIN_PATH = path.join(__dirname, '..', 'SocialMixApp', 'SocialMixApp', 'Engine', 'DJBrain.swift');
const CURATED_PATH = path.join(__dirname, 'curated_from_vdj.swift');

// Read files
const djbrain = fs.readFileSync(DJBRAIN_PATH, 'utf-8');
const curated = fs.readFileSync(CURATED_PATH, 'utf-8');

// Find the curatedTracks array boundaries
const lines = djbrain.split('\n');
let startLine = -1;
let endLine = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('private var curatedTracks: [CuratedTrack] = [')) {
    startLine = i;
  }
  // Find the closing bracket after startLine
  if (startLine >= 0 && i > startLine && lines[i].trim() === ']') {
    endLine = i;
    break;
  }
}

if (startLine < 0 || endLine < 0) {
  console.error('❌ Could not find curatedTracks array boundaries!');
  console.log(`   startLine: ${startLine}, endLine: ${endLine}`);
  process.exit(1);
}

console.log(`Found curatedTracks: lines ${startLine + 1} to ${endLine + 1} (${endLine - startLine + 1} lines)`);

// Build the new file
const before = lines.slice(0, startLine);
const curatedLines = curated.split('\n').filter(l => l.length > 0);
const after = lines.slice(endLine + 1);

const newContent = [...before, ...curatedLines, ...after].join('\n');

// Backup
const backupPath = DJBRAIN_PATH + '.bak_pre_vdj';
fs.writeFileSync(backupPath, djbrain, 'utf-8');
console.log(`💾 Backup saved: ${backupPath}`);

// Write
fs.writeFileSync(DJBRAIN_PATH, newContent, 'utf-8');

const oldTrackCount = endLine - startLine - 1;
const newTrackCount = curatedLines.length - 3; // minus header/footer lines
console.log(`\n✅ Injection terminée!`);
console.log(`   Ancien: ${oldTrackCount} lignes`);
console.log(`   Nouveau: ${curatedLines.length} lignes (${newTrackCount} tracks approx)`);
console.log(`   Total DJBrain.swift: ${newContent.split('\n').length} lignes`);
