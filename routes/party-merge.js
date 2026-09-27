import { Router } from 'express';
import mongoose from 'mongoose';
import Party from '../models/Party.js';
import MergeBackup from '../models/MergeBackup.js';
import { EventLog } from '../models/EventLog.js';
import HostPlaybackHistory from '../models/HostPlaybackHistory.js';
import { Photo } from '../models/Photo.js';
import { verifyGuestAuth } from '../middleware/authGuest.js';

const router = Router();

// POST /api/host/parties/:keptCode/merge
router.post('/:keptCode/merge', verifyGuestAuth, async (req, res) => {
  let session = null;
  try {
    const keptCodeParam = req.params.keptCode.toUpperCase();
    const mergedCodeParam = req.body.mergedCode?.toUpperCase();

    if (!mergedCodeParam) {
      return res.status(400).json({ error: 'MISSING_MERGED_CODE' });
    }
    if (keptCodeParam === mergedCodeParam) {
      return res.status(400).json({ error: 'CANNOT_MERGE_WITH_SELF' });
    }

    let keptParty = await Party.findOne({ code: keptCodeParam });
    let mergedParty = await Party.findOne({ code: mergedCodeParam });

    if (!keptParty || !mergedParty) {
      return res.status(404).json({ error: 'PARTY_NOT_FOUND' });
    }

    if (!keptParty.hostUserId.equals(req.user._id)) {
      return res.status(403).json({ error: 'FORBIDDEN_NOT_HOST' });
    }
    if (!mergedParty.hostUserId.equals(req.user._id)) {
      return res.status(403).json({ error: 'FORBIDDEN_CROSS_HOST_MERGE' });
    }

    if (keptParty.mergedInto || mergedParty.mergedInto) {
      return res.status(400).json({ error: 'ALREADY_MERGED' });
    }

    // Ordre chronologique: la plus vieille doit être "kept"
    if (mergedParty.createdAt < keptParty.createdAt) {
      const temp = keptParty;
      keptParty = mergedParty;
      mergedParty = temp;
    }

    const keptCode = keptParty.code;
    const mergedCode = mergedParty.code;

    // We start a transaction if supported, else normal flow.
    // Assuming replica set is configured since it's production Mongo Atlas,
    // but we can wrap it gracefully.
    session = await mongoose.startSession();
    session.startTransaction();

    const backup = await MergeBackup.create([{
      keptPartyCode: keptCode,
      keptPartySnapshot: keptParty.toObject(),
      mergedPartyCode: mergedCode,
      mergedPartySnapshot: mergedParty.toObject(),
      mergedHPHIds: [],
      mergedPhotoIds: [],
      hostUserId: req.user._id,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
    }], { session });
    const backupDoc = backup[0];

    // Transfer HPH
    const hphDocs = await HostPlaybackHistory.find({ partyId: mergedParty._id }).session(session);
    const hphIds = hphDocs.map(d => d._id);
    if (hphIds.length > 0) {
      await HostPlaybackHistory.updateMany({ _id: { $in: hphIds } }, { partyId: keptParty._id, partyCode: keptCode }, { session });
      backupDoc.mergedHPHIds = hphIds;
    }

    // Transfer Photos
    const photoDocs = await Photo.find({ partyCode: mergedCode }).session(session);
    const photoIds = photoDocs.map(d => d._id);
    if (photoIds.length > 0) {
      await Photo.updateMany({ _id: { $in: photoIds } }, { partyCode: keptCode }, { session });
      backupDoc.mergedPhotoIds = photoIds;
    }

    await backupDoc.save({ session });

    // Merge Participants (union with dedup by userId or email->name)
    const participantsMap = new Map();
    for (const p of keptParty.participants || []) {
      const key = p.userId ? p.userId.toString() : (p.email || p.firstName?.toLowerCase() || Math.random().toString());
      participantsMap.set(key, p);
    }
    let participantsAdded = 0;
    for (const p of mergedParty.participants || []) {
      const key = p.userId ? p.userId.toString() : (p.email || p.firstName?.toLowerCase() || Math.random().toString());
      if (!participantsMap.has(key)) {
        participantsMap.set(key, p);
        participantsAdded++;
      }
    }
    keptParty.participants = Array.from(participantsMap.values());
    keptParty.participantCount = keptParty.participants.length;

    // Merge trackHistory
    const allTracks = [...(keptParty.trackHistory || []), ...(mergedParty.trackHistory || [])];
    allTracks.sort((a, b) => new Date(a.playedAt || 0) - new Date(b.playedAt || 0));
    keptParty.trackHistory = allTracks;
    keptParty.trackCount = allTracks.length;

    // Merge suggestions
    const allSugg = [...(keptParty.suggestions || []), ...(mergedParty.suggestions || [])];
    keptParty.suggestions = allSugg;

    // Merge messages
    const allMsg = [...(keptParty.messages || []), ...(mergedParty.messages || [])];
    allMsg.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    keptParty.messages = allMsg;

    // Merge photos in Party doc
    const allPhotos = [...(keptParty.photos || []), ...(mergedParty.photos || [])];
    allPhotos.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    keptParty.photos = allPhotos;
    keptParty.photoCount = allPhotos.length;

    // Update keptParty endedAt
    const keptEnd = keptParty.endedAt ? new Date(keptParty.endedAt).getTime() : 0;
    const mergedEnd = mergedParty.endedAt ? new Date(mergedParty.endedAt).getTime() : 0;
    const maxEnd = Math.max(keptEnd, mergedEnd);
    if (maxEnd > 0) {
      keptParty.endedAt = new Date(maxEnd);
    }

    mergedParty.mergedInto = keptCode;
    mergedParty.endedAt = mergedParty.endedAt || new Date();
    mergedParty.lifecycle.status = 'merged';

    await keptParty.save({ session });
    await mergedParty.save({ session });

    await EventLog.create([{
      eventType: 'party.merged',
      partyCode: keptCode,
      guestId: req.user._id.toString()
    }], { session });

    await session.commitTransaction();
    session.endSession();

    // Emits
    const io = req.app.get('io');
    if (io) {
      io.to(`host:${keptCode}`).emit('party:merged', { keptCode, mergedCode });
      io.to(`host:${mergedCode}`).emit('party:merged', { keptCode, mergedCode });
    }

    res.json({
      ok: true,
      keptParty,
      mergedParty: { code: mergedParty.code, mergedInto: mergedParty.mergedInto, endedAt: mergedParty.endedAt },
      mergeBackupId: backupDoc._id,
      unmergeAvailableUntil: backupDoc.expiresAt,
      stats: { hphMoved: hphIds.length, photosMoved: photoIds.length, participantsAdded }
    });

  } catch (err) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error('[PartyMerge] Error:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/host/parties/:code/unmerge
router.post('/:code/unmerge', verifyGuestAuth, async (req, res) => {
  let session = null;
  try {
    const code = req.params.code.toUpperCase();
    
    const backup = await MergeBackup.findOne({ keptPartyCode: code, hostUserId: req.user._id });
    if (!backup) {
      return res.status(404).json({ error: 'NO_MERGE_TO_UNDO' });
    }

    if (new Date() > backup.expiresAt) {
      return res.status(400).json({ error: 'UNMERGE_WINDOW_EXPIRED' });
    }

    session = await mongoose.startSession();
    session.startTransaction();

    let keptParty = await Party.findOne({ code }).session(session);
    let mergedParty = await Party.findOne({ code: backup.mergedPartyCode }).session(session);

    if (keptParty) {
      // Restore from snapshot
      const snapshot = backup.keptPartySnapshot;
      delete snapshot._id; // avoid immutable field error if needed
      await Party.updateOne({ _id: keptParty._id }, { $set: snapshot }, { session });
      keptParty = await Party.findById(keptParty._id).session(session);
    }
    
    if (mergedParty) {
      const snapshot = backup.mergedPartySnapshot;
      delete snapshot._id;
      await Party.updateOne({ _id: mergedParty._id }, { $set: snapshot }, { session });
      mergedParty = await Party.findById(mergedParty._id).session(session);
    }

    if (backup.mergedHPHIds && backup.mergedHPHIds.length > 0) {
      await HostPlaybackHistory.updateMany({ _id: { $in: backup.mergedHPHIds } }, { partyId: mergedParty._id, partyCode: mergedParty.code }, { session });
    }

    if (backup.mergedPhotoIds && backup.mergedPhotoIds.length > 0) {
      await Photo.updateMany({ _id: { $in: backup.mergedPhotoIds } }, { partyCode: mergedParty.code }, { session });
    }

    await EventLog.create([{
      eventType: 'party.unmerged',
      partyCode: code,
      guestId: req.user._id.toString()
    }], { session });

    await MergeBackup.deleteOne({ _id: backup._id }).session(session);

    await session.commitTransaction();
    session.endSession();

    // Emits
    const io = req.app.get('io');
    if (io) {
      io.to(`host:${keptParty.code}`).emit('party:unmerged', { keptCode: keptParty.code, restoredMergedCode: mergedParty.code });
      io.to(`host:${mergedParty.code}`).emit('party:unmerged', { keptCode: keptParty.code, restoredMergedCode: mergedParty.code });
    }

    res.json({
      ok: true,
      keptParty,
      mergedParty,
      unmergedAt: new Date()
    });

  } catch (err) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error('[PartyUnmerge] Error:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
