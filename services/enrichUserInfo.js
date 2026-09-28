/**
 * services/enrichUserInfo.js
 * ★ feat(#29) — Enrichit un userId avec { firstName, photoURL, emoji }
 * pour afficher "Boosté par [nom]" + avatar sur les surfaces suggestions/boosts.
 *
 * Cascade de résolution :
 *   1. User MongoDB (profile.firstName, profile.photoURL, profile.emoji)
 *   2. GuestSession (guestName, guestPhoto, guestEmoji) — pour socketIds/legacyIds
 *   3. Fallback ultimate : { firstName: "Un invité", photoURL: null, emoji: "🎉" }
 *
 * Cache RAM 5 min : évite query DB à chaque boost (important pour buildLightState).
 */

import User from '../models/User.js';
import GuestSession from '../models/GuestSession.js';

// userId (string) → { info: {...}, expiresAt: timestamp }
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const OID_RE = /^[0-9a-f]{24}$/i;

/**
 * Enrichit un seul userId.
 * @param {string|null} userId — ObjectId Mongo 24-hex, socketId, ou guestId legacy
 * @returns {Promise<{ userId: string|null, firstName: string, photoURL: string|null, emoji: string }>}
 */
export async function enrichUserInfo(userId) {
  const uid = userId ? String(userId).trim() : null;

  if (!uid) {
    return { userId: null, firstName: 'Un invité', photoURL: null, emoji: '🎉' };
  }

  // Cache hit
  const cached = _cache.get(uid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.info;
  }

  // 1. User MongoDB (ObjectId 24-hex uniquement)
  if (OID_RE.test(uid)) {
    try {
      const user = await User.findById(uid, { 'profile.firstName': 1, 'profile.photoURL': 1, 'profile.emoji': 1 }).lean();
      if (user?.profile) {
        const info = {
          userId:    uid,
          firstName: user.profile.firstName || 'Un invité',
          photoURL:  user.profile.photoURL  || null,
          emoji:     user.profile.emoji     || '🎉'
        };
        _cache.set(uid, { info, expiresAt: Date.now() + CACHE_TTL_MS });
        return info;
      }
    } catch (err) {
      console.warn(`[enrichUserInfo] User lookup failed for ${uid}:`, err.message);
    }
  }

  // 2. GuestSession (socketId, sessionToken, ou userId stocké dans session)
  try {
    const session = await GuestSession.findOne(
      { $or: [{ socketId: uid }, { sessionToken: uid }, { userId: uid }] },
      { guestName: 1, guestEmoji: 1, guestPhoto: 1 }
    ).lean();
    if (session) {
      const firstName = (session.guestName || '').split(' ')[0].trim() || 'Un invité';
      const info = {
        userId:   uid,
        firstName,
        photoURL: session.guestPhoto  || null,
        emoji:    session.guestEmoji  || '🎉'
      };
      _cache.set(uid, { info, expiresAt: Date.now() + CACHE_TTL_MS });
      return info;
    }
  } catch (err) {
    console.warn(`[enrichUserInfo] GuestSession lookup failed for ${uid}:`, err.message);
  }

  // 3. Fallback ultimate (cache 1 min seulement — le user pourrait créer un compte)
  const fallback = { userId: uid, firstName: 'Un invité', photoURL: null, emoji: '🎉' };
  _cache.set(uid, { info: fallback, expiresAt: Date.now() + 60_000 });
  return fallback;
}

/**
 * Enrichit un tableau de userIds en parallèle.
 * @param {string[]} userIds
 * @returns {Promise<Array<{ userId, firstName, photoURL, emoji }>>}
 */
export async function enrichUserInfoBatch(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  return Promise.all(userIds.map(id => enrichUserInfo(id)));
}

/**
 * Invalide le cache pour un userId (ex: après mise à jour de profil).
 * @param {string} userId
 */
export function invalidateUserCache(userId) {
  if (userId) _cache.delete(String(userId));
}
