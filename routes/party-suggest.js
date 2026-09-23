import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';
import Party from '../models/Party.js';
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

    const suggestion = {
      id: randomUUID(),
      title,
      artist,
      artworkUrl,
      trackId,
      deezerID: deezerID || trackId,
      isrc: isrc || null,
      guestName,
      guestId: userId.toString(),
      suggestedBy: userId,
      status: 'pending',
      sentAt: new Date().toISOString(),
      boostCount: 0,
      boostedBy: []
    };
    console.log('[suggest] suggestion built');

    // ★ Task #15 fix — atomic $push évite les VersionError intermittents
    // quand plusieurs guests proposent en même temps.
    await Party.updateOne(
      { _id: party._id },
      {
        $push: {
          suggestions: {
            $each: [suggestion],
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
