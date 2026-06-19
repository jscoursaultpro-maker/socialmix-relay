import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

// Corrupted tracks might be in gptSuggestion (not yet labeled) OR directly on the track (if labeled).
const c1 = await Track.find({
  $or: [
    { 'gptSuggestion.genreBDD': 'Pop' },
    { 'gptSuggestion.phase': 'ambiance' },
    { genreBDD: 'Pop', phase: 'ambiance', era: '2020s', energy: 6 }
  ]
}).lean();

let inQueue = 0;
let labeled = 0;

c1.forEach(t => {
  if (t.isLabeled) labeled++;
  else if (t.chatgptQueueId) inQueue++;
});

console.log('Total matches:', c1.length);
console.log('In queue (not labeled):', inQueue);
console.log('Labeled:', labeled);

process.exit(0);
