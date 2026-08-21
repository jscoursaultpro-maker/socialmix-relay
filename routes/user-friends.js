/**
 * routes/user-friends.js
 * ★ B2.2: Friend requests endpoints (request/accept/decline/unfriend/list)
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

// Middleware: extract authenticated user from JWT
async function requireAuth(req, res, next) {
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
  } catch (err) {
    if (err.name === 'AuthError') {
      return res.status(401).json({ error: 'AUTH_FAILED', message: err.message });
    }
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
}

router.use(requireAuth);

// ─── POST /request/:targetUserId — Send friend request ───────────────
router.post('/request/:targetUserId', async (req, res) => {
  try {
    const currentUser = req.currentUser;
    const targetId = req.params.targetUserId;
    
    if (!mongoose.Types.ObjectId.isValid(targetId)) return res.status(400).json({ error: 'INVALID_ID' });
    if (currentUser._id.toString() === targetId) return res.status(400).json({ error: 'CANNOT_REQUEST_SELF' });
    
    const target = await User.findById(targetId).select('preferences.profilePublic isBanned isDeleted').lean();
    if (!target || target.isBanned || target.isDeleted) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    if (!target.preferences?.profilePublic) return res.status(403).json({ error: 'USER_NOT_PUBLIC' });
    
    // Check if already friends
    if (currentUser.friends?.some(f => f.userId?.toString() === targetId)) {
      return res.status(400).json({ error: 'ALREADY_FRIENDS' });
    }
    
    // Check if already pending (sent)
    if (currentUser.pendingRequests?.sent?.some(r => r.userId?.toString() === targetId)) {
      return res.status(400).json({ error: 'ALREADY_REQUESTED' });
    }
    
    // Check if they already sent US a request (in which case, this should auto-accept, but for now we block)
    if (currentUser.pendingRequests?.received?.some(r => r.userId?.toString() === targetId)) {
      return res.status(400).json({ error: 'HAS_PENDING_REQUEST_FROM_TARGET', message: 'They already requested you. Accept it instead.' });
    }
    
    const now = new Date();
    
    await Promise.all([
      User.findByIdAndUpdate(
        currentUser._id,
        { $addToSet: { 'pendingRequests.sent': { userId: new mongoose.Types.ObjectId(targetId), requestedAt: now } } }
      ),
      User.findByIdAndUpdate(
        targetId,
        { $addToSet: { 'pendingRequests.received': { userId: currentUser._id, requestedAt: now } } }
      )
    ]);
    
    res.json({ status: 'pending', targetHandle: target.profile?.handle || null, sentAt: now });
    
  } catch (err) {
    console.error('[API] ❌ POST /api/user/friends/request error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ─── POST /accept/:fromUserId — Accept friend request ────────────────
router.post('/accept/:fromUserId', async (req, res) => {
  try {
    const currentUser = req.currentUser;
    const fromId = req.params.fromUserId;
    
    if (!mongoose.Types.ObjectId.isValid(fromId)) return res.status(400).json({ error: 'INVALID_ID' });
    
    // Verify request exists in received
    const hasRequest = currentUser.pendingRequests?.received?.some(r => r.userId?.toString() === fromId);
    if (!hasRequest) {
      return res.status(400).json({ error: 'NO_PENDING_REQUEST' });
    }
    
    const now = new Date();
    const friendObjForCurrent = { userId: new mongoose.Types.ObjectId(fromId), friendedAt: now };
    const friendObjForFrom = { userId: currentUser._id, friendedAt: now };
    
    await Promise.all([
      User.findByIdAndUpdate(currentUser._id, {
        $pull: { 'pendingRequests.received': { userId: new mongoose.Types.ObjectId(fromId) } },
        $addToSet: { friends: friendObjForCurrent }
      }),
      User.findByIdAndUpdate(fromId, {
        $pull: { 'pendingRequests.sent': { userId: currentUser._id } },
        $addToSet: { friends: friendObjForFrom }
      })
    ]);
    
    res.json({ status: 'friends', friendedAt: now });
    
  } catch (err) {
    console.error('[API] ❌ POST /api/user/friends/accept error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ─── POST /decline/:fromUserId — Decline friend request ──────────────
router.post('/decline/:fromUserId', async (req, res) => {
  try {
    const currentUser = req.currentUser;
    const fromId = req.params.fromUserId;
    
    if (!mongoose.Types.ObjectId.isValid(fromId)) return res.status(400).json({ error: 'INVALID_ID' });
    
    await Promise.all([
      User.findByIdAndUpdate(currentUser._id, {
        $pull: { 'pendingRequests.received': { userId: new mongoose.Types.ObjectId(fromId) } }
      }),
      User.findByIdAndUpdate(fromId, {
        $pull: { 'pendingRequests.sent': { userId: currentUser._id } }
      })
    ]);
    
    res.json({ status: 'declined' });
    
  } catch (err) {
    console.error('[API] ❌ POST /api/user/friends/decline error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ─── DELETE /:friendUserId — Unfriend ────────────────────────────────
router.delete('/:friendUserId', async (req, res) => {
  try {
    const currentUser = req.currentUser;
    const friendId = req.params.friendUserId;
    
    if (!mongoose.Types.ObjectId.isValid(friendId)) return res.status(400).json({ error: 'INVALID_ID' });
    
    await Promise.all([
      User.findByIdAndUpdate(currentUser._id, {
        $pull: { friends: { userId: new mongoose.Types.ObjectId(friendId) } }
      }),
      User.findByIdAndUpdate(friendId, {
        $pull: { friends: { userId: currentUser._id } }
      })
    ]);
    
    res.json({ status: 'unfriended' });
    
  } catch (err) {
    console.error('[API] ❌ DELETE /api/user/friends error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ─── GET / — List friends and pending requests ───────────────────────
router.get('/', async (req, res) => {
  try {
    const currentUser = await User.findById(req.currentUser._id)
      .populate('friends.userId', 'profile.firstName profile.handle profile.emoji')
      .populate('pendingRequests.sent.userId', 'profile.firstName profile.handle profile.emoji')
      .populate('pendingRequests.received.userId', 'profile.firstName profile.handle profile.emoji')
      .lean();
    
    const formatUserList = (list) => {
      return (list || []).map(item => {
        const u = item.userId;
        if (!u) return null;
        return {
          id: u._id,
          handle: u.profile?.handle || null,
          name: u.profile?.firstName || null,
          emoji: u.profile?.emoji || null,
          timestamp: item.friendedAt || item.requestedAt || null
        };
      }).filter(Boolean);
    };

    res.json({
      friends: formatUserList(currentUser.friends),
      pendingSent: formatUserList(currentUser.pendingRequests?.sent),
      pendingReceived: formatUserList(currentUser.pendingRequests?.received)
    });
    
  } catch (err) {
    console.error('[API] ❌ GET /api/user/friends error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
