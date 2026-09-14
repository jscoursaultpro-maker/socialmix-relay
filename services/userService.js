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
  // Priority: structured fields first, then split unstructured name
  if (meta.given_name)  return meta.given_name.slice(0, 40);
  if (meta.first_name)  return meta.first_name.slice(0, 40);
  const fullName = meta.full_name || meta.name || '';
  if (fullName.trim()) return fullName.trim().split(/\s+/)[0].slice(0, 40);
  return (payload.email ? payload.email.split('@')[0] : 'Guest').slice(0, 40);
}

/**
 * Extract last name from JWT payload user_metadata.
 * @param {object} payload
 * @returns {string|null}
 */
function extractLastName(payload) {
  const meta = payload.user_metadata || payload.app_metadata || {};
  const lastName = meta.family_name || meta.last_name || null;
  if (lastName) return lastName.slice(0, 40);
  // Try splitting full_name or name
  const fullName = meta.full_name || meta.name || '';
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ').slice(0, 40) : null;
}

/**
 * Extract avatar URL from JWT payload user_metadata.
 * Google: picture or avatar_url. Apple: rarely available.
 * @param {object} payload
 * @returns {string|null}
 */
function extractAvatarUrl(payload) {
  const meta = payload.user_metadata || {};
  return meta.avatar_url || meta.picture || null;
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
    // Backfill profile fields from OAuth metadata if missing or incorrect
    const updates = { lastSeenAt: new Date() };
    if (emailVerified && !user.emailVerified) updates.emailVerified = true;

    const meta = payload.user_metadata || {};
    // TEMP diagnostic: log metadata keys + value lengths (no PII)
    const metaDigest = Object.entries(meta).map(([k, v]) => `${k}:${typeof v === 'string' ? v.length + 'c' : typeof v}`).join(', ');
    console.log(`[userService] 🔍 Path A backfill — meta keys: [${metaDigest}]`);
    // Priority 1: structured given_name/family_name directly from OAuth provider
    const structuredFirst = meta.given_name || meta.first_name || null;
    const structuredLast  = meta.family_name || meta.last_name || null;
    const currentFirst    = user.profile?.firstName || '';

    // Bug #86 fix — Skip tout backfill firstName/lastName si user a édité son profil manuellement.
    // Flag profile.userEdited posé par PATCH /api/users/me (iOS AuthService.pushProfileToServer).
    if (!user.profile?.userEdited) {
      if (structuredFirst && currentFirst.includes(' ')) {
        // Current firstName is a wrong-split full_name → replace with structured data
        updates['profile.firstName'] = structuredFirst.slice(0, 40);
      } else if (structuredFirst && currentFirst !== structuredFirst && !user.profile?.lastName) {
        // firstName was previously split/truncated (e.g. "Jean" from "Jean Sebastien Coursault")
        // but structured given_name is better (e.g. "Jean-Sébastien") — safe to overwrite
        // because empty lastName signals profile was never manually edited
        updates['profile.firstName'] = structuredFirst.slice(0, 40);
      }
      if (structuredLast && !user.profile?.lastName) {
        updates['profile.lastName'] = structuredLast.slice(0, 40);
      } else if (!structuredLast && !user.profile?.lastName) {
        // No structured family_name (common for personal Google accounts)
        // Fall back to splitting full_name/name via extractLastName helper
        const fallbackLast = extractLastName(payload);
        if (fallbackLast) {
          updates['profile.lastName'] = fallbackLast;
        }
      }
  
      // Priority 2: fallback split if no structured data AND firstName still has spaces
      if (!structuredFirst && !structuredLast && currentFirst.includes(' ') && !user.profile?.lastName && !updates['profile.lastName']) {
        const parts = currentFirst.trim().split(/\s+/);
        updates['profile.firstName'] = parts[0];
        updates['profile.lastName'] = parts.slice(1).join(' ').slice(0, 40);
      }
    } else {
      console.log(`[userService] 🔒 Path A skip backfill — profile.userEdited=true (userId=${user._id})`);
    }

    // Backfill photoURL (avatar) if never set
    const metaAvatar = extractAvatarUrl(payload);
    if (metaAvatar && !user.profile?.photoURL) {
      updates['profile.photoURL'] = metaAvatar;
    }

    const hasProfileUpdates = updates['profile.firstName'] || updates['profile.lastName'] || updates['profile.photoURL'];
    await User.updateOne({ _id: user._id }, { $set: updates });
    if (hasProfileUpdates) {
      user = await User.findById(user._id);
    }
    return user;
  }

  // ── Path B: merge by email ───────────────────────────────────────────────
  if (email && emailVerified) {
    const existingDoc = await User.findOne({ email });
    if (existingDoc) {
      if (!existingDoc.supabaseUserId) {
        // Sous-cas B1 : doc.supabaseUserId absent
        const linked = await User.findOneAndUpdate(
          { _id: existingDoc._id },
          { $set: { supabaseUserId, authProvider: provider, emailVerified, lastSeenAt: new Date() } },
          { new: true }
        );
        if (linked) {
          console.log(`[userService] 🔗 Linked legacy user sub:${supabaseUserId.substring(0, 8)}… (provider: ${provider})`);
          return linked;
        }
      } else if (existingDoc.supabaseUserId !== supabaseUserId) {
        // Sous-cas B2 : doc.supabaseUserId présent MAIS différent → MERGE
        const oldSupabaseUserId = existingDoc.supabaseUserId;
        const mergedSupabaseUserIds = existingDoc.mergedSupabaseUserIds || [];
        if (!mergedSupabaseUserIds.includes(oldSupabaseUserId)) {
          mergedSupabaseUserIds.push(oldSupabaseUserId);
        }

        const targetUserId = existingDoc._id;
        const orphans = await User.find({ email, _id: { $ne: targetUserId } });
        for (const orphan of orphans) {
          await migrateDataFromOrphanUser(orphan._id, targetUserId);
        }

        const merged = await User.findOneAndUpdate(
          { _id: existingDoc._id },
          { 
            $set: { 
              supabaseUserId, 
              authProvider: provider, 
              emailVerified, 
              lastSeenAt: new Date(),
              mergedSupabaseUserIds,
              mergedAt: new Date()
            } 
          },
          { new: true }
        );
        if (merged) {
          console.log(`[userService] Merged Apple SSO ${oldSupabaseUserId} → ${supabaseUserId} for email ${email}`);
          return merged;
        }
      }
    }
  }

  // ── Path C: create new V1 user ───────────────────────────────────────────
  const firstName  = extractFirstName(payload);
  const lastName   = extractLastName(payload);
  const avatarUrl  = extractAvatarUrl(payload);
  const profileData = {
    firstName,
    emoji: '\ud83c\udf89',
  };
  if (lastName)  profileData.lastName = lastName;
  if (avatarUrl) profileData.photoURL = avatarUrl;

  const newUser = new User({
    supabaseUserId,
    email: email || `${supabaseUserId}@noemail.local`, // fallback for Apple hide-email
    authProvider: provider,
    providerId:   supabaseUserId, // V1: providerId = Supabase UUID
    emailVerified,
    profile: profileData,
    createdAt:  new Date(),
    lastSeenAt: new Date(),
    schemaVersion: '2.0',
  });

  await newUser.save();
  console.log(`[userService] ✨ Created new user sub:${supabaseUserId.substring(0, 8)}… (provider: ${provider})`);
  return newUser;
}

/**
 * Helper: Migrate data from an orphan user to a target user and soft-delete the orphan.
 */
export async function migrateDataFromOrphanUser(orphanUserId, targetUserId) {
  const mongoose = (await import('mongoose')).default;
  const db = mongoose.connection.db;

  try {
    // 1. parties
    await db.collection('parties').updateMany(
      { 'participants.userId': orphanUserId.toString() },
      { $set: { 'participants.$.userId': targetUserId.toString() } }
    );
    await db.collection('parties').updateMany(
      { 'participants.userId': orphanUserId },
      { $set: { 'participants.$.userId': targetUserId } }
    );

    // 2. fire_votes
    await db.collection('fire_votes').updateMany(
      { userId: orphanUserId },
      { $set: { userId: targetUserId } }
    );
    await db.collection('fire_votes').updateMany(
      { userId: orphanUserId.toString() },
      { $set: { userId: targetUserId.toString() } }
    );

    // 3. suggestions
    await db.collection('suggestions').updateMany(
      { userId: orphanUserId },
      { $set: { userId: targetUserId } }
    );
    await db.collection('suggestions').updateMany(
      { userId: orphanUserId.toString() },
      { $set: { userId: targetUserId.toString() } }
    );

    // 4. Soft delete orphan
    await User.updateOne(
      { _id: orphanUserId },
      { 
        $set: { 
          deletedByMerge: true, 
          deletedAt: new Date(), 
          mergedInto: targetUserId 
        } 
      }
    );
    console.log(`[userService] Migrated orphan data from ${orphanUserId} to ${targetUserId}`);
  } catch (error) {
    console.error(`[userService] Error migrating data from orphan user ${orphanUserId}:`, error);
  }
}
