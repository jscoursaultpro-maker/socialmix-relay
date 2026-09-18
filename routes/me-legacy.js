import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';

const router = Router();

router.get('/legacy', verifyGuestAuth, (req, res) => {
  const user = req.user;
  res.json({
    userId: user._id.toString(),
    firstName: user.profile?.firstName || user.firstName || 'Guest',
    lastName: user.profile?.lastName || user.lastName || '',
    email: user.email,
    handle: user.profile?.handle || user.handle,
    emoji: user.profile?.emoji || user.emoji || '👽',
    photo: user.profile?.photo || user.photo || null
  });
});

export default router;
