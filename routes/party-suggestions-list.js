import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';
import Party from '../models/Party.js';
import User from '../models/User.js';
import { enrichArtwork } from '../services/deezerArtwork.js';

const router = Router();
router.use(verifyGuestAuth);

/**
 * GET /api/party/:code/suggestions
 * Returns pending suggestions for a live party, enriched with suggestedBy user info.
 * Sorted by sentAt desc, limit 20.
 */
router.get('/:code/suggestions', async (req, res) => {
  try {
    const { code } = req.params;
    const party = await Party.findOne({ code, endedAt: null }).lean();
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    const allSuggestions = party.suggestions || [];
    // Include pending + suggestions with no status (legacy data compatibility)
    const pending = allSuggestions
      .filter(s => !s.status || s.status === 'pending')
      .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
      .slice(0, 20);
    console.log(`[suggestions] Party ${code}: ${allSuggestions.length} total, ${pending.length} pending/unset`);

    // Collect unique userIds to batch-fetch (filter out non-ObjectId markers like "host")
    const OID_RE = /^[0-9a-fA-F]{24}$/;
    // ★ feat(#43): currentUserId pour calcul isMine
    const currentUserId = req.user ? String(req.user._id) : null;

    const rawIds = [...new Set(pending.map(s => s.suggestedBy || s.guestId).filter(Boolean))];
    const validIds = rawIds.filter(id => OID_RE.test(String(id)));
    const users = validIds.length > 0
      ? await User.find({ _id: { $in: validIds } })
          // ★ feat(#29) — ajouter photoURL pour afficher l'avatar du suggesteur
          .select('profile.firstName profile.emoji profile.photoURL foundersRank')
          .lean()
      : [];
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    // Host profile fallback for suggestions with suggestedBy="host"
    const hostProfile = party.hostProfile || {};
    const hostName = hostProfile.firstName || hostProfile.name || 'Host';
    const hostEmoji = hostProfile.emoji || '🎧';

    const enriched = await enrichArtwork(pending.map(s => {
      const uid = (s.suggestedBy || s.guestId || '').toString();
      const isHost = uid === 'host' || !OID_RE.test(uid);
      const user = userMap.get(uid);

      // ★ feat(#43): isMine calculé serveur — triple fallback par ordre de fiabilité
      // 1. authorUserId (stable cross-session, MongoDB _id string) — le plus fiable
      // 2. suggestedBy  (path REST Supabase JWT)
      // 3. guestId      (fallback si guestId est un MongoDB ObjectId 24hex — rare)
      const isMine = currentUserId ? (
        (s.authorUserId && String(s.authorUserId) === currentUserId) ||
        (s.suggestedBy  && OID_RE.test(String(s.suggestedBy)) && String(s.suggestedBy) === currentUserId) ||
        (s.guestId      && OID_RE.test(String(s.guestId))     && String(s.guestId)     === currentUserId)
      ) : false;

      return {
        id: (s._id || s.id || '').toString(),
        title: s.title,
        artist: s.artist,
        artworkUrl: s.artworkUrl || s.coverURL || null,
        boostCount: s.boostCount || 0,
        boostedBy: s.boostedBy || [],
        sentAt: s.sentAt,
        suggestedBy: user ? {
          userId: uid,
          firstName: user.profile?.firstName || s.guestName || 'Guest',
          photoURL:  user.profile?.photoURL  || null,   // ★ feat(#29)
          emoji:     user.profile?.emoji     || '👽',
          foundersRank: user.foundersRank    || null
        } : {
          userId: uid,
          firstName: isHost ? hostName : (s.guestName || 'Guest'),
          photoURL:  null,                              // ★ feat(#29)
          emoji:     isHost ? hostEmoji : '👽',
          foundersRank: null
        },
        // ★ feat(#29) — boostedByUsers[] pour afficher "Boosté par [nom] + avatar"
        // Repasse le tableau déjà enrichi au write-time par les handlers de boost.
        // Si absent (soirées historiques), array vide — migré par Phase 3.
        boostedByUsers: s.boostedByUsers || [],
        isMine         // ★ feat(#43): booléen précalculé serveur, front dérive canBoost = !isMine
      };
    }));

    res.json({ suggestions: enriched });
  } catch (err) {
    console.error('[API] ❌ GET /api/party/:code/suggestions error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
