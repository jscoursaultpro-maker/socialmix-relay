import { Router } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'AUTH_MISSING' });
    }
    const token = authHeader.slice(7);
    const payload = await verifySupabaseJWT(token);
    const user = await findOrCreateFromSupabase(payload);
    
    if (!user) return res.status(401).json({ error: 'USER_NOT_FOUND' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

router.post('/', requireAuth, async (req, res) => {
  const { guestId } = req.body;
  
  if (!guestId || typeof guestId !== 'string' || guestId.length < 5 || guestId.length > 100) {
    return res.status(400).json({ error: 'Invalid guestId' });
  }

  const userIdStr = req.user._id.toString();

  // 3. Vérifier idempotence
  const userClaimed = req.user.get('claimedGuestIds') || [];
  if (userClaimed.includes(guestId)) {
    return res.json({ success: true, migrated: { parties: 0, fireVotes: 0, suggestions: 0 }, note: 'already_claimed_by_you' });
  }

  // 4. Vérifier no-conflict
  const alreadyClaimed = await User.findOne({ claimedGuestIds: guestId, _id: { $ne: req.user._id } });
  if (alreadyClaimed) {
    return res.status(409).json({ error: 'guest_already_claimed' });
  }

  const db = mongoose.connection.db;

  let migrated = { parties: 0, fireVotes: 0, suggestions: 0 };

  try {
    // 5. Exécuter migration (guestId -> userId)
    // - parties (participants array)
    const pRes = await db.collection('parties').updateMany(
      { 'participants.sessionToken': guestId },
      { 
        $set: { 'participants.$.userId': userIdStr },
        $unset: { 'participants.$.sessionToken': "" }
      }
    );
    const pRes2 = await db.collection('parties').updateMany(
      { 'participants.guestId': guestId },
      { 
        $set: { 'participants.$.userId': userIdStr },
        $unset: { 'participants.$.guestId': "" }
      }
    );

    // - fire_votes
    const fRes = await db.collection('fire_votes').updateMany(
      { guestId: guestId },
      { $set: { userId: userIdStr }, $unset: { guestId: "" } }
    );

    // - suggestions
    const sRes = await db.collection('suggestions').updateMany(
      { guestId: guestId },
      { $set: { userId: userIdStr }, $unset: { guestId: "" } }
    );

    migrated.parties = (pRes.modifiedCount || 0) + (pRes2.modifiedCount || 0);
    migrated.fireVotes = fRes.modifiedCount || 0;
    migrated.suggestions = sRes.modifiedCount || 0;

    // 6. Ajouter guestId dans user.claimedGuestIds
    await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { claimedGuestIds: guestId } }
    );

    // 7. Logger côté serveur
    console.log(`[claim-guest-data] User ${userIdStr} claimed guestId ${guestId} -> migrated`, migrated);

    res.json({ success: true, migrated });
  } catch (error) {
    console.error(`[claim-guest-data] Error:`, error);
    res.status(500).json({ error: 'Migration failed' });
  }
});

export default router;
