import mongoose from 'mongoose';

const MergeBackupSchema = new mongoose.Schema({
  keptPartyCode:     { type: String, required: true, index: true },
  keptPartySnapshot: mongoose.Schema.Types.Mixed,  // Party A pré-merge
  mergedPartyCode:   { type: String, required: true },
  mergedPartySnapshot: mongoose.Schema.Types.Mixed, // Party B pré-merge
  mergedHPHIds:      [mongoose.Schema.Types.ObjectId], // HPH transférés
  mergedPhotoIds:    [mongoose.Schema.Types.ObjectId], // Photos transférées
  hostUserId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  mergedAt:          { type: Date, default: Date.now, index: true },
  expiresAt:         { type: Date, required: true, index: true }
});

// TTL index pour auto-cleanup après 24h
MergeBackupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const MergeBackup = mongoose.model('MergeBackup', MergeBackupSchema);
export default MergeBackup;
