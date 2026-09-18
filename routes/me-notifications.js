import { Router } from 'express';
import mongoose from 'mongoose';
import { authJWT } from '../middleware/authJWT.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Party from '../models/Party.js';
import { fetchUserFoundersData } from '../utils/founders.js';

const router = Router();
router.use(authJWT);

// GET /api/me/notifications?limit=20&cursor=<createdAt>
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const cursor = req.query.cursor;
    
    const query = { userId: req.user._id };
    if (cursor) {
      query.createdAt = { $lt: new Date(cursor) };
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Enrich payload with user/party data
    const enrichedNotifications = await Promise.all(notifications.map(async (notif) => {
      const payload = { ...notif.payload };
      
      // Enrich with Party data if partyId is present
      if (payload.partyId) {
        const party = await Party.findById(payload.partyId).select('welcomeText coverPhoto').lean();
        if (party) {
          payload.partyName = party.welcomeText || 'Soirée';
          payload.partyCover = party.coverPhoto || null;
        }
      }

      // Helper for user enrichment
      const enrichUser = async (uId) => {
        const user = await User.findById(uId).select('profile.firstName profile.handle profile.emoji profile.photo').lean();
        if (!user) return null;
        const founderData = await fetchUserFoundersData(uId.toString());
        return {
          _id: user._id,
          handle: user.profile?.handle || user.profile?.firstName || null,
          emoji: user.profile?.emoji || null,
          photo: user.profile?.photo || null,
          foundersRank: founderData.foundersRank,
          foundersIntentSubmitted: founderData.foundersIntentSubmitted,
          foundersIntentPosition: founderData.foundersIntentPosition
        };
      };

      // Enrich fromUserId or hostUserId
      if (payload.fromUserId) {
        payload.fromUser = await enrichUser(payload.fromUserId);
      }
      if (payload.hostUserId) {
        payload.hostUser = await enrichUser(payload.hostUserId);
      }

      return {
        _id: notif._id,
        type: notif.type,
        payload,
        read: notif.read,
        createdAt: notif.createdAt
      };
    }));

    const nextCursor = enrichedNotifications.length === limit ? enrichedNotifications[limit - 1].createdAt : null;

    res.json({
      notifications: enrichedNotifications,
      nextCursor
    });

  } catch (err) {
    console.error('[API] ❌ GET /api/me/notifications error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/me/notifications/:id/read (Bonus)
router.post('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'INVALID_ID' });

    const notif = await Notification.findOneAndUpdate(
      { _id: id, userId: req.user._id },
      { $set: { read: true } },
      { new: true }
    ).lean();

    if (!notif) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ status: 'success', read: true });
  } catch (err) {
    console.error('[API] ❌ POST /api/me/notifications/:id/read error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
