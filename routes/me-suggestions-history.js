/**
 * routes/me-suggestions-history.js
 * GET /api/me/suggestions/past?limit=6&offset=0&excludeCode=XYZ
 * Returns user's past suggestions across ALL ended parties, paginated.
 * Auth: verifyGuestAuth (supports legacy JWT + Supabase).
 *
 * Réponse : { items: [...], total: <number>, hasMore: <bool> }
 * Compatibilité : les appelants avec ?limit=20 sans offset reçoivent le même contenu
 * qu'avant (les 20 premiers) + les champs total/hasMore en plus.
 * Tri : plus récent en premier (suggestions.sentAt DESC).
 *
 * Fix dédupication : le $limit est retiré du pipeline Mongo et appliqué APRÈS
 * la dédupication JS (sinon on limite avant de déduper = résultats incorrects).
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
      return res.json({ items: [], total: 0, hasMore: false });
    }

    // A1 — Validation limit / offset (valeurs invalides → défaut, jamais 400)
    const rawLimit  = parseInt(req.query.limit);
    const rawOffset = parseInt(req.query.offset);
    const limit  = isNaN(rawLimit)  ? 6  : Math.min(Math.max(rawLimit, 1), 50);
    const offset = isNaN(rawOffset) ? 0  : Math.max(rawOffset, 0);

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

    // Pipeline sans $limit — la dédupication JS doit voir TOUS les résultats
    // pour correctement déduper avant d'appliquer offset+limit.
    const pipeline = [
      { $match: matchCondition },
      { $unwind: '$suggestions' },
      // Match suggestions belonging to this user
      { $match: { $or: suggestionMatch } },
      { $sort: { 'suggestions.sentAt': -1 } },
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
    const allItems = [];
    for (const r of results) {
      const s = r.suggestions;
      const key = `${(s.title || '').toLowerCase().trim()}|${(s.artist || '').toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      allItems.push({
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

    // A1 — total, hasMore, pagination
    const total   = allItems.length;
    const items   = allItems.slice(offset, offset + limit);
    const hasMore = offset + items.length < total;

    console.log(`[me/suggestions/past] user=${userName} limit=${limit} offset=${offset} → ${items.length}/${total} (hasMore=${hasMore})`);
    return res.json({ items, total, hasMore });
  } catch (err) {
    console.error('[me/suggestions/past] ❌ Error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
