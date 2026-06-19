import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const queues = await Track.aggregate([
  { $match: { chatgptQueueId: { $ne: null } } },
  {
    $group: {
      _id: { queue: "$chatgptQueueId", genre: "$gptSuggestion.genreBDD", phase: "$gptSuggestion.phase", energy: "$gptSuggestion.energy" },
      count: { $sum: 1 }
    }
  }
]);

console.log(queues);

process.exit(0);
