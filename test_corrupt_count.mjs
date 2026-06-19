import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const c1 = await Track.find({ 'gptSuggestion.genreBDD': 'Pop', 'gptSuggestion.phase': 'ambiance' }).lean();

let queues = {};
c1.forEach(t => {
  queues[t.chatgptQueueId] = (queues[t.chatgptQueueId] || 0) + 1;
});

console.log('Template Pop/ambiance count:', c1.length);
console.log(queues);

process.exit(0);
