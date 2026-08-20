/**
 * routes/user-follow.js
 * ★ B2.1: POST/DELETE /api/user/follow/:targetUserId — Atomic follow/unfollow.
 * Auth: verifySupabaseJWT + findOrCreateFromSupabase.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

/**
 * Middleware: extract authenticated user from JWT.
 */
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

// ─── POST /:targetUserId — Follow a user ─────────────────────────────
router.post('/:targetUserId', requireAuth, async (req, res) => {
  try {
    const currentUser = req.currentUser;
    const targetId = req.params.targetUserId;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'targetUserId must be a valid ObjectId' });
    }
    
    // Cannot follow self
    if (currentUser._id.toString() === targetId) {
      return res.status(400).json({ error: 'CANNOT_FOLLOW_SELF' });
    }
    
    // Target must exist and be public
    const target = await User.findById(targetId).select('preferences.profilePublic isBanned isDeleted followers').lean();
    if (!target || target.isBanned || target.isDeleted) {
      return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }
    if (!target.preferences?.profilePublic) {
      return res.status(403).json({ error: 'USER_NOT_PUBLIC', message: 'Cannot follow a private profile' });
    }
    
    // Atomic follow: $addToSet prevents duplicates
    const [updatedCurrent, updatedTarget] = await Promise.all([
      User.findByIdAndUpdate(
        currentUser._id,
        { $addToSet: { following: new mongoose.Types.ObjectId(targetId) } },
        { new: true, projection: { following: 1 } }
      ),
      User.findByIdAndUpdate(
        targetId,
        { $addToSet: { followers: currentUser._id } },
        { new: true, projection: { followers: 1 } }
      )
    ]);
    
    res.json({
      followed: true,
      followingCount: updatedCurrent?.following?.length || 0,
      targetFollowersCount: updatedTarget?.followers?.length || 0
    });
    
  } catch (err) {
    console.error('[API] ❌ POST /api/user/follow error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ─── DELETE /:targetUserId — Unfollow a user ─────────────────────────
router.delete('/:targetUserId', requireAuth, async (req, res) => {
  try {
    const currentUser = req.currentUser;
    const targetId = req.params.targetUserId;
    
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'targetUserId must be a valid ObjectId' });
    }
    
    // Atomic unfollow: $pull is safe even if not following
    const [updatedCurrent, updatedTarget] = await Promise.all([
      User.findByIdAndUpdate(
        currentUser._id,
        { $pull: { following: new mongoose.Types.ObjectId(targetId) } },
        { new: true, projection: { following: 1 } }
      ),
      User.findByIdAndUpdate(
        targetId,
        { $pull: { followers: currentUser._id } },
        { new: true, projection: { followers: 1 } }
      )
    ]);
    
    res.json({
      followed: false,
      followingCount: updatedCurrent?.following?.length || 0,
      targetFollowersCount: updatedTarget?.followers?.length || 0
    });
    
  } catch (err) {
    console.error('[API] ❌ DELETE /api/user/follow error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
