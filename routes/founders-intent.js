import express from 'express';
import crypto from 'crypto';
import FoundersIntent from '../models/FoundersIntent.js';

const router = express.Router();

// Basic in-memory rate limiting (max 10 requests per IP per hour)
const rateLimitMap = new Map();

// Helper to clean up rate limit map
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [ip, data] of rateLimitMap.entries()) {
    if (data.timestamp < oneHourAgo) {
      rateLimitMap.delete(ip);
    }
  }
}, 3600000);

router.post('/', async (req, res) => {
  try {
    const { email, userId } = req.body;
    
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ ok: false, error: 'invalid_email' });
    }
    
    // Simple email validation regex
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'invalid_email' });
    }
    
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const userAgent = req.headers['user-agent'] || null;
    
    // Rate limit check
    const now = Date.now();
    const rateData = rateLimitMap.get(ipHash) || { count: 0, timestamp: now };
    if (rateData.count >= 10 && rateData.timestamp > now - 3600000) {
      return res.status(429).json({ ok: false, error: 'too_many_requests' });
    }
    
    rateLimitMap.set(ipHash, { 
      count: rateData.count + 1, 
      timestamp: rateData.timestamp 
    });

    const intent = new FoundersIntent({
      email: email.toLowerCase().trim(),
      userId: userId || null,
      userAgent,
      ipHash
    });
    
    await intent.save();
    
    return res.status(201).json({ ok: true, alreadyRegistered: false });
    
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key error - idempotent success
      return res.status(200).json({ ok: true, alreadyRegistered: true });
    }
    console.error('Founders intent error:', error);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

export default router;
