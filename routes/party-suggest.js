import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';
import Party from '../models/Party.js';
import { randomUUID } from 'crypto';

const router = Router();
router.use(verifyGuestAuth);

router.post('/:code/suggest', async (req, res) => {
  try {
    const { code } = req.params;
    const { trackId, title, artist, artworkUrl, deezerID, isrc } = req.body;
    const userId = req.user._id;
    const guestName = req.user.profile?.handle || req.user.profile?.firstName || 'Guest';

    const party = await Party.findOne({ code, endedAt: null });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    // Verify user is in participants
    const isParticipant = party.participants && party.participants.some(p => p.userId && p.userId.toString() === userId.toString());
    if (!isParticipant) {
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

    if (!party.suggestions) party.suggestions = [];
    
    // capped push logic logic to max 200 could be applied here if needed, but standard push is fine for V1 REST
    if (party.suggestions.length > 200) {
      party.suggestions.shift();
    }
    party.suggestions.push(suggestion);
    await party.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`host:${code}`).emit('guest:suggested', suggestion);
      // broadcast to guests
      io.to(`guest:${code}`).emit('suggestion:added', { ...suggestion, isHost: false });
    }

    res.json({ success: true, suggestion });
  } catch (err) {
    console.error('[API] ❌ POST /api/party/:code/suggest error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
