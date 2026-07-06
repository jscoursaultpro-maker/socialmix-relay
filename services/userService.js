/**
 * services/userService.js
 * Business logic for User creation/lookup from a verified Supabase JWT payload.
 *
 * Dedup strategy (per audit 22 juin):
 *   1. Query by supabaseUserId (fast, primary V1 path)
 *   2. Query by email (link legacy V0 account that has no supabaseUserId yet)
 *   3. Create new User document
 *
 * Security: this service NEVER receives raw tokens — only already-validated payloads.
 */
import User from '../models/User.js';

/**
 * Extract a clean display name from the JWT payload.
 * Supabase puts the name in user_metadata (set at signup or from OAuth).
 * @param {object} payload
 * @returns {string}
 */
function extractFirstName(payload) {
  const meta = payload.user_metadata || payload.app_metadata || {};
  return (
    meta.full_name?.split(' ')[0] ||
    meta.name?.split(' ')[0] ||
    meta.given_name ||
    meta.first_name ||
    (payload.email ? payload.email.split('@')[0] : 'Guest')
  ).slice(0, 40);
}

/**
 * Extract auth provider from Supabase JWT.
 * Supabase stores provider in app_metadata.provider or app_metadata.providers[0].
 * @param {object} payload
 * @returns {'apple'|'google'|'email'|null}
 */
function extractProvider(payload) {
  const meta = payload.app_metadata || {};
  const raw  = meta.provider || (meta.providers && meta.providers[0]) || 'email';
  if (raw === 'apple')  return 'apple';
  if (raw === 'google') return 'google';
  if (raw === 'email')  return 'email';
  return 'email'; // default for magic links etc.
}

/**
 * Find or create a User document from a verified Supabase JWT payload.
 *
 * Handles three paths:
 *   A) Returning V1 user  → found by supabaseUserId
 *   B) Legacy V0 user     → found by email, linked to supabaseUserId
 *   C) Brand new user     → created with supabaseUserId + profile stub
 *
 * @param {import('jose').JWTPayload & { sub: string, email?: string }} payload
 * @returns {Promise<import('mongoose').Document>} Mongoose User document
 */
export async function findOrCreateFromSupabase(payload) {
  const supabaseUserId = payload.sub;
  const email          = (payload.email || '').toLowerCase().trim() || null;
  const provider       = extractProvider(payload);
  const emailVerified  = payload.email_confirmed_at != null || payload.email_verified === true;

  // ── Path A: returning V1 user ────────────────────────────────────────────
  let user = await User.findOne({ supabaseUserId });
  if (user) {
    // Refresh emailVerified in case it changed
    if (emailVerified && !user.emailVerified) {
      user.emailVerified = true;
      user.lastSeenAt = new Date();
      await user.save();
    } else {
      await User.updateOne({ _id: user._id }, { $set: { lastSeenAt: new Date() } });
    }
    return user;
  }

  // ── Path B: legacy V0 user — atomic link by email ───────────────────────
  // findOneAndUpdate with $exists:false guard prevents race condition:
  // if two concurrent requests try to link the same email, only one succeeds;
  // the other falls through to Path C (create), which will fail on unique index
  // and can retry Path A on the next request (supabaseUserId now set).
  if (email) {
    const linked = await User.findOneAndUpdate(
      { email, supabaseUserId: { $exists: false } },
      { $set: { supabaseUserId, authProvider: provider, emailVerified, lastSeenAt: new Date() } },
      { new: true }
    );
    if (linked) {
      console.log(`[userService] 🔗 Linked legacy user sub:${supabaseUserId.substring(0, 8)}… (provider: ${provider})`);
      return linked;
    }
  }

  // ── Path C: create new V1 user ───────────────────────────────────────────
  const firstName = extractFirstName(payload);
  const newUser = new User({
    supabaseUserId,
    email: email || `${supabaseUserId}@noemail.local`, // fallback for Apple hide-email
    authProvider: provider,
    providerId:   supabaseUserId, // V1: providerId = Supabase UUID
    emailVerified,
    profile: {
      firstName,
      emoji: '🎉',
    },
    createdAt:  new Date(),
    lastSeenAt: new Date(),
    schemaVersion: '2.0',
  });

  await newUser.save();
  console.log(`[userService] ✨ Created new user sub:${supabaseUserId.substring(0, 8)}… (provider: ${provider})`);
  return newUser;
}
