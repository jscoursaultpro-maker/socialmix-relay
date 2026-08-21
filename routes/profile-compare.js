/**
 * routes/profile-compare.js
 * ★ B2.2: GET /api/profile/compare/:handle1/:handle2 — Juxtaposed stats endpoint
 * Public endpoint (no auth required), requires both profiles to be public.
 */
import { Router } from 'express';
import User from '../models/User.js';
import { computeHostStats } from '../utils/host-stats.js';

const router = Router();

router.get('/:handle1/:handle2', async (req, res) => {
  try {
    const handle1 = req.params.handle1.toLowerCase().trim();
    const handle2 = req.params.handle2.toLowerCase().trim();
    
    if (handle1 === handle2) {
      return res.status(400).json({ error: 'SAME_USER', message: 'Cannot compare a user with themselves' });
    }
    
    const [user1, user2] = await Promise.all([
      User.findOne({ 'profile.handle': handle1 }).lean(),
      User.findOne({ 'profile.handle': handle2 }).lean()
    ]);
    
    if (!user1 || !user2) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (!user1.preferences?.profilePublic || !user2.preferences?.profilePublic) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (user1.isBanned || user1.isDeleted || user2.isBanned || user2.isDeleted) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    
    // Compute stats for both in parallel
    const [stats1, stats2] = await Promise.all([
      computeHostStats(user1._id),
      computeHostStats(user2._id)
    ]);
    
    const s1 = stats1.stats;
    const s2 = stats2.stats;
    
    const differences = {
      moreParties: s1.totalParties > s2.totalParties ? 'user1' : s1.totalParties < s2.totalParties ? 'user2' : 'tie',
      moreGuestsHosted: s1.totalGuestsHosted > s2.totalGuestsHosted ? 'user1' : s1.totalGuestsHosted < s2.totalGuestsHosted ? 'user2' : 'tie',
      longerAverage: s1.averageFeuRatio > s2.averageFeuRatio ? 'user1' : s1.averageFeuRatio < s2.averageFeuRatio ? 'user2' : 'tie',
      sharedGenre: (s1.topGenre && s1.topGenre === s2.topGenre) ? s1.topGenre : null
    };
    
    res.json({
      user1: {
        handle: user1.profile?.handle,
        name: user1.profile?.firstName || 'Hôte 1',
        emoji: user1.profile?.emoji || null,
        stats: s1
      },
      user2: {
        handle: user2.profile?.handle,
        name: user2.profile?.firstName || 'Hôte 2',
        emoji: user2.profile?.emoji || null,
        stats: s2
      },
      differences
    });
    
  } catch (err) {
    console.error('[API] ❌ GET /api/profile/compare error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
