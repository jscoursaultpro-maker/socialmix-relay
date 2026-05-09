import mongoose from 'mongoose';

const PartySchema = new mongoose.Schema({
  code:             { type: String, required: true, unique: true, index: true },
  hostSecret:       { type: String, default: '' },
  partyType:        { type: String, enum: ['hosted', 'guested', 'clubbed'], default: 'hosted' },
  mode:             { type: String, enum: ['appMix', 'djLive'], default: 'appMix' },
  currentTrack:     { type: mongoose.Schema.Types.Mixed, default: null },
  nextTrack:        { type: mongoose.Schema.Types.Mixed, default: null },
  trackHistory:     [mongoose.Schema.Types.Mixed],
  genreVotes:       { type: mongoose.Schema.Types.Mixed, default: {} },
  vibeScore:        { type: Number, default: 0 },
  participants:     [mongoose.Schema.Types.Mixed],
  guestVotes:       { type: mongoose.Schema.Types.Mixed, default: {} },
  suggestions:      [mongoose.Schema.Types.Mixed],
  hostProfile:      { type: mongoose.Schema.Types.Mixed, default: null },
  photos:           [mongoose.Schema.Types.Mixed],
  photoCount:       { type: Number, default: 0 },
  costumeEntries:   [mongoose.Schema.Types.Mixed],
  costumeOpen:      { type: Boolean, default: true },
  costumeVoters:    { type: mongoose.Schema.Types.Mixed, default: {} },
  participantScores:{ type: mongoose.Schema.Types.Mixed, default: {} },
  guestGenreVotes:  { type: mongoose.Schema.Types.Mixed, default: {} },
  sessionTokens:    { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt:        { type: Date, default: Date.now },
  endedAt:          { type: Date, default: null }
}, {
  timestamps: false,
  minimize: false  // preserve empty objects {}
});

// TTL index: auto-delete ended parties after 90 days
PartySchema.index({ endedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600, partialFilterExpression: { endedAt: { $ne: null } } });

export default mongoose.model('Party', PartySchema);
