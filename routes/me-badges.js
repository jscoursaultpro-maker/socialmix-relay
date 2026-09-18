import { Router } from 'express';
import { authJWT } from '../middleware/authJWT.js';
import Party from '../models/Party.js';
import { Photo } from '../models/Photo.js';

const router = Router();
router.use(authJWT);

// GET /api/me/badges
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const badges = [];

    // 1. founder_rank
    if (req.user.foundersRank) {
      badges.push({
        key: 'founder_rank',
        label: `Founder #${req.user.foundersRank}`,
        unlockedAt: req.user.createdAt || new Date()
      });
    }

    // 2. photographe_confirme
    const photoCount = await Photo.countDocuments({ guestId: userId });
    if (photoCount >= 20) {
      badges.push({
        key: 'photographe_confirme',
        label: 'Photographe confirmé',
        unlockedAt: new Date() // Ideally we would fetch the 20th photo date, but this is V1
      });
    }

    // Load parties to check remaining badges
    const allParties = await Party.find({
      $or: [
        { hostUserId: req.user._id },
        { 'participants.userId': req.user._id }
      ]
    }).select('endedAt hostUserId participants.userId').lean();

    // 3. dix_soirees
    if (allParties.length >= 10) {
      badges.push({
        key: 'dix_soirees',
        label: '10 soirées',
        unlockedAt: new Date()
      });
    }

    let nuit_blanche_unlocked = false;
    let full_house_unlocked = false;

    for (const p of allParties) {
      // 4. nuit_blanche
      if (p.endedAt && !nuit_blanche_unlocked) {
        const d = new Date(p.endedAt);
        const h = d.getHours();
        if (h >= 4 && h <= 6) {
          nuit_blanche_unlocked = true;
          badges.push({
            key: 'nuit_blanche',
            label: 'Nuit blanche',
            unlockedAt: d
          });
        }
      }
      
      // 5. full_house
      if (p.hostUserId && p.hostUserId.toString() === userId && !full_house_unlocked) {
        if (p.participants && p.participants.length >= 20) {
          full_house_unlocked = true;
          badges.push({
            key: 'full_house',
            label: 'Full House',
            unlockedAt: p.endedAt || new Date()
          });
        }
      }
    }

    res.json({ badges });
  } catch (err) {
    console.error('[API] ❌ GET /api/me/badges error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
