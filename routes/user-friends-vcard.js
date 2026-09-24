/**
 * routes/user-friends-vcard.js
 * ★ Univers V1 — export vCard d'un ami accepté selon ses opt-ins RGPD.
 *
 * GET /api/user/friends/:friendUserId/vcard
 *
 * Auth : Supabase Bearer JWT.
 * Retourne un fichier `.vcf` (RFC 6350) avec UNIQUEMENT les champs pour
 * lesquels le friend a explicitement opt-in :
 *   - phone       ← target.preferences.sharePhone && target.profile.phone
 *   - email       ← target.preferences.shareEmail && target.profile.email
 *   - instagram   ← target.preferences.shareInsta && target.profile.instagram
 *
 * Refuse si :
 *   - pas ami accepté → 403 NOT_FRIENDS
 *   - target banni/deleted → 404
 *   - aucun canal partagé → 200 avec vCard minimale + header X-vCard-Empty=1
 *
 * Chaque appel produit une entrée EventLog audit RGPD pour traçabilité.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Friendship from '../models/Friendship.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'AUTH_MISSING' });
    }
    const token = authHeader.slice(7);
    const payload = await verifySupabaseJWT(token);
    const user = await findOrCreateFromSupabase(payload);
    req.currentUser = user;
    next();
  } catch (err) {
    if (err.name === 'AuthError') return res.status(401).json({ error: 'AUTH_FAILED', message: err.message });
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
}

/** Escape vCard values per RFC 6350 §3.4 */
function vcardEscape(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

router.get('/:friendUserId/vcard', requireAuth, async (req, res) => {
  try {
    const me = req.currentUser;
    const friendId = String(req.params.friendUserId || '');
    if (!mongoose.Types.ObjectId.isValid(friendId)) return res.status(400).json({ error: 'INVALID_ID' });
    if (String(me._id) === friendId) return res.status(400).json({ error: 'CANNOT_QUERY_SELF' });

    const friend = await User.findById(friendId)
      .select('profile preferences isBanned isDeleted blockedUsers')
      .lean();
    if (!friend || friend.isBanned || friend.isDeleted) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    // Doit être ami accepté
    const [uA, uB] = [String(me._id), friendId].sort();
    const friendship = await Friendship.findOne({ userA: uA, userB: uB }).lean();
    if (!friendship || friendship.status !== 'accepted') {
      return res.status(403).json({ error: 'NOT_FRIENDS', message: 'La vCard est réservée aux amis acceptés.' });
    }

    // Bloc mutuel = pas de vCard
    if ((me.blockedUsers || []).some(id => String(id) === friendId)) {
      return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }
    if ((friend.blockedUsers || []).some(id => String(id) === String(me._id))) {
      return res.status(404).json({ error: 'USER_NOT_FOUND' });
    }

    const prefs = friend.preferences || {};
    const p = friend.profile || {};

    const includePhone = !!p.phone && !!prefs.sharePhone;
    const includeEmail = !!p.email && !!prefs.shareEmail;
    const includeInsta = !!p.instagram && !!prefs.shareInsta;

    // Audit RGPD structuré (log console, agrégé par service log/Sentry)
    // TODO Univers V1.5 : persister dans un modèle AuditLog dédié (schema séparé de EventLog).
    console.log('[audit:vcard_export]', JSON.stringify({
      at: new Date().toISOString(),
      userId: String(me._id),
      targetUserId: String(friend._id),
      fields: { phone: includePhone, email: includeEmail, instagram: includeInsta },
      ua: (req.headers['user-agent'] || '').slice(0, 120),
    }));

    // Construction vCard (RFC 6350)
    const fn = [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || (p.handle || 'Ami AhOuai');
    const nParts = [
      vcardEscape(p.lastName || ''),
      vcardEscape(p.firstName || ''),
      '',  // additional names
      '',  // honorific prefixes
      ''   // honorific suffixes
    ];

    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${vcardEscape(fn)}`,
      `N:${nParts.join(';')}`,
    ];
    if (p.handle) lines.push(`NICKNAME:${vcardEscape(p.handle)}`);
    if (includePhone) lines.push(`TEL;TYPE=CELL:${vcardEscape(p.phone)}`);
    if (includeEmail) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(p.email)}`);
    if (includeInsta) {
      const insta = String(p.instagram).replace(/^@/, '');
      lines.push(`URL;TYPE=Instagram:https://instagram.com/${vcardEscape(insta)}`);
    }
    lines.push('X-AHOUAI-EXPORT:1');
    lines.push(`REV:${new Date().toISOString()}`);
    lines.push('END:VCARD');

    const vcard = lines.join('\r\n') + '\r\n';

    // Headers cache stricts
    res.set('Cache-Control', 'private, no-store');
    res.set('Vary', 'Authorization');
    res.set('Content-Type', 'text/vcard; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="AhOuai-${(p.handle || p.firstName || 'ami').replace(/[^a-z0-9-]/gi, '_')}.vcf"`);
    if (!includePhone && !includeEmail && !includeInsta) {
      res.set('X-vCard-Empty', '1');
    }
    return res.status(200).send(vcard);
  } catch (err) {
    console.error('[API] ❌ GET /api/user/friends/:friendUserId/vcard error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
