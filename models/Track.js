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
  bpmSource:    { type: String },
  bpm_confidence: { type: String, enum: ['estimated', 'deezer_api', 'manual'], default: 'estimated' },
  bpmDetected:      { type: Number, default: 0 },     // Rolling average of live-detected BPMs
  bpmDetectedCount: { type: Number, default: 0 },     // Number of live BPM measurements
  bpmConflict:      { type: Boolean, default: false }, // True when detected BPM diverges >30% from curated BPM
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
    enum: [
      "Chill", "Pop", "Rock", "Rap", "Latin", "Old school", "Urban Groove", "Dance", "Électro",
      "House", "Tech House", "Deep House", "Afro House", "Melodic House",  // ★ V2 electronic sub-genres
      "Techno", "Amapiano", "Disco", "Afro", "COCOVARIET",                // ★ V2 extended taxonomy
      null
    ],
    default: null
  },
  uiCategoriesSecondary: { 
    type: [String], 
    default: [],
    validate: { validator: (arr) => arr.length <= 4, message: "Max 4 catégories secondaires" }  // ★ was 2, V2 batches send up to 4
  },
  phaseAlternate: { type: String, default: null },

  // Niveau 4 — Caractéristiques
  danceability: { type: Number, min: 0, max: 1, default: null },

  // Niveau 5 — Tags orthogonaux
  confidence: { type: String, enum: ['high', 'medium', 'low', null], default: null },
  confidence_notes: { type: String, default: null },
  isBanger: { type: Boolean, default: false, index: true },  // ★ Task #44: index for DJBrain filtered queries
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
  suggestable: { type: Boolean, default: true },  // false = jamais montré aux guests dans suggestions (covers redondantes). Peut être joué en background par DJBrain si manque de tracks.

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
  classifiedAt: { type: Date, default: null },                      // When this track was last classified
  doctrineVersion: { type: String, default: null },                 // e.g. "v1_legacy", "v2_2026-08-18"
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
  curation:        { type: String, enum: ['in', 'backlog', 'filler'], default: 'backlog', index: true },

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

  appleMusicMetadata: {
    genreNames: { type: [String], default: [] },
    releaseDate: { type: String, default: null },
    previewUrl: { type: String, default: null },
    artworkUrl: { type: String, default: null },
    durationInMillis: { type: Number, default: 0 }
  },

  // ─── Performance (le data moat — apprend dans le temps) ───────────
  performance: {
    totalPlays:    { type: Number, default: 0 },
    ratings: {
      feu:  { type: Number, default: 0 },   // 🔥
      cool: { type: Number, default: 0 },   // 😎
      bof:  { type: Number, default: 0 },   // 😐
      // ★ Solo votes (hors soirée) — captured via /track landing page.
      // NE PAS mélanger avec les votes en soirée dans les calculs DJ Brain
      // sans validation doctrine (mémoire feedback_bdd_prime_algo).
      // Pour l'instant, ces champs sont STOCKÉS UNIQUEMENT — non lus par l'algo.
      feuSolo:  { type: Number, default: 0 },
      likeSolo: { type: Number, default: 0 },
      bofSolo:  { type: Number, default: 0 }
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
TrackSchema.index({ suggestable: 1, phase: 1 });
TrackSchema.index({ confidence: 1, classifiedBy: 1 });
// ─── Chantier 1 indexes (batch, monitoring, learning loop) ──────
TrackSchema.index({ qualityLevel: 1 });
TrackSchema.index({ doctrineVersion: 1 });
TrackSchema.index({ bpmConflict: 1 }, { sparse: true });
TrackSchema.index({ 'performance.feuRatio': -1 });

// ─── Quality Level computation (shared between pre-save and findOneAndUpdate callers) ──
export function computeQualityLevel(doc) {
  let q = "vide";

  const hasBase = !!(doc.genre && doc.uiCategoryPrimary && doc.phase);
  const hasStats = !!(doc.bpm > 0 && doc.energy > 0);

  if (hasBase || hasStats) {
    q = "partielle";
  }

  const isFullyClassified = !!(
    doc.genre && doc.uiCategoryPrimary && doc.phase &&
    doc.bpm > 0 && doc.energy > 0 && doc.danceability != null &&
    doc.era && doc.mood && doc.language
  );
  const isClaudeBatchClassified = typeof doc.classifiedBy === 'string' && doc.classifiedBy.startsWith('claude_batch');

  if (isFullyClassified || isClaudeBatchClassified || doc.gptSuggestion != null || doc.needs_review) {
    q = "complete";
  }

  if (doc.isVerified) {
    q = "platine";
  }

  return q;
}

TrackSchema.pre('save', function(next) {
  this.qualityLevel = computeQualityLevel(this);
  if (typeof next === 'function') next();
});

// ★ Chantier 2 (20/08): bump seedVersion after every Track save (fire-and-forget)
TrackSchema.post('save', function() {
  import('./Meta.js').then(({ bumpSeedVersion }) => {
    bumpSeedVersion().catch(() => {});
  }).catch(() => {});
});

const Track = mongoose.model('Track', TrackSchema);
export default Track;

