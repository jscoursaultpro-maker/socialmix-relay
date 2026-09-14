import express from 'express';
import { authJWT } from '../middleware/authJWT.js';
import User from '../models/User.js';
import ProviderVote from '../models/ProviderVote.js';

const router = express.Router();

const ALLOWED_PROVIDERS = ['deezer', 'qobuz', 'tidal'];

// POST /provider — Vote for a provider (idempotent per user)
router.post('/provider', authJWT, async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider || !ALLOWED_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider. Must be one of: ${ALLOWED_PROVIDERS.join(', ')}` });
    }

    const userId = req.user._id;

    // Check if user already voted for this provider
    if (req.user.votedProviders && req.user.votedProviders.includes(provider)) {
      // Already voted — return current count
      const counts = await ProviderVote.getCounts();
      return res.json({ already: true, provider, count: counts[provider] || 0 });
    }

    // Record vote on user (idempotent via $addToSet)
    await User.findByIdAndUpdate(userId, {
      $addToSet: { votedProviders: provider }
    });

    // Increment global counter
    const updated = await ProviderVote.findOneAndUpdate(
      { _id: 'counts' },
      { $inc: { [provider]: 1 } },
      { upsert: true, new: true }
    );

    const count = updated[provider] || 1;
    console.log(`[Vote] ✅ ${req.user.profile?.firstName || 'User'} voted for ${provider} (total: ${count})`);

    res.json({ success: true, provider, count });
  } catch (error) {
    console.error('[Vote] ❌ Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /counts — Public endpoint: get vote counts for all providers
router.get('/counts', async (req, res) => {
  try {
    const counts = await ProviderVote.getCounts();
    res.json(counts);
  } catch (error) {
    console.error('[Vote] ❌ Counts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
