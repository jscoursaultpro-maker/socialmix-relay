/**
 * routes/user-profile-update.js
 * ★ Sprint B: PATCH /api/user/me/profile — Update guest profile (firstName, lastName, emoji)
 * Uses verifyGuestAuth (Supabase JWT + legacy JWT)
 */
import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';

const router = Router();
router.use(verifyGuestAuth);

// PATCH /api/user/me/profile
router.patch('/me/profile', async (req, res) => {
  try {
    const user = req.user;
    const { firstName, lastName, emoji } = req.body;

    if (!user.profile) user.profile = {};

    let modified = false;

    if (firstName !== undefined) {
      const trimmed = String(firstName).trim();
      if (!trimmed || trimmed.length > 40) {
        return res.status(400).json({ error: 'INVALID_NAME', message: 'firstName must be 1-40 chars' });
      }
      user.profile.firstName = trimmed;
      modified = true;
    }

    if (lastName !== undefined) {
      user.profile.lastName = String(lastName).trim().slice(0, 40);
      modified = true;
    }

    if (emoji !== undefined) {
      user.profile.emoji = String(emoji).slice(0, 4);
      modified = true;
    }

    if (modified) {
      user.profile.userEdited = true;
      await user.save();
      console.log(`[user-profile] ✅ Updated profile for ${user.email}: firstName="${user.profile.firstName}"`);
    }

    res.json({
      firstName: user.profile.firstName,
      lastName: user.profile.lastName,
      emoji: user.profile.emoji,
      handle: user.profile.handle
    });
  } catch (err) {
    console.error('[user-profile] ❌ PATCH error:', err.message);
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: err.message });
    }
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
