import mongoose from 'mongoose';

const PartySchema = new mongoose.Schema({
  code:             { type: String, required: true, unique: true, index: true },
  hostSecret:       { type: String, default: '' },
  partyType:        { type: String, enum: ['hosted', 'guested', 'clubbed'], default: 'hosted' },
  mode:             { type: String, enum: ['appMix', 'djLive'], default: 'appMix' },
  currentPhase:     { type: String, enum: ['arrival', 'ambiance', 'takeoff', 'groove', 'party', 'closing'], default: 'arrival' },  // ★ fix(critical) — was missing, strict:true stripped it from all writes
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
  guestGenreVoteExpiry: { type: mongoose.Schema.Types.Mixed, default: {} },  // ★ fix(schema-audit): per-guest genre vote TTL timestamps (strict:true was stripping this)
  sessionTokens:    { type: mongoose.Schema.Types.Mixed, default: {} },
  playedKeys:       { type: [String], default: [] },   // ★ Phase 3: ISRC + fallbackHash of played tracks (anti-replay)
  scheduledFor:     { type: Date, default: null },     // ★ MVP Pre-Party
  welcomeText:      { type: String, default: '' },     // ★ MVP Pre-Party
  coverPhoto:       { type: String, default: null },   // ★ MVP Pre-Party (Base64)
  isPreParty:       { type: Boolean, default: false }, // ★ MVP Pre-Party
  isDemoParty:      { type: Boolean, default: false, index: true }, // ★ V1 Test
  phaseStartedAt:   { type: Date, default: null, index: true }, // ★ Full Restart Refactor: decouple phase from createdAt
  createdAt:        { type: Date, default: Date.now },
  endedAt:          { type: Date, default: null },
  lifecycle: {
    status: { 
      type: String, 
      enum: ['draft', 'scheduled', 'live', 'paused', 'ended', 'archived'],
      default: 'live'
    },
    startedAt: { type: Date, default: Date.now },
    archivedAt: Date,
    endedBy: { type: String, enum: ['host', 'auto_timeout', 'admin'] },
    lastActivityAt: { type: Date, default: Date.now }
  }
}, {
  timestamps: false,
  minimize: false  // preserve empty objects {}
});

// TTL index: auto-delete ended parties after 90 days
PartySchema.index({ endedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600, partialFilterExpression: { endedAt: { $ne: null } } });

export default mongoose.model('Party', PartySchema);
