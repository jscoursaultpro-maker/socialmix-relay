import { Router } from 'express';
import Party from '../models/Party.js';
import { Photo } from '../models/Photo.js';

const router = Router();

// PATCH /api/party/:code/settings
router.patch('/:code/settings', async (req, res) => {
  try {
    const { code } = req.params;
    const { hostSecret, photosEnabled, messagesEnabled, diapoEnabled } = req.body || {};

    if (!hostSecret) return res.status(401).json({ error: 'MISSING_HOST_SECRET' });

    const party = await Party.findOne({ code, endedAt: null });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    if (party.hostSecret !== hostSecret) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid host secret' });
    }

    if (!party.settings) party.settings = {};

    let modified = false;
    if (typeof photosEnabled === 'boolean') {
      party.settings.photosEnabled = photosEnabled;
      modified = true;
    }
    if (typeof messagesEnabled === 'boolean') {
      party.settings.messagesEnabled = messagesEnabled;
      modified = true;
    }
    if (typeof diapoEnabled === 'boolean') {
      party.settings.diapoEnabled = diapoEnabled;
      modified = true;
    }

    if (modified) {
      // Force Mongoose to mark the path as modified (due to minimize: false and Mixed types, though settings is strictly typed now)
      party.markModified('settings');
      await party.save();

      const io = req.app.get('io');
      if (io) {
        // Emit socket to all party participants (host and guests)
        io.to(code).emit('party:settingsUpdated', party.settings);
      }
    }

    res.json(party.settings);
  } catch (err) {
    console.error(`PATCH /api/party/:code/settings error:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// PATCH /api/party/:code/cover-photo
router.patch('/:code/cover-photo', async (req, res) => {
  try {
    const { code } = req.params;
    const { hostSecret, photoId } = req.body || {};

    if (!hostSecret) return res.status(401).json({ error: 'MISSING_HOST_SECRET' });

    const party = await Party.findOne({ code, endedAt: null });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    if (party.hostSecret !== hostSecret) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid host secret' });
    }

    if (photoId !== undefined) {
      if (photoId === null) {
        party.coverPhotoId = null;
      } else {
        // Verify photo belongs to this party
        const photo = await Photo.findOne({ _id: photoId, partyCode: code, deletedAt: null });
        if (!photo) {
          return res.status(400).json({ error: 'PHOTO_NOT_FOUND', message: 'Photo not found or does not belong to this party' });
        }
        party.coverPhotoId = photo._id;
      }
      
      await party.save();

      const io = req.app.get('io');
      if (io) {
        // Emit socket to all party participants (host and guests)
        io.to(code).emit('party:coverPhotoUpdated', { coverPhotoId: party.coverPhotoId });
      }
    }

    res.json({ coverPhotoId: party.coverPhotoId });
  } catch (err) {
    console.error(`PATCH /api/party/:code/cover-photo error:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// GET /api/party/:code/settings
router.get('/:code/settings', async (req, res) => {
  try {
    const { code } = req.params;

    const party = await Party.findOne({ code, endedAt: null });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    // Ensure settings are calculated if null
    let settings = party.settings || {};
    const isPrivate = party.visibility === 'private';
    
    // We return calculated values on the fly if they are strictly null
    const result = {
      photosEnabled: settings.photosEnabled !== null && settings.photosEnabled !== undefined ? settings.photosEnabled : isPrivate,
      messagesEnabled: settings.messagesEnabled !== null && settings.messagesEnabled !== undefined ? settings.messagesEnabled : isPrivate,
      diapoEnabled: settings.diapoEnabled !== null && settings.diapoEnabled !== undefined ? settings.diapoEnabled : isPrivate
    };

    res.json({
      settings: result,
      coverPhotoId: party.coverPhotoId
    });
  } catch (err) {
    console.error(`GET /api/party/:code/settings error:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// PATCH /api/party/:code/afterglow-visibility
router.patch('/:code/afterglow-visibility', async (req, res) => {
  try {
    const { code } = req.params;
    const { hostSecret, afterglowVisibility } = req.body || {};

    if (!hostSecret) return res.status(401).json({ error: 'MISSING_HOST_SECRET' });
    
    // We allow patching afterglow visibility even for ended parties
    const party = await Party.findOne({ code });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    if (party.hostSecret !== hostSecret) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid host secret' });
    }

    if (!['invisible', 'private', 'friends', 'public'].includes(afterglowVisibility)) {
      return res.status(400).json({ error: 'INVALID_VISIBILITY' });
    }

    party.afterglowVisibility = afterglowVisibility;
    await party.save();

    const io = req.app.get('io');
    if (io) {
      io.to(code).emit('party:afterglowVisibilityUpdated', party.afterglowVisibility);
    }

    res.json({ success: true, afterglowVisibility: party.afterglowVisibility });
  } catch (err) {
    console.error(`PATCH /api/party/:code/afterglow-visibility error:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// PATCH /api/party/:code/afterglow-saved
router.patch('/:code/afterglow-saved', async (req, res) => {
  try {
    const { code } = req.params;
    const { hostSecret, afterglowSaved } = req.body || {};

    if (!hostSecret) return res.status(401).json({ error: 'MISSING_HOST_SECRET' });
    
    const party = await Party.findOne({ code });
    if (!party) return res.status(404).json({ error: 'PARTY_NOT_FOUND' });

    if (party.hostSecret !== hostSecret) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid host secret' });
    }

    if (typeof afterglowSaved !== 'boolean') {
      return res.status(400).json({ error: 'INVALID_SAVED_FLAG' });
    }

    party.afterglowSaved = afterglowSaved;
    await party.save();

    res.json({ success: true, afterglowSaved: party.afterglowSaved });
  } catch (err) {
    console.error(`PATCH /api/party/:code/afterglow-saved error:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
