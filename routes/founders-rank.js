// routes/founders-rank.js
// ★ Task #81: GET + POST /api/user/me/founders-rank
// Founders program — 2500 slots, opt-in, atomique.
// TODO V1.1 : remplacer par webhook RevenueCat quand tier payant arrive.

import { Router } from 'express';
import User from '../models/User.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();
const TOTAL_SLOTS = 2500;

/**
 * Extract authenticated Mongo user from Bearer JWT.
 * Reuses the exact same pattern as GET /api/me (server.js L335-356).
 */
async function extractUser(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const payload = await verifySupabaseJWT(token);
  return findOrCreateFromSupabase(payload);
}

/**
 * GET / — Consultation pure (jamais de write).
 * Response: { foundersRank, totalSlots, slotsClaimed, slotsRemaining }
 */
router.get('/', async (req, res) => {
  try {
    const user = await extractUser(req);
    if (!user) return res.status(401).json({ error: 'AUTH_MISSING', message: 'Authorization: Bearer <token> required' });

    const slotsClaimed = await User.countDocuments({ foundersRank: { $ne: null } });

    res.json({
      foundersRank: user.foundersRank ?? null,
      totalSlots: TOTAL_SLOTS,
      slotsClaimed,
      slotsRemaining: TOTAL_SLOTS - slotsClaimed,
    });
  } catch (err) {
    if (err.name === 'AuthError') {
      return res.status(401).json({ error: err.code, message: err.message });
    }
    console.error('[FoundersRank] GET error:', err.message);
    res.status(500).json({ error: 'INTERNAL' });
  }
});

/**
 * POST / — Claim founder slot (atomique, spec Task #81 §4.4).
 *
 * Atomicity guarantee:
 *   findOneAndUpdate({ _id, foundersRank: null }, { $set: { foundersRank: nextRank } })
 *   → If another request claimed between count and update, the filter
 *     `foundersRank: null` won't match → result is null → 409.
 */
router.post('/', async (req, res) => {
  try {
    const user = await extractUser(req);
    if (!user) return res.status(401).json({ error: 'AUTH_MISSING', message: 'Authorization: Bearer <token> required' });

    // Already a founder → 409
    if (user.foundersRank != null) {
      return res.status(409).json({
        error: 'ALREADY_REGISTERED',
        foundersRank: user.foundersRank,
      });
    }

    // Count current founders
    const slotsClaimed = await User.countDocuments({ foundersRank: { $ne: null } });
    const nextRank = slotsClaimed + 1;

    // No slots remaining → 410
    if (nextRank > TOTAL_SLOTS) {
      return res.status(410).json({
        error: 'FOUNDERS_FULL',
        totalClaimed: TOTAL_SLOTS,
      });
    }

    // Atomic claim: filter includes `foundersRank: null` to prevent race conditions
    const updated = await User.findOneAndUpdate(
      { _id: user._id, foundersRank: null },
      { $set: { foundersRank: nextRank } },
      { new: true }
    );

    // Race condition: another request claimed between count and update
    if (!updated) {
      // Re-read user to check if they became a founder via the other request
      const freshUser = await User.findById(user._id).select('foundersRank').lean();
      if (freshUser?.foundersRank != null) {
        return res.status(409).json({
          error: 'ALREADY_REGISTERED',
          foundersRank: freshUser.foundersRank,
        });
      }
      // Truly lost the race to another user — retry once
      const retryCount = await User.countDocuments({ foundersRank: { $ne: null } });
      const retryRank = retryCount + 1;
      if (retryRank > TOTAL_SLOTS) {
        return res.status(410).json({ error: 'FOUNDERS_FULL', totalClaimed: TOTAL_SLOTS });
      }
      const retried = await User.findOneAndUpdate(
        { _id: user._id, foundersRank: null },
        { $set: { foundersRank: retryRank } },
        { new: true }
      );
      if (!retried) {
        return res.status(409).json({ error: 'ALREADY_REGISTERED', foundersRank: null });
      }
      console.log(`[FoundersRank] 🎖️ Founder #${retryRank} claimed (retry) by ${user.email || user._id}`);
      return res.json({ foundersRank: retryRank, totalSlots: TOTAL_SLOTS });
    }

    console.log(`[FoundersRank] 🎖️ Founder #${nextRank} claimed by ${user.email || user._id}`);
    res.json({ foundersRank: nextRank, totalSlots: TOTAL_SLOTS });
  } catch (err) {
    if (err.name === 'AuthError') {
      return res.status(401).json({ error: err.code, message: err.message });
    }
    console.error('[FoundersRank] POST error:', err.message);
    res.status(500).json({ error: 'INTERNAL' });
  }
});

export default router;
