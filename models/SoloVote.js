import mongoose from 'mongoose';

// ★ Solo votes (hors soirée) — captured via /track landing page.
// Stocke les votes anonymes pour tracks pas encore dans le catalogue AhOuai.
// Un job serveur pourra plus tard promouvoir en Track si suffisamment de votes.
const SoloVoteSchema = new mongoose.Schema({
  deezerID:  { type: Number, required: true },
  isrc:      { type: String, default: null },
  title:     { type: String, required: true },
  artist:    { type: String, required: true },
  voteType:  { type: String, enum: ['bof', 'top', 'feu'], required: true },
  ipHash:    { type: String, required: true },  // sha256 de l'IP (RGPD-safe)
  createdAt: { type: Date, default: Date.now }
});

// Dedup par IP + track (un seul vote par IP par track)
SoloVoteSchema.index({ deezerID: 1, ipHash: 1 }, { unique: true });
// TTL optionnel : pas de TTL pour l'instant (données utiles long terme)

export default mongoose.model('SoloVote', SoloVoteSchema, 'solovotes');
