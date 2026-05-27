import mongoose from 'mongoose';

/**
 * Track schema — Couches 2 + 3 (exploration cache + performance learning)
 * Key: ISRC (unique, sparse) or fallbackHash
 * 
 * Phase 3: Base d'apprentissage musicale
 * Chaque morceau joué, shazamé, ou suggéré enrichit cette collection.
 */
const TrackSchema = new mongoose.Schema({
  // ─── Identity ─────────────────────────────────────────────────────
  isrc:          { type: String, sparse: true, unique: true },       // ISRC (primary, sparse=allows null)
  fallbackHash:  { type: String, required: true, index: true },      // normalize(title)_normalize(artist)

  // ─── Metadata ─────────────────────────────────────────────────────
  title:         { type: String, required: true },
  artist:        { type: String, required: true },
  album:         String,
  genre:         { type: String, required: true },                    // Normalized SocialMix genre
  bpm:           { type: Number, default: 0 },
  energy:        { type: Number, default: 0 },                       // 1-10
  releaseYear:   Number,

  // ─── Cross-Provider IDs ───────────────────────────────────────────
  providers: {
    deezer:     { trackId: Number, albumId: Number },
    spotify:    { trackId: String },
    appleMusic: { trackId: String }
  },

  // ─── Source ───────────────────────────────────────────────────────
  source: {
    type: String,
    enum: ['editorial', 'suggestion', 'shazam', 'exploration'],
    default: 'exploration'
  },

  // ─── Performance (the data moat) ──────────────────────────────────
  performance: {
    totalPlays:    { type: Number, default: 0 },
    ratings: {
      feu:  { type: Number, default: 0 },     // 🔥
      cool: { type: Number, default: 0 },      // 😎
      bof:  { type: Number, default: 0 }       // 😐
    },
    feuRatio:      { type: Number, default: 0 },    // feu / (feu+cool+bof), 0 if no votes
    avgVibeAtPlay: { type: Number, default: 0 },    // Average vibe score when this track plays

    // Context: which party genres does it work in?
    genreContexts: {
      type: Map,
      of: new mongoose.Schema({
        plays:    { type: Number, default: 0 },
        feuRatio: { type: Number, default: 0 }
      }, { _id: false })
    },

    // Context: what time of night does it work?
    hourBuckets: {
      type: Map,
      of: new mongoose.Schema({
        plays:    { type: Number, default: 0 },
        feuRatio: { type: Number, default: 0 }
      }, { _id: false })
    }
  }
}, {
  timestamps: true   // createdAt + updatedAt auto-managed
});

// ─── Indexes ──────────────────────────────────────────────────────────
TrackSchema.index({ genre: 1, 'performance.feuRatio': -1 });
TrackSchema.index({ 'performance.totalPlays': -1 });
TrackSchema.index({ source: 1 });

export default mongoose.model('Track', TrackSchema);
