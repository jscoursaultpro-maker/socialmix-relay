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
  
  // === CGU / LEGAL ===
  cguAcceptedAt: { type: Date, default: null },   // ★ Chantier 5: date d'acceptation CGU
  cguVersion:    { type: String, default: null },  // ★ Chantier 5: version CGU acceptée (e.g. '2026-08-01')
  
  // === META ===
  isMigrated: { type: Boolean, default: false }, // Added based on migration spec
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  schemaVersion: { type: String, default: '2.0' }
})

// ★ Chantier 5: Upsert-style helper for guest onboarding
userSchema.statics.findOrCreateByEmail = async function({ email, firstName, lastName, cguVersion }) {
  const normalizedEmail = email.toLowerCase().trim();
  let user = await this.findOne({ email: normalizedEmail });
  if (user) {
    // Update name only if previously empty
    let changed = false;
    if (firstName && !user.profile?.firstName) { user.profile.firstName = firstName; changed = true; }
    if (lastName && !user.profile?.lastName) { user.profile.lastName = lastName; changed = true; }
    // Always update CGU if a newer version is provided
    if (cguVersion && cguVersion !== user.cguVersion) {
      user.cguAcceptedAt = new Date();
      user.cguVersion = cguVersion;
      changed = true;
    }
    user.lastSeenAt = new Date();
    if (changed) await user.save();
    return user;
  }
  // Create new user
  user = await this.create({
    email: normalizedEmail,
    profile: { firstName: firstName || 'Guest', lastName: lastName || '' },
    authProvider: null,  // no OAuth provider yet (guest onboarding)
    cguAcceptedAt: new Date(),
    cguVersion: cguVersion || null,
    schemaVersion: '2.0',
    createdAt: new Date(),
    lastSeenAt: new Date()
  });
  console.log(`[User] ✅ Created via guest onboarding: ${normalizedEmail} (_id=${user._id})`);
  return user;
};

// Index composé pour OAuth provider — partial pour exclure les guests onboardés (providerId absent)
// ★ Chantier 5 fix (01/09): sans partialFilterExpression, tous les guests onboarding créaient
// des conflits (null, null) au 2ème+ user → USER_CREATE_FAILED. Partial index ne s'active
// que quand providerId est effectivement présent (OAuth Apple/Google/email).
userSchema.index(
  { authProvider: 1, providerId: 1 },
  { unique: true, partialFilterExpression: { providerId: { $exists: true, $type: 'string' } } }
)
userSchema.index({ 'preferences.profilePublic': 1, createdAt: -1 })  // ★ B2.1: discovery

export default mongoose.model('User', userSchema)
