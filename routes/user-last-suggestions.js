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

    const userIdStr = currentUser._id.toString();

    // ★ fix(#18) — GUARD SÉCURITÉ CROSS-USER
    // Identité forte = email non-vide OU userId Mongo 24-char
    // Avant: if (!userEmail && !userName) → userName vide passait le guard
    const hasValidEmail  = userEmail.length > 0;
    const hasValidUserId = /^[0-9a-f]{24}$/i.test(userIdStr);

    if (!hasValidEmail && !hasValidUserId) {
      console.warn(`[UserLastSuggestions] ⚠️ GUARD: no valid identity (email="${userEmail}", userId="${userIdStr}") → returning empty`);
      return res.json({ suggestions: [] });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 15, 1), 500);
    const excludeCode = req.query.excludeCode;

    const pipeline = [];

    // Build match condition for parties where this user participated
    // ★ fix(#18): conditionne les clauses email sur hasValidEmail
    const partyMatchOr = [
      { 'participants.userId': userIdStr },
      { 'suggestions.guestId': userIdStr },
      { 'suggestions.userId': userIdStr },
      { 'suggestions.suggestedByUserId': userIdStr },
      hasValidEmail ? { 'participants.email': userEmail } : null,
      hasValidEmail ? { hostEmail: userEmail }            : null,
      { hostUserId: userIdStr },
      { hostUserId: currentUser._id }
    ].filter(Boolean);

    const partyMatch = { $or: partyMatchOr };
    if (excludeCode) {
      partyMatch.code = { $ne: excludeCode };
    }
    pipeline.push({ $match: partyMatch });

    // Stage 2: Unwind suggestions
    pipeline.push({ $unwind: '$suggestions' });

    // Stage 3: Match suggestions by this user
    // ★ fix(#18): SUPPRIMÉ les matchs par guestName (source de fuite cross-user par prénom commun)
    //   ex: userName="Nicolas" matchait TOUS les Nicolas de TOUTES les soirées.
    //   On ne conserve que les identifiants forts:
    //   - guestId === userId Mongo
    //   - suggestions faites en tant que host (guestId='host' + party.hostUserId === user._id)
    const suggMatchOr = [
      // Suggestion soumise avec userId exact
      { 'suggestions.guestId': userIdStr },
      { 'suggestions.userId': userIdStr },
      { 'suggestions.suggestedByUserId': userIdStr },
      // Host-marked suggestions: guestId='host' OU isHost=true, uniquement si user est l'hôte
      { 'suggestions.isHost': true, $or: [
        { hostUserId: currentUser._id },
        { hostUserId: userIdStr }
      ]},
      { 'suggestions.guestId': 'host', $or: [
        { hostUserId: currentUser._id },
        { hostUserId: userIdStr }
      ]},
    ];

    pipeline.push({ $match: { $or: suggMatchOr } });

    // UX-2: Exclude fake titles/artists
    pipeline.push({ $match: { 
      'suggestions.title': { $exists: true, $nin: [null, "", "Titre en cours"] },
      'suggestions.artist': { $exists: true, $nin: [null, "", "Artiste inconnu"] }
    }});

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

    // Stage 5: Sort by sentAt desc (before group to keep the most recent)
    pipeline.push({ $sort: { 'suggestion.sentAt': -1 } });

    // UX-3: Deduplicate by deezerID or (title|artist)
    pipeline.push({
      $group: {
        _id: {
          $cond: {
            if: { $and: [{ $ne: [{ $ifNull: ['$suggestion.deezerID', null] }, null] }, { $ne: ['$suggestion.deezerID', 0] }] },
            then: { $toString: '$suggestion.deezerID' },
            else: { $toLower: { $concat: [{ $trim: { input: "$suggestion.title" } }, "|", { $trim: { input: "$suggestion.artist" } }] } }
          }
        },
        doc: { $first: "$$ROOT" }
      }
    });

    pipeline.push({ $replaceRoot: { newRoot: "$doc" } });

    // Re-sort after grouping
    pipeline.push({ $sort: { 'suggestion.sentAt': -1 } });

    // Stage 6: Limit
    pipeline.push({ $limit: limit });

    const results = await Party.aggregate(pipeline);

    // Map to response format
    let suggestions = results.map(suggestionResponse);

    // UX-4: Exclude tracks already suggested in the current party
    const activePartyCode = req.query.partyCode || req.query.excludeCode;
    if (activePartyCode) {
      const activeParty = await Party.findOne({ code: activePartyCode }).lean();
      if (activeParty && activeParty.suggestions) {
        const userIdStr = currentUser._id.toString();
        const alreadySuggestedKeys = new Set(
          activeParty.suggestions
            // ★ fix(#18): plus de match par guestName (cross-user). UserId uniquement.
            .filter(s => String(s.guestId) === userIdStr || String(s.userId) === userIdStr || String(s.suggestedByUserId) === userIdStr)
            .map(s => {
              if (s.deezerID && s.deezerID !== 0) return String(s.deezerID);
              return s.title && s.artist ? (s.title.toLowerCase().trim() + '|' + s.artist.toLowerCase().trim()) : null;
            })
            .filter(Boolean)
        );
        suggestions = suggestions.filter(s => {
          const key = (s.deezerID && s.deezerID !== 0) ? String(s.deezerID) : (s.title.toLowerCase().trim() + '|' + s.artist.toLowerCase().trim());
          return !alreadySuggestedKeys.has(key);
        });
      }
    }

    console.log(`[UserLastSuggestions] user=${userName} email=${userEmail} → ${suggestions.length} results`);
    return res.json({ suggestions });
  } catch (err) {
    console.error('[UserLastSuggestions] ❌ Error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export function suggestionResponse(r) {
    return {
        id: r.suggestion.id || r.suggestion.eventId || (r.suggestion.title + '_' + r.suggestion.artist).replace(/\s+/g, '_').toLowerCase(),
        title: r.suggestion.title || 'Titre inconnu',
        artist: r.suggestion.artist || 'Artiste inconnu',
        deezerID: r.suggestion.deezerID || null,
        coverURL: r.suggestion.coverURL || null,
        partyCode: r.partyCode,
        partyDate: r.partyDate,
        status: r.suggestion.status || 'pending',
        sentAt: r.suggestion.sentAt || null
      };
}

export default router;
