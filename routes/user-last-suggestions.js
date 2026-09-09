/**
 * routes/user-last-suggestions.js
 * ★ GET /api/user/me/last-suggestions
 * Auth: verifySupabaseJWT + findOrCreateFromSupabase.
 * Returns suggestions made by the user cross-parties, sorted by sentAt desc.
 */
import { Router } from 'express';
import User from '../models/User.js';
import Party from '../models/Party.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'AUTH_MISSING', message: 'Authorization: Bearer <token> required' });
    }
    const token = authHeader.slice(7);
    const payload = await verifySupabaseJWT(token);
    const user = await findOrCreateFromSupabase(payload);
    req.currentUser = user;
    next();
  } catch (err) {
    if (err.name === 'AuthError') {
      return res.status(401).json({ error: 'AUTH_FAILED', message: err.message });
    }
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.currentUser;
    const userEmail = (currentUser.email || '').toLowerCase().trim();
    const userName = [currentUser.profile?.firstName, currentUser.profile?.lastName]
      .filter(Boolean).join(' ').trim() || currentUser.profile?.firstName || '';

    if (!userEmail && !userName) {
      return res.json({ suggestions: [] });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 15, 1), 50);
    const excludeCode = req.query.excludeCode;

    // Build match condition for suggestions by this user
    const suggestionMatchConditions = [];
    if (userName) {
      suggestionMatchConditions.push({ 'suggestions.guestName': userName });
    }
    if (currentUser.profile?.firstName && currentUser.profile.firstName !== userName) {
      suggestionMatchConditions.push({ 'suggestions.guestName': currentUser.profile.firstName });
    }

    const pipeline = [];

    // Stage 1: Find parties where this user participated (exclude if specified)
    const partyMatch = {
      $or: [
        { 'participants.email': userEmail },
        { hostEmail: userEmail },
        { hostUserId: currentUser._id.toString() },
        { hostUserId: currentUser._id }
      ].filter(Boolean)
    };
    if (excludeCode) {
      partyMatch.code = { $ne: excludeCode };
    }
    pipeline.push({ $match: partyMatch });

    // Stage 2: Unwind suggestions
    pipeline.push({ $unwind: '$suggestions' });

    // Stage 3: Match suggestions by this user's name OR host marker (V6 fix)
    const suggMatchOr = [];
    if (userName) suggMatchOr.push({ 'suggestions.guestName': userName });
    if (currentUser.profile?.firstName && currentUser.profile.firstName !== userName) {
      suggMatchOr.push({ 'suggestions.guestName': currentUser.profile.firstName });
    }
    // Host-marked suggestions: guestId='host' OR isHost=true, uniquement pour les parties hostées par ce user
    const userIdStr = currentUser._id.toString();
    suggMatchOr.push({ 'suggestions.isHost': true, $or: [
      { hostUserId: currentUser._id },
      { hostUserId: userIdStr }
    ]});
    suggMatchOr.push({ 'suggestions.guestId': 'host', $or: [
      { hostUserId: currentUser._id },
      { hostUserId: userIdStr }
    ]});

    const validDeezerIdCondition = { 'suggestions.deezerID': { $exists: true, $ne: null, $ne: 0 } };
    const finalMatchOr = (suggMatchOr.length > 0 ? suggMatchOr : [{ 'suggestions.guestName': '___NOMATCH___' }]).map(cond => ({ $and: [cond, validDeezerIdCondition] }));
    pipeline.push({ $match: { $or: finalMatchOr } });

    // Stage 4: Project needed fields
    pipeline.push({ $project: {
      partyCode: '$code',
      partyDate: '$createdAt',
      suggestion: {
        id: '$suggestions.id',
        eventId: '$suggestions.eventId',
        title: '$suggestions.title',
        artist: '$suggestions.artist',
        deezerID: '$suggestions.deezerID',
        coverURL: '$suggestions.coverURL',
        status: '$suggestions.status',
        sentAt: '$suggestions.sentAt',
        guestName: '$suggestions.guestName',
        isHost: '$suggestions.isHost'
      }
    }});

    // Stage 5: Sort by sentAt desc
    pipeline.push({ $sort: { 'suggestion.sentAt': -1 } });

    // Stage 6: Limit
    pipeline.push({ $limit: limit });

    const results = await Party.aggregate(pipeline);

    // Map to response format
    const suggestions = [];
    let droppedCount = 0;
    
    for (const r of results) {
      if (!r.suggestion.deezerID || r.suggestion.deezerID === 0) {
        droppedCount++;
        continue;
      }
      suggestions.push({
        id: r.suggestion.id || r.suggestion.eventId || (r.suggestion.title + '_' + r.suggestion.artist).replace(/\s+/g, '_').toLowerCase(),
        title: r.suggestion.title || 'Titre inconnu',
        artist: r.suggestion.artist || 'Artiste inconnu',
        deezerID: r.suggestion.deezerID,
        coverURL: r.suggestion.coverURL || null,
        partyCode: r.partyCode,
        partyDate: r.partyDate,
        status: r.suggestion.status || 'pending',
        sentAt: r.suggestion.sentAt || null
      });
    }

    if (droppedCount > 0) {
      console.warn(`[UserLastSuggestions] Dropped ${droppedCount} suggestions with missing deezerID (BDD legacy)`);
    }

    console.log(`[UserLastSuggestions] user=${userName} email=${userEmail} → ${suggestions.length} results (dropped ${droppedCount} with missing deezerID)`);
    return res.json({ suggestions });
  } catch (err) {
    console.error('[UserLastSuggestions] ❌ Error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
