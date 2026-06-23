import express from 'express';
import User from '../../models/User.js';
import AuthToken from '../../models/AuthToken.js';

const router = express.Router();

// GET /api/admin/users?page=1&limit=20&search=&provider=
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const search = req.query.search || '';
  const provider = req.query.provider || '';

  let query = {};

  if (search) {
    query.$or = [
      { email: { $regex: search, $options: 'i' } },
      { 'profile.firstName': { $regex: search, $options: 'i' } },
      { 'profile.handle': { $regex: search, $options: 'i' } }
    ];
  }

  if (provider && provider !== 'all') {
    query.authProvider = provider;
  }

  try {
    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('email profile authProvider providerId partiesAttended createdAt lastSeenAt isBanned isDeleted');

    const total = await User.countDocuments(query);
    
    // Quick active stats logic (approximation)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const active7 = await User.countDocuments({ lastSeenAt: { $gte: sevenDaysAgo } });
    const active30 = await User.countDocuments({ lastSeenAt: { $gte: thirtyDaysAgo } });

    res.json({
      users,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      active7,
      active30
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users/:id
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/users/:id
router.patch('/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/ban
router.post('/:id/ban', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.isBanned = true;
    user.bannedAt = new Date();
    user.bannedReason = req.body.reason || 'Banned by admin';
    await user.save();
    
    // Also invalidate tokens
    await AuthToken.deleteMany({ userId: user._id });
    
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/unban
router.post('/:id/unban', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.isBanned = false;
    user.bannedAt = undefined;
    user.bannedReason = undefined;
    await user.save();
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/anonymize
router.post('/:id/anonymize', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const uId = user._id.toString();
    user.email = `deleted_${uId}@socialmix.deleted`;
    user.profile.firstName = 'Deleted User';
    user.profile.emoji = '👤';
    user.profile.photoURL = null;
    user.profile.handle = null;
    user.profile.bio = null;
    user.aliasHistory = [];
    user.devices = [];
    user.isDeleted = true;
    user.deletedAt = new Date();
    
    await user.save();
    await AuthToken.deleteMany({ userId: user._id });
    
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users/:id/export
router.get('/:id/export', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    res.setHeader('Content-disposition', `attachment; filename=socialmix_export_${user._id}.json`);
    res.setHeader('Content-type', 'application/json');
    res.send(JSON.stringify(user, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/force-logout
router.post('/:id/force-logout', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    await AuthToken.deleteMany({ userId: user._id });
    res.json({ message: 'User logged out and tokens invalidated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete('/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await AuthToken.deleteMany({ userId: req.params.id });
    res.json({ message: 'User permanently deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
