import express from 'express';
import FoundersIntent from '../../models/FoundersIntent.js';

const router = express.Router();

// Middleware auth admin — x-admin-token doit égaler ADMIN_PASSWORD
function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token');
  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

router.get('/list', requireAdmin, async (req, res) => {
  try {
    const CAP = 2500;
    const docs = await FoundersIntent.find({}).sort({ createdAt: 1 }).lean();
    const list = docs.map((d, idx) => ({
      email: d.email,
      userId: d.userId ? String(d.userId) : null,
      createdAt: d.createdAt,
      source: d.source,
      position: idx + 1,
    }));
    res.json({ total: list.length, cap: CAP, list });
  } catch (err) {
    console.error('[admin/founders/list] error', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
