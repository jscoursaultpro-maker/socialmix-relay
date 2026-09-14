import express from 'express';
import FoundersIntent from '../../models/FoundersIntent.js';

const router = express.Router();

router.get('/list', async (req, res) => {
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
