import User from '../models/User.js';
import FoundersIntent from '../models/FoundersIntent.js';

/**
 * Fetches founders fields for a given user from DB.
 * Returns nulls/false if user not found or not a founder, to maintain strict retro-compatibility.
 * 
 * @param {string} userId - The MongoDB ObjectId of the user (or null)
 * @returns {Promise<{foundersRank: number|null, foundersIntentSubmitted: boolean, foundersIntentPosition: number|null}>}
 */
export async function fetchUserFoundersData(userId) {
  if (!userId) {
    return {
      foundersRank: null,
      foundersIntentSubmitted: false,
      foundersIntentPosition: null
    };
  }

  try {
    const user = await User.findById(userId).select('foundersRank').lean();

    if (!user) {
      return {
        foundersRank: null,
        foundersIntentSubmitted: false,
        foundersIntentPosition: null
      };
    }

    const intent = await FoundersIntent.findOne({ userId: user._id }).lean();
    let foundersIntentSubmitted = false;
    let foundersIntentPosition = null;
    
    if (intent) {
      foundersIntentSubmitted = true;
      foundersIntentPosition = 1 + await FoundersIntent.countDocuments({ createdAt: { $lt: intent.createdAt } });
    }

    return {
      foundersRank: user.foundersRank || null,
      foundersIntentSubmitted,
      foundersIntentPosition
    };
  } catch (err) {
    console.error(`[FoundersHelper] Error fetching founders data for ${userId}:`, err.message);
    return {
      foundersRank: null,
      foundersIntentSubmitted: false,
      foundersIntentPosition: null
    };
  }
}

/**
 * Sync helper to enrich a user object with default founders fields if missing.
 * @param {Object} userObj 
 * @returns {Object} Enriched object
 */
export function enrichWithFounders(userObj) {
  if (!userObj) return null;
  return {
    ...userObj,
    foundersRank: userObj.foundersRank ?? null,
    foundersIntentSubmitted: userObj.foundersIntentSubmitted ?? false,
    foundersIntentPosition: userObj.foundersIntentPosition ?? null
  };
}
