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
// ★ V1 A+B — accepte firstName / lastName / emoji / phone / instagram / bio / photoURL (URL ou dataURL base64)
router.patch('/me/profile', async (req, res) => {
  try {
    const user = req.user;
    const { firstName, lastName, emoji, phone, instagram, bio, photoURL } = req.body;

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

    if (phone !== undefined) {
      const p = String(phone).trim().slice(0, 32);
      user.profile.phone = p;
      modified = true;
    }

    if (instagram !== undefined) {
      // Nettoie le @ initial pour stocker le handle brut
      const raw = String(instagram).trim().replace(/^@/, '').slice(0, 40);
      user.profile.instagram = raw;
      modified = true;
    }

    if (bio !== undefined) {
      user.profile.bio = String(bio).slice(0, 160);
      modified = true;
    }

    if (photoURL !== undefined) {
      // ★ Accepte URL absolue (Google/Apple) OU dataURL base64 (upload custom, plafonné à 120 KB)
      //    Le preview client fait déjà un downscale à 200x200 JPEG q=0.85 (~15-30 KB typique).
      const s = photoURL === null ? '' : String(photoURL);
      if (s && s.startsWith('data:image/')) {
        const MAX_DATAURL = 120 * 1024;
        if (s.length > MAX_DATAURL) {
          return res.status(413).json({ error: 'PHOTO_TOO_LARGE', message: `Photo dataURL max ${Math.round(MAX_DATAURL/1024)} KB, reçu ${Math.round(s.length/1024)} KB.` });
        }
      }
      user.profile.photoURL = s || null;
      modified = true;
    }

    if (modified) {
      user.profile.userEdited = true;
      await user.save();
      console.log(`[user-profile] ✅ Updated profile for ${user.email}: fields=${Object.keys(req.body).join(',')}`);
    }

    res.json({
      firstName: user.profile.firstName,
      lastName: user.profile.lastName,
      emoji: user.profile.emoji,
      handle: user.profile.handle,
      phone: user.profile.phone || '',
      instagram: user.profile.instagram || '',
      bio: user.profile.bio || '',
      photoURL: user.profile.photoURL || null
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
