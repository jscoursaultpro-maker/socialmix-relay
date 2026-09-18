import { Router } from 'express';
import { authJWT } from '../middleware/authJWT.js';
import Crew from '../models/Crew.js';
import { fetchUserFoundersData } from '../utils/founders.js';

const router = Router();

// Middleware auth
router.use(authJWT);

// GET /api/me/crews
// Retourne les crews (groupes de fête) auxquels appartient l'user connecté.
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id;

    const crews = await Crew.find({ members: userId })
      .populate('members', 'profile.handle profile.firstName profile.emoji profile.photo foundersRank')
      .populate('createdBy', 'profile.handle profile.firstName profile.emoji profile.photo foundersRank')
      .lean();

    // Enrichir chaque membre et le créateur avec les données "founders"
    const enrichedCrews = await Promise.all(crews.map(async (crew) => {
      // Enrich members
      const members = await Promise.all((crew.members || []).map(async (member) => {
        const founderData = await fetchUserFoundersData(member._id.toString());
        return {
          _id: member._id,
          handle: member.profile?.handle || member.profile?.firstName || null,
          emoji: member.profile?.emoji || null,
          photo: member.profile?.photo || null,
          foundersRank: founderData.foundersRank,
          foundersIntentSubmitted: founderData.foundersIntentSubmitted,
          foundersIntentPosition: founderData.foundersIntentPosition
        };
      }));

      // Enrich createdBy
      let createdBy = null;
      if (crew.createdBy) {
        const creatorData = await fetchUserFoundersData(crew.createdBy._id.toString());
        createdBy = {
          _id: crew.createdBy._id,
          handle: crew.createdBy.profile?.handle || crew.createdBy.profile?.firstName || null,
          emoji: crew.createdBy.profile?.emoji || null,
          photo: crew.createdBy.profile?.photo || null,
          foundersRank: creatorData.foundersRank,
          foundersIntentSubmitted: creatorData.foundersIntentSubmitted,
          foundersIntentPosition: creatorData.foundersIntentPosition
        };
      }

      return {
        _id: crew._id,
        name: crew.name,
        emoji: crew.emoji,
        memberCount: members.length,
        members,
        createdBy
      };
    }));

    res.json({ crews: enrichedCrews });
  } catch (err) {
    console.error('[API] ❌ GET /api/me/crews error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/me/crews (Helper création BONUS)
router.post('/', async (req, res) => {
  try {
    const { name, emoji } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const newCrew = new Crew({
      name,
      emoji: emoji || '🤘',
      members: [req.user._id], // The creator is automatically the first member
      createdBy: req.user._id
    });

    await newCrew.save();

    res.status(201).json({ status: 'success', crewId: newCrew._id });
  } catch (err) {
    console.error('[API] ❌ POST /api/me/crews error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
