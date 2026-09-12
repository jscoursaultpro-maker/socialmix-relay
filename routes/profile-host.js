/**
 * routes/profile-host.js
 * ★ B2.1 + V7 privacy: GET /api/profile/host/:handle — Tiered access host profile.
 * Optional auth: full profile for friends/past-participants, limited for others.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Party from '../models/Party.js';
import { encodeObjectId } from '../utils/base62.js';
import { computeHostStats } from '../utils/host-stats.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

// ─── GET /:handle — Tiered access host profile ─────────────────────
router.get('/:handle', async (req, res) => {
  try {
    const handle = req.params.handle.toLowerCase().trim();
    
    // Find user by profile.handle
    const user = await User.findOne({ 'profile.handle': handle }).lean();
    if (!user) return res.status(404).json({ error: 'NOT_FOUND' });
    if (user.isBanned || user.isDeleted) return res.status(404).json({ error: 'NOT_FOUND' });
    
    const userId = user._id.toString();

    // ★ V7 privacy: Optional auth — extract viewer userId if token present
    let viewerUserId = null;
    try {
      const authHeader = req.headers.authorization || '';
      if (authHeader.startsWith('Bearer ')) {
        const payload = await verifySupabaseJWT(authHeader.slice(7));
        const viewer = await findOrCreateFromSupabase(payload);
        if (viewer) viewerUserId = viewer._id.toString();
      }
    } catch (_) { /* anonymous */ }

    // ★ V7 privacy: Calculate access level
    let accessLevel = 'limited';
    const isSelf = viewerUserId === userId;

    if (isSelf) {
      accessLevel = 'full';
    } else if (viewerUserId) {
      // Check friendship
      if (user.friends?.some(f => f.userId?.toString() === viewerUserId)) {
        accessLevel = 'full';
      } else {
        // Check past participant of any party hosted by this user
        const sharedParty = await Party.findOne({
          hostUserId: user._id,
          endedAt: { $ne: null },
          'participants.userId': viewerUserId
        }).select('_id').lean();
        if (sharedParty) accessLevel = 'full';
      }
    }

    // ★ V7 privacy: If still limited AND user has profilePublic=true → full (backward compat)
    if (accessLevel === 'limited' && user.preferences?.profilePublic) {
      accessLevel = 'full';
    }

    // ★ V7 privacy: Limited profile response
    if (accessLevel === 'limited') {
      // Compute minimal stats for limited view
      const partiesCount = await Party.countDocuments({ hostUserId: user._id, endedAt: { $ne: null } });
      
      // Determine dominant genre from recent parties
      let dominantGenre = null;
      try {
        const recentParties = await Party.find({ hostUserId: user._id, endedAt: { $ne: null } })
          .sort({ endedAt: -1 }).limit(10).select('dominantGenre').lean();
        const genreCounts = {};
        for (const p of recentParties) {
          if (p.dominantGenre) genreCounts[p.dominantGenre] = (genreCounts[p.dominantGenre] || 0) + 1;
        }
        dominantGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      } catch (_) { /* non-fatal */ }

      // Check if viewer already sent or has pending request
      let alreadyPending = false;
      let alreadyFriend = false;
      if (viewerUserId) {
        const viewer = await User.findById(viewerUserId).select('friends pendingRequests.sent').lean();
        alreadyFriend = viewer?.friends?.some(f => f.userId?.toString() === userId) || false;
        alreadyPending = viewer?.pendingRequests?.sent?.some(r => r.userId?.toString() === userId) || false;
      }

      return res.json({
        isLimited: true,
        profile: {
          _id: userId,
          handle: user.profile?.handle || null,
          firstName: user.profile?.firstName || null,
          avatar: user.profile?.emoji || null,
          totalPartiesCount: partiesCount,
          dominantGenre
        },
        canRequestFriend: !!(viewerUserId && !isSelf && !alreadyFriend && !alreadyPending),
        alreadyPending
      });
    }

    // ★ accessLevel === 'full' — return complete profile with stats + parties
    const { stats, parties, records } = await computeHostStats(userId);
    
    // ─── Response ────────────────────────────────────────────────────
    res.json({
      userId: user._id,
      handle: user.profile?.handle,
      name: user.profile?.firstName || 'Hôte',
      emoji: user.profile?.emoji || null,
      memberSince: user.createdAt,
      stats,
      parties: parties.slice(0, 50),  // Cap at 50 most recent
      records,
      followersCount: user.followers?.length || 0,
      followingCount: user.following?.length || 0,
      friendsCount: user.friends?.length || 0
    });
    
  } catch (err) {
    console.error('[API] ❌ /api/profile/host error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
