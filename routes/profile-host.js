/**
 * routes/profile-host.js
 * ★ B2.1: GET /api/profile/host/:handle — Public host profile with aggregated stats.
 * No auth required (public endpoint). Respects profilePublic RGPD opt-in.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Party from '../models/Party.js';
import { encodeObjectId } from '../utils/base62.js';
import { computeHostStats } from '../utils/host-stats.js';

const router = Router();

// ─── GET /:handle — Public host profile ─────────────────────────────
router.get('/:handle', async (req, res) => {
  try {
    const handle = req.params.handle.toLowerCase().trim();
    
    // Find user by profile.handle
    const user = await User.findOne({ 'profile.handle': handle }).lean();
    if (!user) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!user.preferences?.profilePublic) return res.status(404).json({ error: 'NOT_FOUND' });
    if (user.isBanned || user.isDeleted) return res.status(404).json({ error: 'NOT_FOUND' });
    
    const userId = user._id;
    
    const { stats, parties, records } = await computeHostStats(userId);
    
    // ─── Response ────────────────────────────────────────────────────
    res.json({
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
