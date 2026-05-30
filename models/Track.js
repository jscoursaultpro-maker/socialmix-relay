import mongoose from 'mongoose';

/**
 * Track schema — Source de vérité unifiée SocialMix
 * Couche 1 : Seed éditorial (editorial_seed.json → importé au boot)
 * Couche 2 : Cache d'exploration (upsert à chaque lecture)
 * Couche 3 : Performance learning (votes, plays, contextes)
 *
 * Clé primaire : ISRC (unique, sparse) ou fallbackHash
 * Pivot cross-plateforme : ISRC → Deezer / Spotify / Apple Music
 */
const TrackSchema = new mongoose.Schema({

  // ─── Identity ─────────────────────────────────────────────────────
  isrc:         { type: String, sparse: true, unique: true },      // ISRC (primary — cross-platform key)
  fallbackHash: { type: String, required: true, index: true },     // normalize(title)_normalize(artist)

  // ─── Metadata (source de vérité — affiché côté UI) ────────────────
  title:        { type: String, required: true },
  artist:       { type: String, required: true },
  album:        String,
  genre:        { type: String, required: true },                   // Genre normalisé SocialMix
  bpm:          { type: Number, default: 0 },
  energy:       { type: Number, default: 0, min: 0, max: 10 },    // 0 = non qualifié, 1-10 = qualifié
  releaseYear:  Number,
  coverArtURL:  String,                                             // URL Deezer (stable, gratuit)
  duration:     { type: Number, default: 0 },                      // Durée en secondes

  // ─── Cross-Provider IDs (résolution ISRC → plateforme) ───────────
  providers: {
    deezer:     { trackId: Number, albumId: Number },
    spotify:    { trackId: String },
    appleMusic: { trackId: String }
  },

  // ─── Source & Curation ────────────────────────────────────────────
  source: {
    type: String,
    enum: ['editorial', 'suggestion', 'shazam', 'exploration'],
    default: 'exploration'
  },

  // Qualification manuelle par un admin via le back-office
  adminQualified:  { type: Boolean, default: false },
  tags:            { type: [String], default: [] },    // peak-time, warm-up, closing, safe, risky, sing-along
  partyMoment:     { type: String, enum: ['warm-up', 'peak', 'closing', 'all'], default: 'all' },

  // Suggestion count cross-soirées (signal fort d'intérêt foule)
  suggestCount:    { type: Number, default: 0 },

  // ─── Performance (le data moat — apprend dans le temps) ───────────
  performance: {
    totalPlays:    { type: Number, default: 0 },
    ratings: {
      feu:  { type: Number, default: 0 },   // 🔥
      cool: { type: Number, default: 0 },   // 😎
      bof:  { type: Number, default: 0 }    // 😐
    },
    feuRatio:      { type: Number, default: 0 },   // feu / (feu+cool+bof), 0 si aucun vote
    avgVibeAtPlay: { type: Number, default: 0 },   // Vibe moyen au moment des lectures

    // Contexte : dans quel genre de soirée le titre fonctionne-t-il ?
    genreContexts: {
      type: Map,
      of: new mongoose.Schema({
        plays:    { type: Number, default: 0 },
        feuRatio: { type: Number, default: 0 }
      }, { _id: false })
    },

    // Contexte : à quelle heure de soirée fonctionne-t-il ?
    hourBuckets: {
      type: Map,
      of: new mongoose.Schema({
        plays:    { type: Number, default: 0 },
        feuRatio: { type: Number, default: 0 }
      }, { _id: false })
    }
  }

}, {
  timestamps: true   // createdAt + updatedAt gérés automatiquement
});

// ─── Indexes ──────────────────────────────────────────────────────────
TrackSchema.index({ genre: 1, 'performance.feuRatio': -1 });
TrackSchema.index({ genre: 1, adminQualified: -1 });
TrackSchema.index({ 'performance.totalPlays': -1 });
TrackSchema.index({ source: 1 });
TrackSchema.index({ adminQualified: 1, energy: -1 });
TrackSchema.index({ suggestCount: -1 });

export default mongoose.model('Track', TrackSchema);
