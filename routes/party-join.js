import { Router } from 'express';
import mongoose from 'mongoose';
import Party from '../models/Party.js';
import User from '../models/User.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

// Middleware Guest
async function requireGuestAuth(req, res, next) {
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
  } catch (error) {
    console.error('requireGuestAuth Error:', error);
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' });
  }
}

// POST /api/party/:code/request-join
router.post('/:code/request-join', requireGuestAuth, async (req, res) => {
  try {
    const { code } = req.params;
    const { message = '' } = req.body || {};
    const userId = req.currentUser._id;
    const handle = req.currentUser.handle || req.currentUser.firstName || 'Guest';
    const avatarURL = req.currentUser.profilePictureURL || null;

    const party = await Party.findOne({ code, endedAt: null });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });
    
    // Check if visibility is private
    if (party.visibility === 'private') {
      return res.status(403).json({ error: 'PARTY_PRIVATE', message: 'This party is private and does not accept join requests' });
    }

    // Check if user is already a participant
    if (party.participants && party.participants.some(p => p.userId && p.userId.toString() === userId.toString())) {
      return res.status(400).json({ error: 'ALREADY_PARTICIPANT', message: 'You are already in this party' });
    }

    // Check if a request already exists
    if (party.joinRequests && party.joinRequests.some(req => req.userId && req.userId.toString() === userId.toString())) {
      return res.status(400).json({ error: 'REQUEST_PENDING', message: 'Join request already sent' });
    }

    const newRequest = {
      userId,
      handle,
      avatarURL,
      requestedAt: new Date(),
      message: message.substring(0, 500) // cap message length
    };

    if (!party.joinRequests) party.joinRequests = [];
    party.joinRequests.push(newRequest);
    await party.save();

    // Emit socket to host
    const io = req.app.get('io');
    if (io) {
      io.to(`host:${code}`).emit('party:joinRequestReceived', newRequest);
    }

    // TODO: send APNS push notification when configured
    // if (apnsSetup) sendPush(party.hostUserId, title, body)

    return res.status(201).json(newRequest);
  } catch (err) {
    console.error(`POST /api/party/:code/request-join error:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// GET /api/party/:code/join-requests
router.get('/:code/join-requests', async (req, res) => {
  try {
    const { code } = req.params;
    const { hostSecret } = req.query;

    if (!hostSecret) return res.status(401).json({ error: 'MISSING_HOST_SECRET' });

    const party = await Party.findOne({ code, endedAt: null });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    if (party.hostSecret !== hostSecret) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid host secret' });
    }

    res.json(party.joinRequests || []);
  } catch (err) {
    console.error(`GET /api/party/:code/join-requests error:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// PATCH /api/party/:code/accept-join/:userId
router.patch('/:code/accept-join/:userId', async (req, res) => {
  try {
    const { code, userId } = req.params;
    const { hostSecret } = req.body || {};

    if (!hostSecret) return res.status(401).json({ error: 'MISSING_HOST_SECRET' });

    const party = await Party.findOne({ code, endedAt: null });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    if (party.hostSecret !== hostSecret) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid host secret' });
    }

    if (!party.joinRequests) party.joinRequests = [];
    
    const requestIndex = party.joinRequests.findIndex(r => r.userId.toString() === userId);
    if (requestIndex === -1) {
      return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
    }

    // Add to participants if not already there
    if (!party.participants) party.participants = [];
    const isParticipant = party.participants.some(p => p.userId && p.userId.toString() === userId);
    if (!isParticipant) {
      party.participants.push({
        userId: new mongoose.Types.ObjectId(userId),
        joinedAt: new Date(),
        // Add minimal placeholder participant data (the socket layer usually does the full join, but here it's backend-first)
        name: party.joinRequests[requestIndex].handle,
        role: 'guest'
      });
      party.participantCount = party.participants.length;
    }

    party.joinRequests.splice(requestIndex, 1);
    await party.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${userId}`).emit('party:joinRequestAccepted', { partyCode: code });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(`PATCH /api/party/:code/accept-join/:userId error:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// PATCH /api/party/:code/reject-join/:userId
router.patch('/:code/reject-join/:userId', async (req, res) => {
  try {
    const { code, userId } = req.params;
    const { hostSecret, reason = '' } = req.body || {};

    if (!hostSecret) return res.status(401).json({ error: 'MISSING_HOST_SECRET' });

    const party = await Party.findOne({ code, endedAt: null });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    if (party.hostSecret !== hostSecret) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid host secret' });
    }

    if (!party.joinRequests) party.joinRequests = [];

    const requestIndex = party.joinRequests.findIndex(r => r.userId.toString() === userId);
    if (requestIndex === -1) {
      return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
    }

    party.joinRequests.splice(requestIndex, 1);
    await party.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${userId}`).emit('party:joinRequestRejected', { partyCode: code, reason });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(`PATCH /api/party/:code/reject-join/:userId error:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
