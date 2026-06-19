import mongoose from 'mongoose';
import Track from './models/Track.js';
await mongoose.connect(process.env.MONGO_URI);

const tracks = await Track.find({ source: 'batch_workflow' });
let updated = 0;
for (const t of tracks) {
  if (!t.gptSuggestion) {
    t.gptSuggestion = {
      genreBDD: t.genreBDD,
      uiCategoryPrimary: t.uiCategoryPrimary,
      uiCategoriesSecondary: t.uiCategoriesSecondary,
      phase: t.phase,
      energy: t.energy,
      bpm: t.bpm,
      danceability: t.danceability,
      era: t.era,
      mood: t.mood,
      language: t.language,
      isBanger: t.isBanger,
      isSingalong: t.isSingalong,
      isEmotional: t.isEmotional,
      isCaliente: t.isCaliente,
      isHardcore: t.isHardcore,
      hasLyrics: t.hasLyrics,
      explicit: t.explicit,
      notes: "Retroactif: batch data"
    };
    t.markModified('gptSuggestion');
    await t.save();
    updated++;
  }
}
console.log(`Updated ${updated} tracks to restore middle column`);
process.exit(0);
