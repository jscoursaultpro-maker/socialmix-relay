/**
 * routes/user-suggestions.js
 * ★ GET /api/user/me/suggestions — Historique perso des suggestions guest+host.
 * Auth: verifySupabaseJWT + findOrCreateFromSupabase.
 * Returns all suggestions the authenticated user made across all parties,
 * sorted by votes (default) or by date.
 */
import { Router } from 'express';
import User from '../models/User.js';
import Party from '../models/Party.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

// ─── Auth middleware (same pattern as user-follow.js) ────────────────
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

// ─── GET / — List user's suggestions across all parties ──────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.currentUser;
    const userEmail = (currentUser.email || '').toLowerCase().trim();
    const userName = [currentUser.profile?.firstName, currentUser.profile?.lastName]
      .filter(Boolean).join(' ').trim() || currentUser.profile?.firstName || '';

    if (!userEmail && !userName) {
      return res.json({ suggestions: [], total: 0 });
    }

    // Parse query params
    const sortMode = req.query.sort === 'date' ? 'date' : 'votes';
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);

    // Build match condition for suggestions by this user
    // Match by guestName (primary) — suggestions use guestName, not email
    const suggestionMatchConditions = [];
    if (userName) {
      suggestionMatchConditions.push({ 'suggestions.guestName': userName });
    }
    // Also try firstName only (some guests register with first name only)
    if (currentUser.profile?.firstName && currentUser.profile.firstName !== userName) {
      suggestionMatchConditions.push({ 'suggestions.guestName': currentUser.profile.firstName });
    }

    // Aggregation pipeline
    const sortSpec = sortMode === 'votes'
      ? { 'suggestion.boostCount': -1, 'suggestion.sentAt': -1 }
      : { 'suggestion.sentAt': -1 };

    const pipeline = [
      // Stage 1: Find parties where this user participated (by email)
      { $match: {
        $or: [
          { 'participants.email': userEmail },
          // Also match by host if the user is a host
          ...(userEmail ? [{ hostEmail: userEmail }] : [])
        ]
      }},
      // Stage 2: Unwind suggestions
      { $unwind: '$suggestions' },
      // Stage 3: Match suggestions by this user's name
      { $match: {
        $or: suggestionMatchConditions.length > 0
          ? suggestionMatchConditions
          : [{ 'suggestions.guestName': '___NOMATCH___' }]
      }},
      // Stage 4: Project needed fields
      { $project: {
        partyCode: '$code',
        partyDate: '$createdAt',
        partyName: {
          $ifNull: [
            '$partyName',
            { $concat: ['Soirée du ', { $dateToString: { format: '%d/%m', date: '$createdAt' } }] }
          ]
        },
        suggestion: '$suggestions'
      }},
      // Stage 5: Sort
      { $sort: sortSpec },
      // Stage 6: Limit
      { $limit: limit }
    ];

    const results = await Party.aggregate(pipeline);

    // Map to response format
    const suggestions = results.map(r => ({
      title: r.suggestion.title || 'Titre inconnu',
      artist: r.suggestion.artist || 'Artiste inconnu',
      deezerID: r.suggestion.deezerID || null,
      coverURL: r.suggestion.coverURL || null,
      feuCount: r.suggestion.feuCount || r.suggestion.boostCount || 0,
      likeCount: r.suggestion.likeCount || 0,
      status: r.suggestion.status || 'pending',
      partyCode: r.partyCode,
      partyName: r.partyName,
      partyDate: r.partyDate,
      playedAt: r.suggestion.playedAt || null,
      suggestionId: r.suggestion.id || r.suggestion.eventId || null,
      guestName: r.suggestion.guestName || userName,
    }));

    // Get total count (without limit) for pagination info
    const totalPipeline = [
      pipeline[0], // match parties
      pipeline[1], // unwind
      pipeline[2], // match suggestions by name
      { $count: 'total' }
    ];
    const totalResult = await Party.aggregate(totalPipeline);
    const total = totalResult[0]?.total || suggestions.length;

    console.log(`[UserSuggestions] ✅ ${suggestions.length} suggestions for "${userName}" (${userEmail})`);

    return res.json({ suggestions, total });
  } catch (err) {
    console.error('[UserSuggestions] ❌ Error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
