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

    if (!party.suggestions) party.suggestions = [];
    
    // capped push logic
    if (party.suggestions.length > 200) {
      party.suggestions.shift();
    }
    party.suggestions.push(suggestion);
    console.log('[suggest] pushed to suggestions array');
    
    await party.save();
    console.log('[suggest] party saved OK');

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

export default router;
