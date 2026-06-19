const fs = require('fs');

const brainPath = '/Users/Jean-Sebastien/App Workshop/Virtual DJ V3/SocialMixApp/SocialMixApp/Engine/DJBrain.swift';
const brainContent = fs.readFileSync(brainPath, 'utf8');

const catalogue = fs.readFileSync('full_catalogue.swift', 'utf8');

const startIndex = brainContent.indexOf('private var curatedTracks: [CuratedTrack] = [');
if (startIndex === -1) {
    console.error("Could not find start of curatedTracks array");
    process.exit(1);
}

const searchStr = '    /// Quick lookup: curated tracks grouped by genre';
const endIndex = brainContent.indexOf(searchStr, startIndex);
if (endIndex === -1) {
    console.error("Could not find end of curatedTracks array");
    process.exit(1);
}

// Extract everything up to start
const before = brainContent.substring(0, startIndex);
// Extract everything from end
const after = brainContent.substring(endIndex);

const newContent = before + catalogue + '    \n' + after;

fs.writeFileSync(brainPath, newContent);
console.log("Successfully injected the full catalogue into DJBrain.swift");
