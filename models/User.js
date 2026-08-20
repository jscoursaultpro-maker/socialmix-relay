import mongoose from 'mongoose'
const { Schema } = mongoose

const userSchema = new Schema({
  // === IDENTITÉ AUTH ===
  // supabaseUserId: Supabase UUID (sub claim from JWT). Primary auth key for V1+ users.
  // Sparse + unique: V0 legacy users can exist without it during migration period.
  supabaseUserId: {
    type: String,
    unique: true,
    sparse: true,   // allows multiple docs with supabaseUserId=undefined
    index: true
  },
  authProvider: { 
    type: String, 
    enum: ['apple', 'google', 'email'], 
    default: null,  // null for legacy V0 users migrating progressively
    index: true
  },
  providerId: { 
    type: String, 
    index: true   // not required: V1 users use supabaseUserId instead
  },
  // EMAIL EST LA CLEF UNIQUE STRICTE
  email: { 
    type: String, 
    required: true,
    unique: true,
    lowercase: true, 
    trim: true,
    index: true
  },
  emailVerified: { type: Boolean, default: false },
  
  // === PROFIL PUBLIC ===
  profile: {
    firstName: { type: String, required: true, trim: true, maxlength: 40 },
    lastName:  { type: String, trim: true, maxlength: 40 },
    emoji: { type: String, default: '🎉' },
    photoURL: String,
    handle: { 
      type: String, 
      lowercase: true, 
      unique: true, 
      sparse: true,
      match: /^[a-z0-9_-]{3,20}$/
    },
    bio: { type: String, maxlength: 160 }
  },
  
  // === HISTORIQUE ALIAS (multi-personas) ===
  aliasHistory: [{
    firstName: String,
    emoji: String,
    seenInParty: String,  // partyCode
    seenAt: Date
  }],
  
  // === SOIRÉES (denormalisé pour fast queries) ===
  partiesAttended: [{
    partyId: { type: Schema.Types.ObjectId, ref: 'Party' },
    partyCode: String,
    role: { type: String, enum: ['host', 'guest'] },
    joinedAt: Date,
    partyName: String,
    partyCoverURL: String,
    partyDate: Date,
    legacyUserId: String  // Pour mapping rétroactif
  }],
  
  // === SOCIAL GRAPH (embedded, max 500-1000 friends) ===
  friends: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    friendedAt: { type: Date, default: Date.now },
    viaPartyId: { type: Schema.Types.ObjectId, ref: 'Party' },
    viaPartyName: String,
    viaPartyCode: String
  }],
  
  pendingRequests: {
    sent: [{
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
      requestedAt: { type: Date, default: Date.now }
    }],
    received: [{
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
      requestedAt: { type: Date, default: Date.now }
    }]
  },
  
  blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  
  // === FOLLOW GRAPH (asymmetric — distinct from friends) ===
  followers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  
  // === STATS (calculés post-soirée) ===
  stats: {
    partiesCount: { type: Number, default: 0 },
    suggestionsCount: { type: Number, default: 0 },
    suggestionsPlayedCount: { type: Number, default: 0 },
    photosUploadedCount: { type: Number, default: 0 },
    totalPoints: { type: Number, default: 0 },
    feuVotesCount: { type: Number, default: 0 },
    // ★ Task #81: Afterglow user enrichment
    topGenres: [{ genre: String, count: Number }],     // top 5, recalculé post-soirée
    uniqueGuestsHosted: { type: Number, default: 0 },  // guests uniques across all parties
    currentStreak: { type: Number, default: 0 },        // soirées consécutives (1/semaine min)
    longestStreak: { type: Number, default: 0 }
  },
  
  // ★ Task #81: Founders rank (Task #25 dependency — 2500 slots, opt-in)
  foundersRank: {
    type: Number,
    unique: true,
    sparse: true,    // null pour non-founders
    index: true
  },
  
  // === PRÉFÉRENCES & RGPD ===
  preferences: {
    notificationsEnabled: { type: Boolean, default: true },
    marketingOptIn: { type: Boolean, default: false },
    discoverableByFriends: { type: Boolean, default: true },
    showInLeaderboard: { type: Boolean, default: true },
    profilePublic: { type: Boolean, default: false }  // ★ B2.1: RGPD opt-in for public profile
  },
  
  // === SETTINGS ===
  settings: {
    antiRepetition: { type: Boolean, default: true }
  },
  
  // === DEVICES (capture iOS IDFV pour futures sessions) ===
  devices: [{
    deviceId: String,        // IDFV iOS
    platform: { type: String, enum: ['ios', 'web'] },
    firstSeenAt: Date,
    lastSeenAt: Date,
    userAgent: String
  }],
  
  // === ÉTAT COMPTE ===
  isBanned: { type: Boolean, default: false },
  bannedAt: Date,
  bannedReason: String,
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  
  // === META ===
  isMigrated: { type: Boolean, default: false }, // Added based on migration spec
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  schemaVersion: { type: String, default: '2.0' }
})

// Index composé pour OAuth provider
userSchema.index({ authProvider: 1, providerId: 1 }, { unique: true })
userSchema.index({ 'preferences.profilePublic': 1, createdAt: -1 })  // ★ B2.1: discovery

export default mongoose.model('User', userSchema)
