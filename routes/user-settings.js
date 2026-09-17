import { Router } from 'express';
import User from '../models/User.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

async function requireSupabaseAuth(req, res, next) {
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
    console.error('[requireSupabaseAuth] error:', err.message);
    res.status(401).json({ error: 'AUTH_INVALID', message: 'Invalid or expired token' });
  }
}

// PATCH /api/user/me/settings
router.patch('/me/settings', requireSupabaseAuth, async (req, res) => {
  try {
    const user = req.currentUser;
    const { allowPublicMode } = req.body || {};

    if (!user.settings) user.settings = {};

    let modified = false;

    if (typeof allowPublicMode === 'boolean') {
      user.settings.allowPublicMode = allowPublicMode;
      modified = true;
    }

    // Add future settings here

    if (modified) {
      await user.save();
    }

    res.json(user.settings);
  } catch (err) {
    console.error(`PATCH /api/user/me/settings error:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
