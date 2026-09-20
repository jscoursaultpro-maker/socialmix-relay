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
  const { code } = req.params;
  const tag = `[join-as-user][${code}]`;

  try {
    // ── Step 1: Validate user ──
    if (!req.user || !req.user._id) {
      console.error(`${tag} ❌ req.user missing after verifyGuestAuth`);
      return res.status(401).json({ error: 'AUTH_ERROR', message: 'User not authenticated' });
    }
    const userId = req.user._id;
    console.log(`${tag} 🔍 Step 1 OK — userId=${userId} email=${req.user.email || '?'}`);

    // ── Step 2: Find active party ──
    let party;
    try {
      party = await Party.findOne({ code, endedAt: null });
    } catch (dbErr) {
      console.error(`${tag} ❌ Step 2 DB query failed:`, dbErr.message);
      return res.status(503).json({ error: 'DB_ERROR', message: 'Database temporarily unavailable' });
    }
    if (!party) {
      console.warn(`${tag} ⚠️ Step 2 — PARTY_NOT_FOUND (code=${code})`);
      return res.status(404).json({ error: 'PARTY_NOT_FOUND' });
    }
    console.log(`${tag} 🔍 Step 2 OK — party found, hostUserId=${party.hostUserId || 'NULL'}, visibility=${party.visibility}, participants=${(party.participants || []).length}`);

    // ── Step 3: Idempotent check ──
    const isParticipant = party.participants && party.participants.some(p => p.userId && p.userId.toString() === userId.toString());
    if (isParticipant) {
      console.log(`${tag} ✅ Step 3 — already joined (idempotent)`);
      // ★ Fix: return lightweight response instead of entire party doc (which can be huge)
      return res.json({ 
        partyCode: code, 
        alreadyJoined: true,
        userId: userId.toString(),
        visibility: party.visibility
      });
    }

    // ── Step 4: Visibility check ──
    let canJoin = false;
    const isHost = party.hostUserId && party.hostUserId.toString() === userId.toString();
    const isFriend = req.user.friends && req.user.friends.some(f => f.userId && party.hostUserId && f.userId.toString() === party.hostUserId.toString());
    const isPreApproved = party.preApprovedGuests && party.preApprovedGuests.some(id => id.toString() === userId.toString());

    if (isHost || isPreApproved) {
      canJoin = true;
    } else if (party.visibility === 'public') {
      canJoin = true;
    } else if (party.visibility === 'friends') {
      if (isFriend || !STRICT_VISIBILITY) {
        canJoin = true;
      }
    } else if (party.visibility === 'private' && !STRICT_VISIBILITY) {
      canJoin = true;
    }

    if (!STRICT_VISIBILITY && (party.visibility === 'friends' || party.visibility === 'private')) {
      console.warn(`${tag} ⚠️ V1 workaround: bypassed ${party.visibility} visibility for user ${userId}`);
    }

    if (!canJoin) {
      console.warn(`${tag} 🔒 Step 4 — DENIED: visibility=${party.visibility} isHost=${isHost} isFriend=${isFriend} isPreApproved=${isPreApproved} hostUserId=${party.hostUserId || 'NULL'}`);
      return res.status(403).json({ requireJoinRequest: true });
    }
    console.log(`${tag} 🔍 Step 4 OK — canJoin=true`);

    // ── Step 5: Add participant ──
    if (!party.participants) party.participants = [];
    const guestName = req.user.profile?.handle || req.user.profile?.firstName || 'Guest';
    party.participants.push({
      userId: new mongoose.Types.ObjectId(userId),
      joinedAt: new Date(),
      name: guestName,
      email: req.user.email || '',
      role: 'guest'
    });
    party.participantCount = party.participants.length;

    // ── Step 6: Save to DB ──
    try {
      await party.save();
    } catch (saveErr) {
      console.error(`${tag} ❌ Step 6 party.save() failed:`, saveErr.name, saveErr.message);
      if (saveErr.name === 'ValidationError') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: saveErr.message });
      }
      return res.status(503).json({ error: 'DB_SAVE_ERROR', message: 'Could not save join — try again' });
    }
    console.log(`${tag} 🔍 Step 6 OK — saved, participantCount=${party.participantCount}`);

    // ── Step 7: Emit socket (non-blocking) ──
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`host:${code}`).emit('guest:joined', { userId, name: guestName });
      }
    } catch (socketErr) {
      // Non-fatal — don't block the response
      console.error(`${tag} ⚠️ Step 7 socket emit failed (non-fatal):`, socketErr.message);
    }

    // ★ Fix: return lightweight response — sending entire party doc could cause serialization errors
    // and leaks internal data (hostSecret, etc.)
    console.log(`${tag} ✅ SUCCESS — ${guestName} joined party`);
    res.json({ 
      partyCode: code,
      alreadyJoined: false,
      userId: userId.toString(),
      guestName,
      visibility: party.visibility
    });

  } catch (err) {
    // ── Fatal catch-all ──
    console.error(`${tag} ❌ FATAL:`, err.name, err.message, err.stack);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: err.message });
    }
    if (err.name === 'MongoServerError' || err.name === 'MongooseError') {
      return res.status(503).json({ error: 'DB_ERROR', message: 'Database temporarily unavailable' });
    }
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
