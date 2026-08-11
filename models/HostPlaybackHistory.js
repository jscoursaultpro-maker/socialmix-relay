import mongoose from 'mongoose';

// ★ Fix(Task #44) — 2026-07-16: trackId rendu optionnel pour couvrir les tracks hors-catalogue.
// Avant : trackId required:true → HPH.create() échouait silencieusement si Track.findOne() = null.
// Après : trackId nullable, deezerTrackId + title + artist ajoutés pour traçabilité complète.
const HostPlaybackHistorySchema = new mongoose.Schema({
  hostUserId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true, index: true },
  trackId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Track', default: null,  index: true },
  partyId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Party', required: true },
  deezerTrackId: { type: Number,  default: null },   // ★ Task #44 — deduplication + freshness lookup
  title:         { type: String,  default: null },   // ★ Task #44 — audit traçabilité
  artist:        { type: String,  default: null },   // ★ Task #44 — audit traçabilité
  playedAt:      { type: Date,    default: Date.now, index: true },
  phase:         { type: String,  enum: ['arrival','ambiance','takeoff','groove','party','closing'] },
  wasSuggestedByGuest: { type: Boolean, default: false },
  // ★ Task #81: Afterglow stats + Learning BDD foundation (Task #78)
  partyCode:     { type: String,  index: true },         // dénormalisé pour queries cross-party
  voteScore: {
    feu:  { type: Number, default: 0 },
    cool: { type: Number, default: 0 },
    bof:  { type: Number, default: 0 }
  },
  wasHostOverride: { type: Boolean, default: false },
  suggestedBy:   { type: String,  default: null },       // guestId ou null
  skipReason:    { type: String,  enum: [null, 'host_skip', 'auto_next', 'guest_skip'],
                   default: null }
});

// Compound dedup guard: même track, même host, même soirée — interdit le double-log
HostPlaybackHistorySchema.index({ hostUserId: 1, deezerTrackId: 1, partyId: 1 }, { unique: true, sparse: true });
HostPlaybackHistorySchema.index({ hostUserId: 1, trackId: 1, playedAt: -1 });
HostPlaybackHistorySchema.index({ hostUserId: 1, playedAt: -1 });

export default mongoose.model('HostPlaybackHistory', HostPlaybackHistorySchema);

