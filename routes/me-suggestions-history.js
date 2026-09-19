/**
 * routes/me-suggestions-history.js
 * GET /api/me/suggestions/past?limit=20&excludeCode=XYZ
 * Returns user's past suggestions across ALL ended parties.
 * Auth: verifyGuestAuth (supports legacy JWT + Supabase).
 */
import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';
import Party from '../models/Party.js';

const router = Router();

router.get('/suggestions/past', verifyGuestAuth, async (req, res) => {
  try {
    const user = req.user;
    const userId = user._id.toString();
    const userName = [user.profile?.firstName, user.profile?.lastName]
      .filter(Boolean).join(' ').trim() || user.profile?.firstName || user.firstName || '';
    const userEmail = (user.email || '').toLowerCase().trim();

    if (!userId && !userName && !userEmail) {
      return res.json({ suggestions: [] });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const excludeCode = req.query.excludeCode || null;

    // Build match for ended parties where this user has suggestions
    const matchCondition = {
      endedAt: { $ne: null },
      'suggestions.0': { $exists: true }
    };
    if (excludeCode) {
      matchCondition.code = { $ne: excludeCode };
    }

    // Build conditions to identify user's suggestions
    const suggestionMatch = [];
    if (userId) {
      suggestionMatch.push({ 'suggestions.guestId': userId });
      suggestionMatch.push({ 'suggestions.suggestedBy': userId });
    }
    if (userName) {
      suggestionMatch.push({ 'suggestions.guestName': userName });
      // Also try with emoji prefix (host pattern: "🦄 Name")
      suggestionMatch.push({ 'suggestions.guestName': { $regex: userName, $options: 'i' } });
    }

    const pipeline = [
      { $match: matchCondition },
      { $unwind: '$suggestions' },
      // Match suggestions belonging to this user
      { $match: {
        $or: suggestionMatch
      }},
      { $sort: { 'suggestions.sentAt': -1 } },
      { $limit: limit },
      { $project: {
        code: 1,
        hostProfile: 1,
        endedAt: 1,
        createdAt: 1,
        'suggestions.id': 1,
        'suggestions._id': 1,
        'suggestions.title': 1,
        'suggestions.artist': 1,
        'suggestions.artworkUrl': 1,
        'suggestions.coverURL': 1,
        'suggestions.deezerID': 1,
        'suggestions.status': 1,
        'suggestions.sentAt': 1,
        'suggestions.boostCount': 1,
      }}
    ];

    const results = await Party.aggregate(pipeline);

    // Deduplicate by title+artist (same song suggested in multiple parties)
    const seen = new Set();
    const suggestions = [];
    for (const r of results) {
      const s = r.suggestions;
      const key = `${(s.title || '').toLowerCase().trim()}|${(s.artist || '').toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      suggestions.push({
        id: (s._id || s.id || '').toString(),
        title: s.title || '',
        artist: s.artist || '',
        artworkUrl: s.artworkUrl || s.coverURL || null,
        deezerID: s.deezerID || null,
        status: s.status || 'pending',
        sentAt: s.sentAt || r.createdAt,
        boostCount: s.boostCount || 0,
        partyCode: r.code,
        partyName: r.hostProfile?.name || r.hostProfile?.firstName || 'Soirée',
      });
    }

    console.log(`[me/suggestions/past] user=${userName} → ${results.length} raw, ${suggestions.length} deduped`);
    return res.json({ suggestions });
  } catch (err) {
    console.error('[me/suggestions/past] ❌ Error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
