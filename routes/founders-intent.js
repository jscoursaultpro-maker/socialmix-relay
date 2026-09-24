import express from 'express';
import crypto from 'crypto';
import FoundersIntent from '../models/FoundersIntent.js';
import { sendFoundersConfirmationEmail } from '../services/foundersEmailService.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = express.Router();

// Basic in-memory rate limiting (max 10 requests per IP per hour)
const rateLimitMap = new Map();
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [ip, data] of rateLimitMap.entries()) {
    if (data.timestamp < oneHourAgo) rateLimitMap.delete(ip);
  }
}, 3600000);

let cachedCount = null;
let cachedCountAt = 0;
const COUNT_CACHE_TTL_MS = 60 * 1000;
const FOUNDERS_CAP = 2500;

async function getFoundersCountCached() {
  const now = Date.now();
  if (cachedCount !== null && (now - cachedCountAt) < COUNT_CACHE_TTL_MS) {
    return cachedCount;
  }
  const count = await FoundersIntent.countDocuments({});
  cachedCount = count;
  cachedCountAt = now;
  return count;
}

function invalidateFoundersCountCache() {
  cachedCount = null;
  cachedCountAt = 0;
}

router.get('/count', async (req, res) => {
  try {
    const count = await getFoundersCountCached();
    res.json({ count, cap: FOUNDERS_CAP });
  } catch (err) {
    console.error('[founders/count] error', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/status', async (req, res) => {
  try {
    const userId = req.query.userId;
    const email = req.query.email ? String(req.query.email).toLowerCase() : null;
    if (!userId && !email) {
      return res.status(400).json({ error: 'userId_or_email_required' });
    }
    const filter = userId ? { userId } : { email };
    const doc = await FoundersIntent.findOne(filter).lean();
    if (!doc) {
      return res.json({ inList: false, position: null });
    }
    // Position = 1 + count of docs created before this one
    const position = 1 + await FoundersIntent.countDocuments({ createdAt: { $lt: doc.createdAt } });
    res.json({ inList: true, position });
  } catch (err) {
    console.error('[founders/status] error', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/intent', async (req, res) => {
  try {
    const rawEmail = String(req.body.email || '').trim().toLowerCase();
    const userId = req.body.userId ? String(req.body.userId) : null;
    const source = req.body.source ? String(req.body.source).slice(0, 60) : 'iOS-V7';
    const userAgent = req.headers['user-agent'] ? req.headers['user-agent'].slice(0, 200) : null;
    
    const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
    const ipHash = req.body.ipHash || crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!rawEmail || rawEmail.length > 254 || !EMAIL_REGEX.test(rawEmail)) {
      return res.status(400).json({ error: 'invalid_email' });
    }

    // Rate limit check
    const now = Date.now();
    const rateData = rateLimitMap.get(ipHash) || { count: 0, timestamp: now };
    if (rateData.count >= 10 && rateData.timestamp > now - 3600000) {
      return res.status(429).json({ error: 'too_many_requests' });
    }
    rateLimitMap.set(ipHash, { count: rateData.count + 1, timestamp: rateData.timestamp });

    // Vérifie idempotence
    const existing = await FoundersIntent.findOne({ email: rawEmail }).lean();
    if (existing) {
      const position = 1 + await FoundersIntent.countDocuments({ createdAt: { $lt: existing.createdAt } });
      const total = await getFoundersCountCached();
      return res.json({ alreadyIn: true, position, total, cap: FOUNDERS_CAP });
    }

    // Hard cap 2500
    const currentCount = await FoundersIntent.countDocuments({});
    if (currentCount >= FOUNDERS_CAP) {
      return res.status(409).json({ error: 'cap_reached', total: currentCount, cap: FOUNDERS_CAP });
    }

    // Créer
    const doc = new FoundersIntent({ email: rawEmail, userId, source, userAgent, ipHash });
    await doc.save();
    invalidateFoundersCountCache();

    const position = currentCount + 1;
    const total = position;

    // Envoi email async
    sendFoundersConfirmationEmail({ email: rawEmail, position, total })
      .then(r => console.log('[founders/intent] email sent:', r.sent, 'position', position))
      .catch(err => console.error('[founders/intent] email error:', err.message));

    res.json({ alreadyIn: false, position, total, cap: FOUNDERS_CAP });
  } catch (err) {
    if (err.code === 11000) {
      const existing = await FoundersIntent.findOne({ email: String(req.body.email || '').toLowerCase() }).lean();
      if (existing) {
        const position = 1 + await FoundersIntent.countDocuments({ createdAt: { $lt: existing.createdAt } });
        const total = await getFoundersCountCached();
        return res.json({ alreadyIn: true, position, total, cap: FOUNDERS_CAP });
      }
    }
    console.error('[founders/intent] error', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// Libérer une réservation exige une session AhOuai vérifiée. Un email seul
// ne doit jamais permettre de supprimer le siège de quelqu'un d'autre.
router.delete('/intent', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'AUTH_MISSING' });
    const payload = await verifySupabaseJWT(authHeader.slice(7));
    const user = await findOrCreateFromSupabase(payload);
    const normalizedEmail = String(user.email || payload.email || '').trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ error: 'EMAIL_MISSING' });
    const deleted = await FoundersIntent.findOneAndDelete({ email: normalizedEmail });
    if (!deleted) return res.status(404).json({ error: 'SEAT_NOT_FOUND' });
    invalidateFoundersCountCache();
    return res.json({ released: true });
  } catch (err) {
    if (err.name === 'AuthError') return res.status(401).json({ error: err.code || 'AUTH_FAILED' });
    console.error('[founders/intent] release error', err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
