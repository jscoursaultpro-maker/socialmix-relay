/**
 * routes/party-actions.js
 * ★ V7 feat(afterglow): JustPlay opt-in endpoints
 *   PATCH /api/host/parties/:code/save-to-afterglow — opt-in at end of party
 *   PATCH /api/host/parties/:code/rename — mid-party rename (converts JustPlay → real party)
 */
import { Router } from 'express';
import Party from '../models/Party.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'AUTH_MISSING', message: 'Authorization: Bearer <token> required' });
    }
    const token = authHeader.slice(7);
    const payload = await verifySupabaseJWT(token);
    const user = await findOrCreateFromSupabase(payload);
    req.currentUser = user;
    next();
  } catch (err) {
    if (err.name === 'AuthError') {
      return res.status(401).json({ error: 'AUTH_FAILED', message: err.message });
    }
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
}

// ── PATCH /:code/save-to-afterglow ──────────────────────────────────────────
// End-of-party opt-in: mark JustPlay party as saved to AfterGlow.
router.patch('/:code/save-to-afterglow', requireAuth, async (req, res) => {
  try {
    const { code } = req.params;
    const userId = req.currentUser._id.toString();

    const party = await Party.findOne({ code });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    // Verify user is host
    if (!party.hostUserId || party.hostUserId.toString() !== userId) {
      return res.status(403).json({ error: 'NOT_HOST', message: 'Only the host can save to AfterGlow' });
    }

    party.savedToAfterglow = true;
    await party.save();

    console.log(`[PartyActions] ✅ Party ${code} saved to AfterGlow by host ${userId}`);
    return res.json({ ok: true, savedToAfterglow: true });
  } catch (err) {
    console.error('[PartyActions] ❌ save-to-afterglow error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ── PATCH /:code/rename ─────────────────────────────────────────────────────
// Mid-party rename: set partyName, convert JustPlay → real party.
router.patch('/:code/rename', requireAuth, async (req, res) => {
  try {
    const { code } = req.params;
    const { partyName } = req.body || {};
    const userId = req.currentUser._id.toString();

    if (!partyName || typeof partyName !== 'string' || partyName.trim().length === 0) {
      return res.status(400).json({ error: 'INVALID_NAME', message: 'partyName is required' });
    }
    if (partyName.trim().length > 100) {
      return res.status(400).json({ error: 'NAME_TOO_LONG', message: 'partyName must be ≤ 100 characters' });
    }

    const party = await Party.findOne({ code });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    // Verify user is host
    if (!party.hostUserId || party.hostUserId.toString() !== userId) {
      return res.status(403).json({ error: 'NOT_HOST', message: 'Only the host can rename the party' });
    }

    party.partyName = partyName.trim();
    party.isJustPlay = false;
    party.savedToAfterglow = true;
    await party.save();

    console.log(`[PartyActions] ✅ Party ${code} renamed to "${partyName.trim()}" + savedToAfterglow by host ${userId}`);
    return res.json({
      ok: true,
      party: {
        code: party.code,
        partyName: party.partyName,
        isJustPlay: party.isJustPlay,
        savedToAfterglow: party.savedToAfterglow
      }
    });
  } catch (err) {
    console.error('[PartyActions] ❌ rename error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ── PATCH /:code/visibility ─────────────────────────────────────────
// ★ V7 feat(privacy): Set party visibility level.
const VALID_VISIBILITY = ['public', 'friends', 'private'];

router.patch('/:code/visibility', requireAuth, async (req, res) => {
  try {
    const { code } = req.params;
    const { visibility } = req.body || {};
    const userId = req.currentUser._id.toString();

    if (!visibility || !VALID_VISIBILITY.includes(visibility)) {
      return res.status(400).json({ error: 'INVALID_VISIBILITY', message: `Must be one of: ${VALID_VISIBILITY.join(', ')}` });
    }

    const party = await Party.findOne({ code });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    if (!party.hostUserId || party.hostUserId.toString() !== userId) {
      return res.status(403).json({ error: 'NOT_HOST', message: 'Only the host can change visibility' });
    }

    party.visibility = visibility;
    await party.save();

    console.log(`[PartyActions] ✅ Party ${code} visibility → ${visibility} by host ${userId}`);
    return res.json({ ok: true, visibility });
  } catch (err) {
    console.error('[PartyActions] ❌ visibility error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
