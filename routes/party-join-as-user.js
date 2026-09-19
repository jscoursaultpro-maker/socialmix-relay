// ★ V1 launch workaround (19/09) : SPRINT_B_STRICT_VISIBILITY=false
// permet à tous les guests de rejoindre les parties friends/private
// en attendant l'UI iOS host "Accepter demande" (Sprint E2).
// À supprimer quand Sprint E2 iOS shipped + sélecteur visibility iOS.

import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';
import Party from '../models/Party.js';
import mongoose from 'mongoose';

const STRICT_VISIBILITY = process.env.SPRINT_B_STRICT_VISIBILITY === 'true';

const router = Router();
router.use(verifyGuestAuth);

router.post('/:code/join-as-user', async (req, res) => {
  try {
    const { code } = req.params;
    const userId = req.user._id;

    const party = await Party.findOne({ code, endedAt: null });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    // Idempotent: check if already in participants
    const isParticipant = party.participants && party.participants.some(p => p.userId && p.userId.toString() === userId.toString());
    if (isParticipant) {
      return res.json({ party, user: req.user, alreadyJoined: true });
    }

    // Check visibility logic
    let canJoin = false;
    const isHost = party.hostUserId && party.hostUserId.toString() === userId.toString();
    const isFriend = req.user.friends && req.user.friends.some(f => f.userId && party.hostUserId && f.userId.toString() === party.hostUserId.toString());
    const isApproved = party.joinRequests && party.joinRequests.some(r => r.userId && r.userId.toString() === userId.toString() && r.accepted === true); // assuming 'accepted' or if they are in participants. Wait, if accepted they are already in participants! So private means they must be host or preApproved.
    const isPreApproved = party.preApprovedGuests && party.preApprovedGuests.some(id => id.toString() === userId.toString());

    if (isHost || isPreApproved) {
      canJoin = true;
    } else if (party.visibility === 'public') {
      canJoin = true;
    } else if (party.visibility === 'friends') {
      // V1 workaround : treat friends as public until iOS Sprint E2 UI ships
      if (isFriend || !STRICT_VISIBILITY) {
        canJoin = true;
      }
    } else if (party.visibility === 'private' && !STRICT_VISIBILITY) {
      // V1 workaround : allow private too for testing
      canJoin = true;
    }

    if (!STRICT_VISIBILITY && (party.visibility === 'friends' || party.visibility === 'private')) {
      console.warn(`[join-as-user] ⚠️ V1 workaround: bypassed ${party.visibility} visibility for user ${userId} on party ${code}`);
    }

    if (!canJoin) {
      return res.status(403).json({ requireJoinRequest: true });
    }

    // Join
    if (!party.participants) party.participants = [];
    party.participants.push({
      userId: new mongoose.Types.ObjectId(userId),
      joinedAt: new Date(),
      name: req.user.profile?.handle || req.user.profile?.firstName || 'Guest',
      role: 'guest'
    });
    party.participantCount = party.participants.length;

    await party.save();

    // Emit socket to host
    const io = req.app.get('io');
    if (io) {
      io.to(`host:${code}`).emit('guest:joined', { userId, name: req.user.profile?.handle || 'Guest' });
    }

    res.json({ party, user: req.user, alreadyJoined: false });
  } catch (err) {
    console.error('[API] ❌ POST /api/party/:code/join-as-user error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
