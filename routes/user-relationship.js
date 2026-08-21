/**
 * routes/user-relationship.js
 * ★ B2.4: GET /api/user/relationship/:targetUserId — Fetch follow/friend state
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

// GET /:targetUserId — Fetch relation state
router.get('/:targetUserId', requireAuth, async (req, res) => {
  try {
    const { targetUserId } = req.params;
    const currentUser = req.currentUser;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ error: 'INVALID_TARGET_ID' });
    }

    if (currentUser._id.toString() === targetUserId) {
      return res.json({
        isSelf: true,
        followedByMe: false,
        followsMe: false,
        isFriend: false,
        iSentRequest: false,
        theySentRequest: false
      });
    }

    // Verify target exists
    const targetExists = await User.exists({ _id: targetUserId });
    if (!targetExists) {
      return res.status(404).json({ error: 'TARGET_NOT_FOUND' });
    }

    const currentIdStr = currentUser._id.toString();

    // Check followers / following
    const followedByMe = currentUser.following?.some(id => id.toString() === targetUserId) || false;
    const followsMe = currentUser.followers?.some(id => id.toString() === targetUserId) || false;

    // Check friends
    const isFriend = currentUser.friends?.some(id => id.toString() === targetUserId) || false;

    // Check pending requests
    const iSentRequest = currentUser.pendingRequests?.sent?.some(id => id.toString() === targetUserId) || false;
    const theySentRequest = currentUser.pendingRequests?.received?.some(id => id.toString() === targetUserId) || false;

    res.json({
      isSelf: false,
      followedByMe,
      followsMe,
      isFriend,
      iSentRequest,
      theySentRequest
    });

  } catch (err) {
    console.error('[API] ❌ /api/user/relationship error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
