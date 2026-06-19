import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const count = 50;
const targets = await Track.find({
  isLabeled: { $ne: true },
  gptSuggestion: null,
  $or: [{ energy: null }, { energy: 0 }]
}).sort({ deezerRank: -1 }).limit(count).lean();

let prompt = `Test prompt...\n`;
targets.forEach((t, i) => {
  let artistName = typeof t.artist === 'object' ? t.artist.name : t.artist;
  const did = (t.providers?.deezer?.trackId && t.providers?.deezer?.trackId > 0) ? t.providers?.deezer?.trackId : t._id.toString();
  prompt += `${i+1}. ID ${did} | "${t.title}" — ${artistName} | BPM:${t.bpm || '?'} | genreBDD historique: ${t.genreBDD || t.genre || '?'} | phase historique: ${t.phase || t._legacyPhase || '?'} | rank: ${t.deezerRank || '?'}\n`;
});

console.log('Targets:', targets.length);
console.log('Total length:', prompt.length);
console.log('Last lines:');
console.log(prompt.substring(prompt.length - 200));

process.exit(0);
