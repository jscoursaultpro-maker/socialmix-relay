import express from 'express';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';
import User from '../models/User.js';
import ProviderVote from '../models/ProviderVote.js';

export function createProviderVotesRouter({ verify = verifySupabaseJWT, resolveUser = findOrCreateFromSupabase, UserModel = User, VoteModel = ProviderVote } = {}) {
const router = express.Router();
async function requireUser(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'AUTH_MISSING' });
  try {
    req.user = await resolveUser(await verify(header.slice(7)));
    if (!req.user || req.user.isDeleted || req.user.isBanned) return res.status(403).json({ error: 'ACCOUNT_UNAVAILABLE' });
    next();
  } catch (error) {
    return res.status(error.name === 'AuthError' ? 401 : 500).json({ error: error.name === 'AuthError' ? 'AUTH_FAILED' : 'SERVER_ERROR' });
  }
}

const ALLOWED_PROVIDERS = ['deezer', 'qobuz', 'tidal'];

// POST /provider — Vote for a provider (idempotent per user)
router.post('/provider', requireUser, async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider || !ALLOWED_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider. Must be one of: ${ALLOWED_PROVIDERS.join(', ')}` });
    }

    const userId = req.user._id;

    // Check if user already voted for this provider
    if (req.user.votedProviders && req.user.votedProviders.includes(provider)) {
      // Already voted — return current count
      const counts = await VoteModel.getCounts();
      return res.json({ already: true, provider, count: counts[provider] || 0 });
    }

    // Record vote on user (idempotent via $addToSet)
    await UserModel.findByIdAndUpdate(userId, {
      $addToSet: { votedProviders: provider }
    });

    // Increment global counter
    const updated = await VoteModel.findOneAndUpdate(
      { _id: 'counts' },
      { $inc: { [provider]: 1 } },
      { upsert: true, new: true }
    );

    const count = updated[provider] || 1;
    console.log(`[Vote] Recorded ${provider} vote (total: ${count})`);

    res.json({ success: true, provider, count });
  } catch (error) {
    console.error('[Vote] ❌ Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /counts — Public endpoint: get vote counts for all providers
router.get('/counts', async (req, res) => {
  try {
    const counts = await VoteModel.getCounts();
    res.json(counts);
  } catch (error) {
    console.error('[Vote] ❌ Counts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

return router;
}
export default createProviderVotesRouter();
