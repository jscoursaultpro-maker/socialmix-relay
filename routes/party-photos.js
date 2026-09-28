/**
 * routes/party-photos.js
 * ★ feat(#39) V1 — Routes photos avec ACL owner/host/state.
 *
 * Règles cadrées Jean-Sé 28/09 :
 * - PENDANT soirée (party.endedAt=null) :
 *   • Host : peut DELETE toute photo de la soirée
 *   • Guest : peut DELETE uniquement sa propre photo (uploaderUserId match)
 * - APRÈS clôture (party.endedAt != null) :
 *   • Suppression bloquée (403) pour tout le monde
 *   • Download ouvert à tous (200, pas de contrôle d'accès lecture)
 *
 * Implémentation :
 * - Soft-delete via Photo.deletedAt (pas Cloudinary hard delete V1)
 * - Photo.uploaderUserId pour l'ACL propriétaire
 * - Broadcast Socket.IO photo:deleted pour refresh temps réel
 * - Party.photos[] embedded cross-marqué (deletedAt) pour cohérence cache
 * - Endpoints lecture filtrent automatiquement deletedAt != null
 *
 * Auth : verifyGuestAuth (supporte Supabase JWT + legacy JWT)
 */

import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';
import Party from '../models/Party.js';
import { Photo } from '../models/Photo.js';

const router = Router();

// ─── DELETE /api/party/:code/photo/:photoId ──────────────────────────────────

router.delete('/:code/photo/:photoId', verifyGuestAuth, async (req, res) => {
  try {
    const code     = (req.params.code || '').toUpperCase();
    const photoId  = req.params.photoId;
    const currentUser = req.user;

    // 1. Party lookup
    const party = await Party.findOne({ code }).lean();
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    // 2. Blocage post-clôture
    if (party.endedAt) {
      return res.status(403).json({
        error: 'PARTY_ENDED',
        message: 'Suppression bloquée après clôture de la soirée'
      });
    }

    // 3. Photo lookup (collection autoritative)
    const photo = await Photo.findById(photoId);
    if (!photo || photo.deletedAt) {
      return res.status(404).json({ error: 'PHOTO_NOT_FOUND' });
    }

    // 4. ACL : owner OR host
    const currentUserId = String(currentUser._id);
    const isOwner = photo.uploaderUserId && String(photo.uploaderUserId) === currentUserId;
    const isHost  = party.hostUserId && String(party.hostUserId) === currentUserId;

    if (!isOwner && !isHost) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Vous ne pouvez supprimer que vos propres photos'
      });
    }

    // 5. Soft-delete (Photo collection)
    photo.deletedAt = new Date();
    photo.deletedBy = currentUserId;
    await photo.save();

    // 6. Cross-marker dans Party.photos[] embedded (cache lecture cohérence)
    const partyDoc = await Party.findOne({ code });
    if (partyDoc) {
      let embeddedPatched = false;
      // Match par _id (si présent dans embedded) ou par url (fallback)
      if (partyDoc.photos && partyDoc.photos.length > 0) {
        for (let i = 0; i < partyDoc.photos.length; i++) {
          const ep = partyDoc.photos[i];
          const epId = ep._id ? String(ep._id) : null;
          const photoDocId = String(photo._id);
          if (epId === photoDocId || ep.id === photoDocId || ep.url === photo.url) {
            partyDoc.photos[i].deletedAt = photo.deletedAt;
            embeddedPatched = true;
            break;
          }
        }
      }
      if (embeddedPatched) {
        partyDoc.markModified('photos');
        await partyDoc.save();
      }
    }

    // 7. Broadcast Socket.IO photo:deleted pour refresh temps réel
    const io = req.app.get('io');
    if (io) {
      const payload = {
        photoId:    String(photo._id),
        deletedBy:  currentUserId,
        isHostAction: isHost && !isOwner,
        deletedAt:  photo.deletedAt
      };
      io.to(code).emit('photo:deleted', payload);
      io.to(`host:${code}`).emit('photo:deleted', payload);
      io.to(`guest:${code}`).emit('photo:deleted', payload);
    }

    console.log(`📸 [${code}] photo:deleted soft — ${photo._id} by ${isHost && !isOwner ? 'HOST' : 'owner'} ${currentUserId}`);
    res.json({ ok: true, photoId: String(photo._id), deletedAt: photo.deletedAt });

  } catch (err) {
    console.error('[party-photos] ❌ DELETE error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ─── GET /api/party/:code/photos ─────────────────────────────────────────────
// Retourne les photos non supprimées. Pendant soirée = soirée ouverte,
// après clôture = accès ouvert à tous (download libre).

router.get('/:code/photos', verifyGuestAuth, async (req, res) => {
  try {
    const code = (req.params.code || '').toUpperCase();

    // Trouver la party (ended ou non)
    const party = await Party.findOne({ code }, { endedAt: 1, hostUserId: 1 }).lean();
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    // Photos non supprimées, triées par sentAt
    const photos = await Photo.find(
      { partyCode: code, deletedAt: null },
      { url: 1, guestName: 1, guestId: 1, uploaderUserId: 1, caption: 1, sentAt: 1, publicId: 1 }
    ).sort({ sentAt: 1 }).lean();

    const currentUserId = String(req.user._id);
    const isHost = party.hostUserId && String(party.hostUserId) === currentUserId;
    const isEnded = !!party.endedAt;

    // Enrichir chaque photo avec canDelete (permission du caller)
    const enriched = photos.map(p => ({
      id:             String(p._id),
      url:            p.url,
      guestName:      p.guestName,
      uploaderUserId: p.uploaderUserId || null,
      caption:        p.caption || null,
      sentAt:         p.sentAt,
      // Peut-il supprimer ? (owner OU host, ET soirée ouverte)
      canDelete: !isEnded && (
        isHost ||
        (p.uploaderUserId && String(p.uploaderUserId) === currentUserId)
      )
    }));

    res.json({
      photos:   enriched,
      count:    enriched.length,
      isEnded,
      // Après clôture : download ouvert pour tous
      downloadOpen: isEnded
    });

  } catch (err) {
    console.error('[party-photos] ❌ GET error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
