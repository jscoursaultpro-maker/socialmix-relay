import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';
import Party from '../models/Party.js';
import { enrichUserInfo } from '../services/enrichUserInfo.js'; // ★ feat(#29)
import { randomUUID } from 'crypto';

const router = Router();
router.use(verifyGuestAuth);

router.post('/:code/suggest', async (req, res) => {
  try {
    console.log('[suggest] START', { code: req.params.code, userId: req.user?._id });
    const { code } = req.params;
    const { trackId, title, artist, artworkUrl, deezerID, isrc } = req.body;
    const userId = req.user._id;
    const guestName = req.user.profile?.handle || req.user.profile?.firstName || 'Guest';
    console.log('[suggest] body parsed OK');

    const party = await Party.findOne({ code, endedAt: null });
    console.log('[suggest] party found:', party ? party._id : 'null');
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    // Verify user is host or in participants
    const isHost = party.hostUserId && party.hostUserId.toString() === userId.toString();
    const isParticipant = party.participants && party.participants.some(p => p.userId && p.userId.toString() === userId.toString());
    console.log('[suggest] isHost/isParticipant:', isHost, isParticipant);
    if (!isHost && !isParticipant) {
      return res.status(403).json({ error: 'NOT_PARTICIPANT', message: 'You must join the party first' });
    }

    // ★ fix(#19) — Regex anti-parasites: rejette les titres suspects (ads Spotify, URLs, injections)
    const SUSPICIOUS_PATTERNS = [
      { pattern: /sur toutes les principales apps/i, name: 'ad_principale_apps' },
      { pattern: /avec ce lien/i, name: 'ad_avec_lien' },
      { pattern: /écoute sur (spotify|apple music|deezer)/i, name: 'ad_ecoute_sur_provider' },
      { pattern: /https?:\/\//i, name: 'url_in_title' },
      { pattern: /:\/\//i, name: 'protocol_in_title' },
      { pattern: /\.(com|fr|net|io|app)\b/i, name: 'domain_in_title' },
    ];
    const titleToCheck = `${title ?? ''} ${artist ?? ''}`;
    const matchedPattern = SUSPICIOUS_PATTERNS.find(({ pattern }) => pattern.test(titleToCheck));
    if (matchedPattern) {
      console.warn(`[suggest] ⚠️ SUSPICIOUS_TITLE_PATTERN "${matchedPattern.name}" in: "${title}"`);
      return res.status(400).json({
        error: 'SUSPICIOUS_TITLE_PATTERN',
        message: `Titre rejeté (pattern: ${matchedPattern.name})`,
        pattern: matchedPattern.name
      });
    }


    // ★ feat(#44): snapshot suggestedByUser au write time (pattern Task #29 boostedByUsers)
    const suggestedByUser = await enrichUserInfo(userId.toString());
    console.log('[suggest] ★ suggestedByUser enriched:', suggestedByUser.firstName);

    const suggestion = {
      id: randomUUID(),
      title,
      artist,
      artworkUrl,
      trackId,
      deezerID: deezerID || trackId,
      isrc: isrc || null,
      guestName,
      guestId:      userId.toString(),
      suggestedBy:  userId.toString(),    // ★ feat(#43): String pour query OID_RE côté lecture
      authorUserId: userId.toString(),    // ★ feat(#43): champ stable cross-session (MongoDB _id)
      suggestedByUser,                     // ★ feat(#44): { userId, firstName, photoURL, emoji }
      status: 'pending',
      sentAt: new Date().toISOString(),
      boostCount: 0,
      boostedBy: []
    };
    console.log('[suggest] suggestion built');

    // ★ Task #15 fix — atomic $push évite les VersionError intermittents
    // quand plusieurs guests proposent en même temps.
    // ★ feat(#43) fix write-through — authorUserId + suggestedBy maintenant persistés en BDD
    // (audit Phase 1 : suggestedBy était dans l'objet RAM mais absent du $push MongoDB)
    await Party.updateOne(
      { _id: party._id },
      {
        $push: {
          suggestions: {
            $each: [{
              id:           suggestion.id,
              title:        suggestion.title,
              artist:       suggestion.artist,
              artworkUrl:   suggestion.artworkUrl   || null,
              trackId:      suggestion.trackId      || null,
              deezerID:     suggestion.deezerID     || null,
              isrc:         suggestion.isrc          || null,
              guestName:    suggestion.guestName,
              guestId:      suggestion.guestId,
              suggestedBy:  suggestion.suggestedBy,   // ★ feat(#43): maintenant persisté
              authorUserId: suggestion.authorUserId,  // ★ feat(#43): champ stable cross-session
              suggestedByUser: suggestion.suggestedByUser || null, // ★ feat(#44): snapshot { firstName, photoURL, emoji }
              status:       suggestion.status,
              sentAt:       suggestion.sentAt,
              boostCount:   0,
              boostedBy:    []
            }],
            $slice: -200  // cap à 200 en gardant les plus récents
          }
        }
      }
    );
    console.log('[suggest] party saved OK (atomic $push)');

    // ★ Task #7: sync RAM parties Map after Mongo save
    const parties = req.app.get('parties');
    const ramParty = parties?.get(code.toUpperCase());
    if (ramParty) {
      if (!ramParty.suggestions) ramParty.suggestions = [];
      // Avoid duplicates: only push if not already present
      if (!ramParty.suggestions.find(s => s.id === suggestion.id)) {
        ramParty.suggestions.push({ ...suggestion });
        ramParty.isDirty = true;
        console.log('[suggest] ✅ RAM synced: pushed suggestion to ramParty');
      }
    }

    const io = req.app.get('io');
    console.log('[suggest] io retrieved:', !!io);
    if (io) {
      try {
        io.to(`host:${code}`).emit('guest:suggested', suggestion);
        console.log('[suggest] emitted to host');
        // broadcast to guests
        io.to(`guest:${code}`).emit('suggestion:added', { ...suggestion, isHost: false });
        console.log('[suggest] emitted to guests');
      } catch (emitErr) {
        console.error('[suggest] emit error:', emitErr.message, emitErr.stack);
        throw emitErr;
      }
    }

    console.log('[suggest] SUCCESS');
    res.json({ success: true, suggestion });
  } catch (err) {
    console.error('[API] ❌ POST /api/party/:code/suggest error:', err.message);
    console.error('[API] STACK TRACE:', err.stack);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

/**
 * POST /api/party/:code/suggest/:suggestionId/boost
 * Boost an existing suggestion (anti-double per user).
 */
router.post('/:code/suggest/:suggestionId/boost', async (req, res) => {
  try {
    const { code, suggestionId } = req.params;
    const userId = req.user._id.toString();

    const party = await Party.findOne({ code, endedAt: null });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    let suggestion = (party.suggestions || []).find(s => s.id === suggestionId);
    // ★ Fallback titre : suggestion venue du RAM (socket) pas encore en Mongo
    if (!suggestion) {
      const titleFallback = (req.body || {}).suggestionTitle;
      if (titleFallback) {
        suggestion = (party.suggestions || []).find(s =>
          (s.title || '').toLowerCase().trim() === String(titleFallback).toLowerCase().trim() &&
          ['pending', 'queued', 'next'].includes(s.status)
        );
        if (suggestion) console.log(`[boost] fallback title match for '${titleFallback}' → ${suggestion.id}`);
      }
    }
    if (!suggestion) return res.status(404).json({ error: 'SUGGESTION_NOT_FOUND' });

    // Anti-double
    if (!suggestion.boostedBy) suggestion.boostedBy = [];
    if (suggestion.boostedBy.includes(userId)) {
      return res.status(409).json({ error: 'ALREADY_BOOSTED', boostCount: suggestion.boostCount || 0 });
    }

    suggestion.boostedBy.push(userId);
    suggestion.boostCount = (suggestion.boostCount || 0) + 1;

    // ★ feat(#29) — Enrichir boostedByUsers[] au write-time pour afficher
    // "Boosté par [nom] + avatar" côté web sans lookup supplémentaire au read.
    // Rétrocompat iOS : boostedBy[] conservé en parallèle.
    if (!suggestion.boostedByUsers) suggestion.boostedByUsers = [];
    if (!suggestion.boostedByUsers.find(b => b.userId === userId)) {
      const boosterInfo = await enrichUserInfo(userId);
      suggestion.boostedByUsers.push(boosterInfo);
    }

    party.markModified('suggestions');
    await party.save();

    // ★ Task #7: sync RAM parties Map after Mongo boost save
    const parties = req.app.get('parties');
    const ramParty = parties?.get(code.toUpperCase());
    if (ramParty) {
      const ramSugg = (ramParty.suggestions || []).find(s => s.id === suggestionId);
      if (ramSugg) {
        ramSugg.boostedBy = [...suggestion.boostedBy];
        ramSugg.boostCount = suggestion.boostCount;
        // ★ feat(#29) — sync boostedByUsers[] dans le RAM aussi
        ramSugg.boostedByUsers = suggestion.boostedByUsers ? [...suggestion.boostedByUsers] : [];
        ramParty.isDirty = true;
        console.log(`[boost] ✅ RAM synced: boostedBy=${ramSugg.boostedBy.length}, count=${ramSugg.boostCount}`);
      } else {
        console.warn(`[boost] ⚠️ suggestion ${suggestionId} not found in RAM — will sync on next party:state`);
      }
    }

    // Socket emit to host + guests
    const io = req.app.get('io');
    if (io) {
      const payload = {
        suggestionId,
        boostCount: suggestion.boostCount,
        boostedByUserId: userId
      };
      io.to(`host:${code}`).emit('suggestion:boosted', payload);
      io.to(`guest:${code}`).emit('suggestion:boosted', payload);
    }

    res.json({ success: true, boostCount: suggestion.boostCount });
  } catch (err) {
    console.error('[API] ❌ POST /api/party/:code/suggest/:id/boost error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
