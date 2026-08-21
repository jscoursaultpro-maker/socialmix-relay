/**
 * routes/user-crews.js
 * ★ B2.2: GET /api/user/crews — Auto-detected crews via participant co-occurrence
 */
import { Router } from 'express';
import Party from '../models/Party.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

// Middleware: extract authenticated user from JWT
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

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const currentUser = req.currentUser;
    
    // Fetch all hosted parties
    const rawParties = await Party.find({ hostUserId: currentUser._id, endedAt: { $ne: null } })
      .select('_id code participants.guestName participants.email participants.guestEmoji endedAt')
      .sort({ endedAt: -1 }) // Sort latest first to help with lastSeenTogether
      .lean();
    
    const pairCounts = new Map();
    const emailToProfile = new Map();
    const partyCodesPerGuest = new Map();
    const partyCodeToDate = new Map();

    for (const p of rawParties) {
      if (p.endedAt) partyCodeToDate.set(p.code, new Date(p.endedAt));
      const guests = (p.participants || []).filter(g => g.email && !g.isHost);
      
      for (let i = 0; i < guests.length; i++) {
        const g1 = guests[i];
        if (!emailToProfile.has(g1.email)) emailToProfile.set(g1.email, g1);
        
        if (!partyCodesPerGuest.has(g1.email)) partyCodesPerGuest.set(g1.email, new Set());
        partyCodesPerGuest.get(g1.email).add(p.code);
        
        for (let j = i + 1; j < guests.length; j++) {
          const g2 = guests[j];
          const sorted = [g1.email, g2.email].sort();
          const pairKey = sorted[0] + '::' + sorted[1];
          pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
        }
      }
    }

    // Filter pairs with >= 2 co-occurrences
    const edges = [];
    for (const [key, count] of pairCounts.entries()) {
      if (count >= 2) {
        const [e1, e2] = key.split('::');
        edges.push([e1, e2]);
      }
    }

    // Union-Find
    const parent = new Map();
    const find = (i) => {
      if (!parent.has(i)) parent.set(i, i);
      if (parent.get(i) !== i) parent.set(i, find(parent.get(i)));
      return parent.get(i);
    };
    const union = (i, j) => {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) parent.set(rootI, rootJ);
    };

    for (const [u, v] of edges) {
      union(u, v);
    }

    // Form clusters
    const clustersMap = new Map();
    for (const email of parent.keys()) {
      const root = find(email);
      if (!clustersMap.has(root)) clustersMap.set(root, []);
      clustersMap.get(root).push(email);
    }

    // Build Crews
    let crews = [];
    for (const [root, members] of clustersMap.entries()) {
      if (members.length < 2) continue; // Safety check
      
      const sortedMembers = members.sort();
      const id = Buffer.from(sortedMembers.join(',')).toString('base64');
      
      let shared = null;
      for (const m of sortedMembers) {
        const set = partyCodesPerGuest.get(m) || new Set();
        if (!shared) {
          shared = new Set(set);
        } else {
          shared = new Set([...shared].filter(x => set.has(x)));
        }
      }
      
      // Determine lastSeenTogether
      let lastSeen = null;
      for (const code of shared) {
        const date = partyCodeToDate.get(code);
        if (date && (!lastSeen || date > lastSeen)) {
          lastSeen = date;
        }
      }
      
      const memberObjs = sortedMembers.map(email => {
        const prof = emailToProfile.get(email);
        return {
          name: prof.guestName,
          email: email,
          emoji: prof.guestEmoji || '🎉',
          count: (partyCodesPerGuest.get(email) || new Set()).size
        };
      });
      
      crews.push({
        id,
        members: memberObjs,
        sharedPartiesCount: shared.size,
        lastSeenTogether: lastSeen,
        topGenre: null // TODO V1.1 exact genre query
      });
    }

    // Sort by sharedPartiesCount desc
    crews.sort((a, b) => b.sharedPartiesCount - a.sharedPartiesCount);
    const topCrews = crews.slice(0, 10);
    
    res.json({
      crews: topCrews,
      totalCrewsDetected: crews.length
    });

  } catch (err) {
    console.error('[API] ❌ GET /api/user/crews error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
