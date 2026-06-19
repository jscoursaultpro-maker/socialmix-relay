import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_URI);
import Track from './models/Track.js';

const arr = [{"id":"561836","genreBDD":"Pop","uiCategoryPrimary":"Old school","uiCategoriesSecondary":["Dance"],"phase":"party","phaseAlternate":"groove","energy":9,"bpm":125,"danceability":0.91,"isBanger":true,"isSingalong":true,"isEmotional":false,"isCaliente":false,"era":"80s","mood":"fun","language":"EN","hasLyrics":true,"explicit":false,"notes":"Classique universel","justification":"Hymne 80s immédiatement reconnaissable."}];

for (const up of arr) {
  const id = up.id || up.deezerID;
  let query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { "providers.deezer.trackId": Number(id) };
  console.log('query:', query);
  const track = await Track.findOne(query);
  console.log('found track:', track ? track.title : 'NO');
}
process.exit(0);
