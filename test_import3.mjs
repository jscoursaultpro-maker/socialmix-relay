import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const arr = [{"id":"561836","genreBDD":"Pop","uiCategoryPrimary":"Old school","uiCategoriesSecondary":["Dance"],"phase":"party","phaseAlternate":"groove","energy":9,"bpm":125,"danceability":0.91,"isBanger":true,"isSingalong":true,"isEmotional":false,"isCaliente":false,"era":"80s","mood":"fun","language":"EN","hasLyrics":true,"explicit":false,"notes":"Classique universel","justification":"Hymne 80s immédiatement reconnaissable."}];

for (const up of arr) {
  const id = up.id || up.deezerID;
  let query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { "providers.deezer.trackId": Number(id) };
  const track = await Track.findOne(query);
  if (track) {
    track.gptSuggestion = {
      genreBDD: up.genreBDD || null,
      uiCategoryPrimary: up.uiCategoryPrimary || null,
      uiCategoriesSecondary: up.uiCategoriesSecondary || [],
      phase: up.phase || null,
      phaseAlternate: up.phaseAlternate || null,
      energy: up.energy ? Math.min(10, Math.max(1, Number(up.energy))) : null,
      bpm: up.bpm || null,
      danceability: up.danceability ? Math.min(10, Math.max(1, Number(up.danceability))) : null,
      isBanger: up.isBanger || false,
      isSingalong: up.isSingalong || false,
      isEmotional: up.isEmotional || false,
      isCaliente: up.isCaliente || false,
      era: up.era || null,
      mood: up.mood || null,
      language: up.language || null,
      hasLyrics: up.hasLyrics || false,
      explicit: up.explicit || false,
      notes: up.notes || null,
      justification: up.justification || null
    };
    track.isLabeled = false;
    track.needs_review = true;
    try {
      await track.save();
      console.log('saved ok');
    } catch(e) {
      console.error('SAVE ERROR:', e.message);
    }
  }
}
process.exit(0);
