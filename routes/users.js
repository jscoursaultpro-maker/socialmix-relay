import express from 'express';
import User from '../models/User.js';
import { authJWT } from '../middleware/authJWT.js';

const router = express.Router();

// All routes here are protected by JWT
router.use(authJWT);

// GET /api/users/me
router.get('/me', (req, res) => {
  res.json(req.user);
});

// PATCH /api/users/me
router.patch('/me', async (req, res) => {
  const { firstName, emoji, handle, bio, preferences } = req.body;
  
  if (firstName !== undefined) req.user.profile.firstName = firstName;
  if (emoji !== undefined) req.user.profile.emoji = emoji;
  if (handle !== undefined) req.user.profile.handle = handle.toLowerCase();
  if (bio !== undefined) req.user.profile.bio = bio;
  
  if (preferences) {
    req.user.preferences = { ...req.user.preferences, ...preferences };
  }
  
  try {
    await req.user.save();
    res.json(req.user);
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ error: 'Handle already taken' });
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/me/parties
router.get('/me/parties', (req, res) => {
  // partiesAttended are denormalized inside the User document
  res.json(req.user.partiesAttended || []);
});

// GET /api/users/me/friends
router.get('/me/friends', async (req, res) => {
  const userWithFriends = await User.findById(req.user._id).populate('friends.userId', 'profile authProvider isDeleted');
  // Filter out deleted friends
  const activeFriends = userWithFriends.friends.filter(f => f.userId && !f.userId.isDeleted);
  res.json(activeFriends);
});

// POST /api/users/friend-request
router.post('/friend-request', async (req, res) => {
  const { targetUserId } = req.body;
  if (targetUserId === req.user._id.toString()) {
    return res.status(400).json({ error: 'Cannot send request to yourself' });
  }
  
  const targetUser = await User.findById(targetUserId);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });
  
  // Check if already friends or blocked
  const alreadyFriends = req.user.friends.some(f => f.userId.toString() === targetUserId);
  if (alreadyFriends) return res.status(400).json({ error: 'Already friends' });
  
  const alreadySent = targetUser.pendingRequests.received.some(r => r.userId.toString() === req.user._id.toString());
  if (alreadySent) return res.status(400).json({ error: 'Request already sent' });

  // Add to target's received
  targetUser.pendingRequests.received.push({ userId: req.user._id });
  await targetUser.save();
  
  // Add to requester's sent
  req.user.pendingRequests.sent.push({ userId: targetUser._id });
  await req.user.save();
  
  res.json({ message: 'Friend request sent' });
});

// POST /api/users/friend-accept
router.post('/friend-accept', async (req, res) => {
  const { requesterId } = req.body;
  
  // Verify it exists in received
  const reqIndex = req.user.pendingRequests.received.findIndex(r => r.userId.toString() === requesterId);
  if (reqIndex === -1) return res.status(400).json({ error: 'No pending request found' });
  
  const requesterUser = await User.findById(requesterId);
  if (!requesterUser) return res.status(404).json({ error: 'Requester not found' });
  
  // Add to friends arrays
  req.user.friends.push({ userId: requesterUser._id });
  requesterUser.friends.push({ userId: req.user._id });
  
  // Remove from pending
  req.user.pendingRequests.received.splice(reqIndex, 1);
  requesterUser.pendingRequests.sent = requesterUser.pendingRequests.sent.filter(s => s.userId.toString() !== req.user._id.toString());
  
  await Promise.all([req.user.save(), requesterUser.save()]);
  
  res.json({ message: 'Friend request accepted' });
});

// POST /api/users/friend-reject
router.post('/friend-reject', async (req, res) => {
  const { requesterId } = req.body;
  
  req.user.pendingRequests.received = req.user.pendingRequests.received.filter(r => r.userId.toString() !== requesterId);
  
  const requesterUser = await User.findById(requesterId);
  if (requesterUser) {
    requesterUser.pendingRequests.sent = requesterUser.pendingRequests.sent.filter(s => s.userId.toString() !== req.user._id.toString());
    await requesterUser.save();
  }
  
  await req.user.save();
  res.json({ message: 'Friend request rejected' });
});

// DELETE /api/users/friends/:userId
router.delete('/friends/:userId', async (req, res) => {
  const { userId } = req.params;
  
  req.user.friends = req.user.friends.filter(f => f.userId.toString() !== userId);
  
  const otherUser = await User.findById(userId);
  if (otherUser) {
    otherUser.friends = otherUser.friends.filter(f => f.userId.toString() !== req.user._id.toString());
    await otherUser.save();
  }
  
  await req.user.save();
  res.json({ message: 'Unfriended' });
});

// POST /api/users/block
router.post('/block', async (req, res) => {
  const { targetUserId } = req.body;
  
  if (!req.user.blockedUsers.includes(targetUserId)) {
    req.user.blockedUsers.push(targetUserId);
  }
  
  // Unfriend automatically if blocked
  req.user.friends = req.user.friends.filter(f => f.userId.toString() !== targetUserId);
  const targetUser = await User.findById(targetUserId);
  if (targetUser) {
    targetUser.friends = targetUser.friends.filter(f => f.userId.toString() !== req.user._id.toString());
    await targetUser.save();
  }
  
  await req.user.save();
  res.json({ message: 'User blocked' });
});

// GET /api/users/search?q=...
router.get('/search', async (req, res) => {
  const query = req.query.q;
  if (!query || query.length < 2) return res.json([]);
  
  const users = await User.find({
    $or: [
      { 'profile.handle': { $regex: query, $options: 'i' } },
      { 'profile.firstName': { $regex: query, $options: 'i' } }
    ],
    isDeleted: false,
    'preferences.discoverableByFriends': true
  }).limit(20).select('profile');
  
  // Exclude self and blocked
  const blockedStrings = req.user.blockedUsers.map(b => b.toString());
  const filtered = users.filter(u => 
    u._id.toString() !== req.user._id.toString() && 
    !blockedStrings.includes(u._id.toString())
  );
  
  res.json(filtered);
});

export default router;
