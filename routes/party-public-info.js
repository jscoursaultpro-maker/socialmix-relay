import { Router } from 'express';
import Party from '../models/Party.js';
import { fetchUserFoundersData } from '../utils/founders.js';
import { enrichUserInfo } from '../services/enrichUserInfo.js'; // B1 — cascade photoURL hôte

const router = Router();
const rateLimitMap = new Map();

// Clear map every 60 seconds
setInterval(() => rateLimitMap.clear(), 60000);

// GET /api/party/:code/public-info
// Accessible sans auth (écran d'invitation). Privacy-first : aucun prénom ni photo invité.
router.get('/:code/public-info', async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const count = (rateLimitMap.get(ip) || 0) + 1;
    rateLimitMap.set(ip, count);
    if (count > 30) {
      return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
    }

    const { code } = req.params;
    const party = await Party.findOne({ code, endedAt: null })
      .populate('hostUserId', 'profile.handle profile.emoji profile.photo profile.firstName profile.photoURL')
      .lean();

    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    const hostData = await fetchUserFoundersData(party.hostUserId?._id?.toString());

    // C2 — host.photo : cascade profile.photo → profile.photoURL → enrichUserInfo(hostUserId)
    // profile.photo = champ iOS. profile.photoURL = champ Supabase/web.
    // enrichUserInfo requête Mongo (cascade complète) uniquement si les deux sont absents.
    let hostPhoto = party.hostUserId?.profile?.photo
      || party.hostUserId?.profile?.photoURL
      || null;

    if (!hostPhoto && party.hostUserId?._id) {
      try {
        const enriched = await enrichUserInfo(party.hostUserId._id.toString());
        hostPhoto = enriched.photoURL || null;
      } catch (_) { /* non-fatal */ }
    }

    const host = party.hostUserId ? {
      firstName:              party.hostUserId.profile?.firstName || null,
      handle:                 party.hostUserId.profile?.handle || null,
      emoji:                  party.hostUserId.profile?.emoji || null,
      photo:                  hostPhoto,  // C2 — vraie photoURL hôte (Google/Apple)
      foundersRank:           hostData.foundersRank,
      foundersIntentSubmitted: hostData.foundersIntentSubmitted,
      foundersIntentPosition: hostData.foundersIntentPosition
    } : null;

    const partyName = party.partyName || party.welcomeText || `Soirée de ${host?.firstName || host?.handle || 'l\'hôte'}`;

    // C3 — previewGuests : PRIVACY FIRST — écran visible par quiconque a le lien.
    // Pas de prénom, pas d'avatarUrl. Seulement emoji anonymisé, foundersRank, count global.
    // Decision Jean-Sé 30/09 : avatarUrl forcé à null même si présent en BDD.
    const previewGuests = (party.participants || []).slice(0, 4).map(() => ({
      emoji:       '👽',   // anonymisé — pas l'emoji réel de l'invité
      avatarUrl:   null,  // privacy : pas de photo invité pré-auth (décision 30/09)
      foundersRank: null  // privacy : rank non exposé pré-auth
    }));

    res.json({
      code:         party.code,
      name:         partyName,
      startedAt:    party.createdAt || null,
      guestCount:   party.participantCount || (party.participants || []).length,
      coverPhotoId: (party.settings && party.settings.photosEnabled === false) ? null : party.coverPhotoId,
      host,
      previewGuests,
      visibility:   party.visibility || 'private'
    });

  } catch (err) {
    console.error('[API] ❌ GET /api/party/:code/public-info error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
