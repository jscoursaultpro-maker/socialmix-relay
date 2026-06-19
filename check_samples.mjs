import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const titles = [
  "Quand la musique est bonne",
  "Back In Black",
  "Smells Like Teen Spirit",
  "Bohemian Rhapsody",
  "We Will Rock You"
];

for (const t of titles) {
  const track = await Track.findOne({ title: t }).lean();
  console.log(`- "${t}" -> phase: ${track.phase}, era: ${track.era}, uiCategoryPrimary: ${track.uiCategoryPrimary}, isLabeled: ${track.isLabeled}, bpm: ${track.bpm}, energy: ${track.energy}, gptQueueId: ${track.chatgptQueueId}, genre: ${track.genreBDD}`);
}

process.exit(0);
