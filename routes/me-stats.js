import { Router } from 'express';
import { authJWT } from '../middleware/authJWT.js';
import Party from '../models/Party.js';
import NodeCache from 'node-cache';

const router = Router();
router.use(authJWT);

// Cache for 5 minutes
const statsCache = new NodeCache({ stdTTL: 300 });

// GET /api/me/stats
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const cacheKey = `stats_${userId}`;
    
    const cachedStats = statsCache.get(cacheKey);
    if (cachedStats) {
      res.setHeader('X-Cache-Hit', 'true');
      return res.json(cachedStats);
    }
    res.setHeader('X-Cache-Hit', 'false');

    // === HOST STATS ===
    const partiesHost = await Party.find({ hostUserId: userId }).lean();
    const soireesOrganisees = partiesHost.length;
    
    const distinctGuests = new Set();
    let totalRatio = 0;
    let partiesWithGuests = 0;

    partiesHost.forEach(p => {
      // Collect distinct guests
      const participants = p.participants || [];
      participants.forEach(guest => {
        if (guest.userId && guest.userId.toString() !== userId) {
          distinctGuests.add(guest.userId.toString());
        }
      });

      // Ratio fire moyen (guestsAyantVoteOuSuggere / totalGuests)
      const totalGuests = participants.length;
      if (totalGuests > 0) {
        const activeGuests = new Set();
        
        // Add voters
        Object.keys(p.guestVotes || {}).forEach(k => activeGuests.add(k));
        
        // Add suggesters
        (p.suggestions || []).forEach(s => {
          if (s.suggestedBy) activeGuests.add(s.suggestedBy.toString());
        });

        totalRatio += (activeGuests.size / totalGuests);
        partiesWithGuests++;
      }
    });

    const invitesRecus = distinctGuests.size;
    const ratioFireMoyen = partiesWithGuests > 0 ? Number((totalRatio / partiesWithGuests).toFixed(2)) : 0;

    // === GUEST STATS ===
    const partiesAsGuest = await Party.find({ 
      'participants.userId': req.user._id, 
      hostUserId: { $ne: req.user._id } 
    }).lean();
    
    const soireesRejointes = partiesAsGuest.length;
    let suggestionsFire = 0;
    const hostsSuivisSet = new Set();

    partiesAsGuest.forEach(p => {
      if (p.hostUserId) {
        hostsSuivisSet.add(p.hostUserId.toString());
      }
      (p.suggestions || []).forEach(s => {
        if (s.suggestedBy && s.suggestedBy.toString() === userId && s.played === true) {
          suggestionsFire++;
        }
      });
    });

    const hostsSuivis = hostsSuivisSet.size;

    const stats = {
      host: {
        soireesOrganisees,
        invitesRecus,
        ratioFireMoyen
      },
      invite: {
        soireesRejointes,
        suggestionsFire,
        hostsSuivis
      }
    };

    statsCache.set(cacheKey, stats);
    res.json(stats);

  } catch (err) {
    console.error('[API] ❌ GET /api/me/stats error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
