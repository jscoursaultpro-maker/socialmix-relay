import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const count = 50;
const wave = 'V1';
    
const targets = await Track.find({
      isLabeled: { $ne: true },
      gptSuggestion: null,
      $or: [{ energy: null }, { energy: 0 }]
}).sort({ deezerRank: -1 }).limit(count).lean();

console.log('targets length', targets.length);

let prompt = `Tu es un DJ...`;

targets.forEach((t, i) => {
      let artistName = typeof t.artist === 'object' ? t.artist.name : t.artist;
      const did = (t.providers && t.providers.deezer && t.providers.deezer.trackId && t.providers.deezer.trackId > 0) ? t.providers.deezer.trackId : t._id.toString();
      prompt += `${i+1}. ID ${did} | "${t.title}" — ${artistName} | BPM:${t.bpm || '?'} | genreBDD historique: ${t.genreBDD || t.genre || '?'} | phase historique: ${t.phase || t._legacyPhase || '?'} | rank: ${t.deezerRank || '?'}\n`;
});
console.log('prompt generated successfully');
process.exit(0);
