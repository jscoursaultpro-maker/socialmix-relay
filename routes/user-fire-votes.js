/**
 * routes/user-fire-votes.js
 * ★ GET /api/user/me/fire-votes
 * Returns tracks fire-voted by the user cross-parties.
 */
import { Router } from 'express';
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
      return res.json({ fireVotes: [] });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 15, 1), 50);
    const excludeCode = req.query.excludeCode;

    // Build match condition for parties where this user participated
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

    // Storage is a Mixed object `guestVotes: { guestId: { trackTitle: 'feu' } }`.
    // We use a simple JS fallback to aggregate.
    const parties = await Party.find(partyMatch)
      .select('code createdAt guestVotes trackHistory hostEmail hostUserId participants')
      .lean();

    const fireVotesMap = new Map(); // key: canonicalTitle, value: { count, lastVotedAt, trackDetails }

    for (const party of parties) {
      const gv = party.guestVotes || {};
      const userIdStr = currentUser._id.toString();
      const isHost = (userEmail && party.hostEmail === userEmail) 
        || (party.hostUserId && String(party.hostUserId) === userIdStr);

      // Identify user's voter keys in this party
      const userKeys = [];
      if (isHost && gv['host']) userKeys.push('host');
      
      for (const [key, votes] of Object.entries(gv)) {
        if (key === 'host') continue;
        if (votes._guestName === userName || votes._guestName === currentUser.profile?.firstName) {
          userKeys.push(key);
        } else {
          // Check if key matches a participant with the same email
          const p = party.participants?.find(p => (p.userId === key || p.id === key) && p.email === userEmail);
          if (p) userKeys.push(key);
        }
      }

      for (const key of userKeys) {
        const votes = gv[key] || {};
        for (const [trackTitle, voteType] of Object.entries(votes)) {
          if (trackTitle === '_guestName') continue;
          if (voteType === 'fire' || voteType === 'feu') {
            const normTitle = trackTitle.toLowerCase().trim();
            
            // Try to find track details from trackHistory
            const historyEntry = party.trackHistory?.find(t => t.title && t.title.toLowerCase().trim() === normTitle);
            
            if (!fireVotesMap.has(normTitle)) {
              fireVotesMap.set(normTitle, {
                id: historyEntry?.deezerId?.toString() || historyEntry?.trackId || normTitle,
                title: historyEntry?.title || trackTitle,
                artist: historyEntry?.artist || 'Artiste inconnu',
                deezerID: historyEntry?.deezerId || null,
                coverURL: historyEntry?.albumArtworkURL || historyEntry?.coverURL || null,
                count: 0,
                lastVotedAt: new Date(0)
              });
            }
            
            const entry = fireVotesMap.get(normTitle);
            entry.count += 1;
            const partyDate = new Date(party.createdAt || 0);
            if (partyDate > entry.lastVotedAt) {
              entry.lastVotedAt = partyDate;
            }
          }
        }
      }
    }

    let fireVotes = Array.from(fireVotesMap.values());
    fireVotes.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastVotedAt - a.lastVotedAt;
    });

    fireVotes = fireVotes.slice(0, limit);

    console.log(`[UserFireVotes] user=${userName} email=${userEmail} parties=${parties.length} → ${fireVotes.length} tracks`);
    return res.json({ fireVotes: fireVotes.map(fv => ({
      id: fv.id, title: fv.title, artist: fv.artist,
      deezerID: fv.deezerID, coverURL: fv.coverURL,
      count: fv.count
    })) });
  } catch (err) {
    console.error('[UserFireVotes] ❌ Error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
