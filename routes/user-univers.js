/**
 * routes/user-univers.js
 * ★ Univers V1 — profil relationnel entre 2 users AhOuai.
 *
 * GET /api/user/univers/:targetUserId
 *
 * Auth : Supabase Bearer JWT
 * Accès : amis acceptés OU co-participants d'au moins 1 party endedAt !== null.
 *
 * Réponse strictement conforme au contrat V1 :
 *   { targetUserId, targetPublic, relationshipState, meetContext,
 *     commonTracks[], commonSuggestions[], commonAfterglows[],
 *     counts, contactAvailable, meta }
 *
 * Notes :
 *  - Aucune donnée perso brute (phone/email/insta) — juste contactAvailable.
 *  - Cache-Control: private, no-store.
 *  - Collections filtrées par préférences des 2 utilisateurs.
 *  - Si blocked (dans un sens ou l'autre) → 200 OK avec response neutralisée.
 *  - meetContext = plus ancien afterglow commun ; les autres suivent DESC.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Party from '../models/Party.js';
import Friendship from '../models/Friendship.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';
import { verifyGuestAuth } from '../middleware/authGuest.js';
import { computeIdentityKey, findMatches } from '../utils/participantDedup.js';

const router = Router();

async function requireAuth(req, res, next) {
  try {
    const authType = req.headers['x-auth-type'];
    if (authType === 'sbauth') {
      return verifyGuestAuth(req, res, (err) => {
        if (err) return next(err);
        req.currentUser = req.user;
        next();
      });
    }

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

/** Encapsule la clef canonique du contrat (6 valeurs). */
function resolveRelationshipState(friendship, meId, targetId, meBlockedTarget, targetBlockedMe) {
  if (meBlockedTarget || targetBlockedMe) return 'blocked';
  if (!friendship) return 'none';
  if (friendship.status === 'accepted') return 'accepted';
  if (friendship.status === 'declined') return 'declined';
  if (friendship.status === 'pending') {
    return String(friendship.requestedBy) === String(meId) ? 'pending_sent' : 'pending_received';
  }
  return 'none';
}

/** Response neutralisée pour cas "blocked". */
function buildBlockedResponse(targetUserId) {
  return {
    targetUserId: String(targetUserId),
    targetPublic: { handle: null, firstName: null, emoji: null, photo: null },
    relationshipState: 'blocked',
    meetContext: null,
    commonTracks: [],
    commonSuggestions: [],
    commonAfterglows: [],
    counts: { commonTracks: 0, commonSuggestions: 0, commonAfterglows: 0 },
    contactAvailable: false,
    meta: {
      version: 'univers-v1',
      generatedAt: new Date().toISOString(),
      cacheTTLSec: 0,
    },
  };
}

/** Parse un query int borné. */
function parseIntSafe(raw, def, max) {
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, max);
  return def;
}

router.get('/:targetUserId', requireAuth, async (req, res) => {
  try {
    const me = req.currentUser;
    const targetIdStr = String(req.params.targetUserId || '');

    if (!mongoose.Types.ObjectId.isValid(targetIdStr)) {
      return res.status(400).json({ error: 'INVALID_TARGET_ID' });
    }
    if (String(me._id) === targetIdStr) {
      return res.status(400).json({ error: 'CANNOT_QUERY_SELF' });
    }

    // Cache headers : réponse privée, jamais partagée
    res.set('Cache-Control', 'private, no-store');
    res.set('Vary', 'Authorization');

    // Charger target avec projection minimale
    const target = await User.findById(targetIdStr)
      .select('_id profile preferences isBanned isDeleted blockedUsers')
      .lean();

    if (!target || target.isBanned || target.isDeleted) {
      return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }

    const meBlockedTarget = (me.blockedUsers || []).some(id => String(id) === targetIdStr);
    const targetBlockedMe = (target.blockedUsers || []).some(id => String(id) === String(me._id));

    // Cas bloqué : 200 OK, response neutralisée (règle "aucune donnée sociale")
    if (meBlockedTarget || targetBlockedMe) {
      return res.status(200).json(buildBlockedResponse(target._id));
    }

    // Chercher friendship
    const [uA, uB] = [String(me._id), targetIdStr].sort();
    const friendship = await Friendship.findOne({ userA: uA, userB: uB }).lean();
    const areFriends = friendship?.status === 'accepted';

    // Pagination
    const tracksLimit = parseIntSafe(req.query.tracksLimit, 20, 100);
    const tracksOffset = parseIntSafe(req.query.tracksOffset, 0, 100000);
    const suggestionsLimit = parseIntSafe(req.query.suggestionsLimit, 20, 100);
    const suggestionsOffset = parseIntSafe(req.query.suggestionsOffset, 0, 100000);
    const afterglowsLimit = parseIntSafe(req.query.afterglowsLimit, 10, 50);
    const afterglowsOffset = parseIntSafe(req.query.afterglowsOffset, 0, 100000);

    const meP = [me._id, String(me._id)];
    const targetP = [target._id, String(target._id)];

    // Règle A : partagé AU MOINS 1 soirée
    const sharedQuery = {
      $or: [
        { hostUserId: { $in: meP }, 'participants.userId': { $in: targetP } },
        { hostUserId: { $in: targetP }, 'participants.userId': { $in: meP } },
        { $and: [{ 'participants.userId': { $in: meP } }, { 'participants.userId': { $in: targetP } }] }
      ]
    };

    const sharedCount = await Party.countDocuments(sharedQuery);
    if (sharedCount === 0) {
      console.log(`[AUDIT] UniversAccess:`, JSON.stringify({ currentUserId: me._id, targetUserId: targetIdStr, timestamp: new Date().toISOString(), authType: req.headers['x-auth-type'], decision: '403_FORBIDDEN_NOT_SHARED_PARTY' }));
      return res.status(403).json({ error: 'FORBIDDEN_NOT_SHARED_PARTY' });
    }

    // Récupérer TOUTES les parties communes
    const partiesWithDetail = await Party.find(sharedQuery)
      .select('code name createdAt endedAt coverPhotoURL suggestions trackHistory guestVotes participants')
      .lean();

    console.log(`[AUDIT] UniversAccess:`, JSON.stringify({ currentUserId: me._id, targetUserId: targetIdStr, timestamp: new Date().toISOString(), authType: req.headers['x-auth-type'], decision: '200_OK' }));

    // ─── Common tracks : intersection des fires 🔥 sur trackHistory ──
    const meIdStr = String(me._id);
    const targetIdStrCanonical = String(target._id);

    const trackMap = new Map(); // deezerID → { title, artist, artworkUrl, trackId }
    for (const party of partiesWithDetail) {
      const history = Array.isArray(party.trackHistory) ? party.trackHistory : [];
      const votes = party.guestVotes || {};
      // Vote map keys : socketId OU userId. Support des 2.
      const meVotes = new Set();
      const themVotes = new Set();
      for (const [voterKey, voterTracks] of Object.entries(votes)) {
        const voterKeyStr = String(voterKey);
        // Le voteur correspond-il à me ou target ?
        // On accepte match direct sur userId ; email n'est pas dans guestVotes
        const isMe = voterKeyStr === meIdStr;
        const isTarget = voterKeyStr === targetIdStrCanonical;
        if (!isMe && !isTarget) continue;
        for (const [trackKey, vote] of Object.entries(voterTracks || {})) {
          if (vote === 'fire') {
            if (isMe) meVotes.add(trackKey);
            if (isTarget) themVotes.add(trackKey);
          }
        }
      }
      // Intersection
      for (const trackKey of meVotes) {
        if (!themVotes.has(trackKey)) continue;
        const track = history.find(t => (t.title || '') === trackKey || String(t.deezerID || '') === trackKey);
        if (!track) continue;
        const trackId = String(track.deezerID || track.title);
        if (!trackMap.has(trackId)) {
          trackMap.set(trackId, {
            trackId,
            title: track.title || '',
            artist: track.artist || '',
            artworkUrl: track.coverURL || track.artworkURL || null,
          });
        }
      }
    }

    const allCommonTracks = Array.from(trackMap.values());

    // ─── Common suggestions : proposées par me OU target sur mêmes parties ──
    // V1 : on compte suggestions issues par l'un OU l'autre présent dans les
    // parties communes (relation "univers musical partagé").
    const sugMap = new Map(); // key trackId → { ... , partyId }
    for (const party of partiesWithDetail) {
      const sugs = Array.isArray(party.suggestions) ? party.suggestions : [];
      for (const s of sugs) {
        const isMine = String(s.guestId || '') === meIdStr;
        const isTarget = String(s.guestId || '') === targetIdStrCanonical;
        if (!isMine && !isTarget) continue;
        const trackId = String(s.deezerID || s.trackId || s.title);
        if (!sugMap.has(trackId)) {
          sugMap.set(trackId, {
            trackId,
            title: s.title || '',
            artist: s.artist || '',
            artworkUrl: s.artworkUrl || s.coverURL || null,
            partyId: party.code,
          });
        }
      }
    }
    const allCommonSuggestions = Array.from(sugMap.values());

    // ─── Common afterglows : parties finies avec les 2 users comme participants ──
    const afterglows = partiesWithDetail
      .filter(p => p.endedAt)
      .map(p => ({
        partyId: p.code,
        title: p.name || 'Soirée',
        coverUrl: p.coverPhotoURL || null,
        occurredAt: (p.createdAt || p.endedAt).toISOString(),
      }));

    // Tri ASC pour choisir meetContext = plus ancien
    const afterglowsSortedAsc = [...afterglows].sort(
      (a, b) => new Date(a.occurredAt) - new Date(b.occurredAt)
    );

    // Réponse : commonAfterglows présenté DESC (plus récent d'abord)
    const afterglowsSortedDesc = [...afterglowsSortedAsc].reverse();

    // meetContext : plus ancien afterglow commun
    let meetContext = null;
    if (afterglowsSortedAsc.length > 0) {
      const oldest = afterglowsSortedAsc[0];
      const party = partiesWithDetail.find(p => p.code === oldest.partyId);
      meetContext = {
        partyId: oldest.partyId,
        partyName: oldest.title,
        partyType: null,
        metAt: oldest.occurredAt,
        venueName: null,
        coverUrl: oldest.coverUrl,
      };
      void party; // reserved for future partyType/venueName enrichment
    }

    // ─── contactAvailable (booléen strict) ──
    let contactAvailable = false;
    if (areFriends) {
      const prefs = target.preferences || {};
      const p = target.profile || {};
      const hasPhone = !!p.phone && !!prefs.sharePhone;
      const hasEmail = !!p.email && !!prefs.shareEmail;
      const hasInsta = !!p.instagram && !!prefs.shareInsta;
      contactAvailable = hasPhone || hasEmail || hasInsta;
    }

    // ─── relationshipState canonique ──
    const relationshipState = resolveRelationshipState(
      friendship, me._id, target._id, meBlockedTarget, targetBlockedMe
    );

    // ─── targetPublic (info publique légère) ──
    const targetPublic = {
      handle: target.profile?.handle || null,
      firstName: target.profile?.firstName || null,
      emoji: target.profile?.emoji || null,
      photo: target.profile?.photo || null,
    };

    // Pagination des collections
    const commonTracks = allCommonTracks.slice(tracksOffset, tracksOffset + tracksLimit);
    const commonSuggestions = allCommonSuggestions.slice(suggestionsOffset, suggestionsOffset + suggestionsLimit);
    const commonAfterglows = afterglowsSortedDesc.slice(afterglowsOffset, afterglowsOffset + afterglowsLimit);

    return res.status(200).json({
      targetUserId: String(target._id),
      targetPublic,
      relationshipState,
      meetContext,
      commonTracks,
      commonSuggestions,
      commonAfterglows,
      counts: {
        commonTracks: allCommonTracks.length,
        commonSuggestions: allCommonSuggestions.length,
        commonAfterglows: afterglowsSortedDesc.length,
      },
      contactAvailable,
      meta: {
        version: 'univers-v1',
        generatedAt: new Date().toISOString(),
        cacheTTLSec: 300,
      },
    });
  } catch (err) {
    console.error('[API] ❌ GET /api/user/univers/:targetUserId error:', err.message, err.stack);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
