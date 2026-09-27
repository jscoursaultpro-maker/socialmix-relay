import { Router } from 'express';
import Party from '../models/Party.js';
import { EventLog } from '../models/EventLog.js';
import { verifyGuestAuth } from '../middleware/authGuest.js';

const router = Router();

router.post('/:code/reopen', verifyGuestAuth, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    
    // 1. Fetch Party
    const party = await Party.findOne({ code });
    if (!party) {
      return res.status(404).json({ error: 'PARTY_NOT_FOUND' });
    }

    // 2. Auth Check (only host can reopen)
    if (!req.user || req.user._id.toString() !== party.hostUserId.toString()) {
      return res.status(403).json({ error: 'FORBIDDEN_NOT_HOST' });
    }

    // 3. Status checks
    if (!party.endedAt) {
      return res.status(400).json({ error: 'PARTY_ALREADY_LIVE' });
    }

    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(party.endedAt).getTime() > maxAgeMs) {
      return res.status(400).json({ 
        error: 'PARTY_TOO_OLD_TO_REOPEN', 
        endedAt: party.endedAt, 
        maxAgeDays: 7 
      });
    }

    // 4. Auto-close other live party
    const otherLive = await Party.findOne({
      hostUserId: req.user._id,
      endedAt: null,
      code: { $ne: code }
    });

    let autoClosedPartyCode = null;
    if (otherLive) {
      autoClosedPartyCode = otherLive.code;
      otherLive.endedAt = new Date();
      otherLive.lifecycle = { 
        ...otherLive.lifecycle, 
        status: 'ended', 
        endedBy: 'host' 
      };
      await otherLive.save();

      await EventLog.create({
        eventType: 'party.auto_closed_for_reopen',
        partyCode: otherLive.code,
        guestId: req.user._id.toString()
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`host:${otherLive.code}`).emit('party:auto_closed', { 
          code: otherLive.code, 
          reason: 'auto_reopen' 
        });
      }
    }

    // 5. Reopen the target party
    const prevEndedAt = party.endedAt;
    party.endedAt = null;
    party.lifecycle = {
      ...party.lifecycle,
      status: 'live',
      endedBy: null,
      reopenedAt: new Date(),
      reopenedBy: req.user._id
    };
    await party.save();

    await EventLog.create({
      eventType: 'party.reopened',
      partyCode: code,
      guestId: req.user._id.toString()
    });

    // 6. Response
    return res.json({
      ok: true,
      party: { 
        code: party.code, 
        name: party.name, 
        hostUserId: party.hostUserId, 
        endedAt: null, 
        lifecycle: party.lifecycle, 
        participants: party.participants,
        hostSecret: party.hostSecret 
      },
      autoClosedPartyCode,
      reopenedAt: party.lifecycle.reopenedAt
    });

  } catch (err) {
    console.error(`[API] ❌ /api/host/parties/${req.params.code}/reopen error:`, err);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
