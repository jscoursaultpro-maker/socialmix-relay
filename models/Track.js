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
  deezerRank:   { type: Number, default: 0 },                      // Popularité globale Deezer (0-1000000)

  // Niveau 2 — Identité enrichie
  language: { type: String, default: null },  // FR/EN/ES/etc.
  spotifyID: { type: String, default: null },
  appleMusicID: { type: String, default: null },

  // Niveau 3 — Classification UI
  phase: { type: String, default: null },
  uiCategoryPrimary: { 
    type: String, 
    enum: ["Chill", "Pop", "Rock", "Rap", "Latin", "Old school", "Urban Groove", "Dance", "Électro", null],
    default: null
  },
  uiCategoriesSecondary: { 
    type: [String], 
    default: [],
    validate: { validator: (arr) => arr.length <= 2, message: "Max 2 catégories secondaires" }
  },
  phaseAlternate: { type: String, default: null },

  // Niveau 4 — Caractéristiques
  danceability: { type: Number, min: 0, max: 1, default: null },

  // Niveau 5 — Tags orthogonaux
  isBanger: { type: Boolean, default: false },
  isSingalong: { type: Boolean, default: false },
  isEmotional: { type: Boolean, default: false },
  isCaliente: { type: Boolean, default: false },
  isHardcore: { type: Boolean, default: false },
  isFiller: { type: Boolean, default: false },
  era: { 
    type: String, enum: ["50s", "60s", "70s", "80s", "90s", "2000s", "2010s", "2020s", null], default: null 
  },
  mood: { 
    type: String, enum: ["fun", "emotional", "aggressive", "chill", null], default: null 
  },
  hasLyrics: { type: Boolean, default: true },
  explicit: { type: Boolean, default: false },

  // Gamification & Quality
  qualityLevel: { type: String, enum: ["vide", "partielle", "complete", "platine"], default: "vide" },

  // Niveau 6 — Modération
  isLabeled: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  rollbackReason: { type: String, default: null },
  isBlocked: { type: Boolean, default: false },
  blockedReason: { type: String, default: null },
  skipCount: { type: Number, default: 0 },
  gptSuggestion: { type: mongoose.Schema.Types.Mixed, default: null },
  chatgptQueueId: { type: String, default: null },
  source: { 
    type: String, 
    enum: ["monitor_manual", "gpt_imported", "editorial_seed_v1", "deezer_search", "host_suggestion", "guest_suggestion", "exploration", "editorial", "suggestion", "shazam", "fantome_recovered", "batch_workflow"],
    default: "gpt_imported"
  },
  classifiedBy: { type: String, default: null },
  notes: { type: String, default: "" },
  lastReviewedAt: { type: Date, default: null },
  importedAt: { type: Date, default: null },

  // ─── Cross-Provider IDs (résolution ISRC → plateforme) ───────────
  providers: {
    deezer:     { trackId: Number, albumId: Number },
    spotify:    { trackId: String },
    appleMusic: { trackId: String }
  },

  // Plateformes sur lesquelles ce track a été résolu avec succès via ISRC.
  // Signal rapide pour DJBrain.strictProviderFilter sans avoir à inspecter providers.*
  // Valeurs: 'appleMusic' | 'spotify' | 'deezer'
  availableOn: { type: [String], default: [] },

  // Métadonnées de résolution (idempotence backfill — skip si < 30j)
  providerIdsResolvedAt:      { type: Date, default: null },
  providerIdsResolvedVersion: { type: String, default: null }, // ex: 'v1-2026-07'

  // Qualification manuelle par un admin via le back-office
  adminQualified:  { type: Boolean, default: false },
  isGuessed:       { type: Boolean, default: false },
  tags:            { type: [String], default: [] },    // peak-time, warm-up, closing, safe, risky, sing-along
  partyMoment:     { type: String, enum: ['warm-up', 'peak', 'closing', 'all'], default: 'all' },

  // Suggestion count cross-soirées (signal fort d'intérêt foule)
  suggestCount:    { type: Number, default: 0 },

  // Niveau 7 — KPI étendus
  cooldownDays: { type: Number, default: 14 },
  performanceByPhase: {
    arrival:  { plays: { type: Number, default: 0 }, feuRatio: { type: Number, default: 0 } },
    ambiance: { plays: { type: Number, default: 0 }, feuRatio: { type: Number, default: 0 } },
    takeoff:  { plays: { type: Number, default: 0 }, feuRatio: { type: Number, default: 0 } },
    groove:   { plays: { type: Number, default: 0 }, feuRatio: { type: Number, default: 0 } },
    party:    { plays: { type: Number, default: 0 }, feuRatio: { type: Number, default: 0 } },
    closing:  { plays: { type: Number, default: 0 }, feuRatio: { type: Number, default: 0 } }
  },

  // Niveau 8 — Metadata
  schemaVersion: { type: String, default: "2.0" },

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
// ─── Provider ID indexes (ISRC resolution backfill + DJBrain provider filter) ───
TrackSchema.index({ 'providers.appleMusic.trackId': 1 }, { sparse: true });
TrackSchema.index({ 'providers.spotify.trackId':    1 }, { sparse: true });
TrackSchema.index({ availableOn: 1 });
TrackSchema.index({ providerIdsResolvedAt: 1 }, { sparse: true }); // backfill idempotence query

TrackSchema.pre('save', function(next) {
  let q = "vide";
  
  const hasBase = !!(this.genre && this.uiCategoryPrimary && this.phase);
  const hasStats = !!(this.bpm > 0 && this.energy > 0);
  
  if (hasBase || hasStats) {
    q = "partielle";
  }
  
  if (this.gptSuggestion != null || this.needs_review) {
    q = "complete";
  }
  
  if (this.isVerified) {
    q = "platine";
  }
  
  this.qualityLevel = q;
  if (typeof next === 'function') next();
});

export default mongoose.model('Track', TrackSchema);
