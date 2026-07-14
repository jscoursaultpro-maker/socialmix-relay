import mongoose from 'mongoose';

const HostPlaybackHistorySchema = new mongoose.Schema({
  hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  trackId: { type: mongoose.Schema.Types.ObjectId, ref: 'Track', required: true, index: true },
  partyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Party', required: true },
  playedAt: { type: Date, default: Date.now, index: true },
  phase: { type: String, enum: ['arrival','ambiance','takeoff','groove','party','closing'] },
  wasSuggestedByGuest: { type: Boolean, default: false }
});

HostPlaybackHistorySchema.index({ hostUserId: 1, trackId: 1, playedAt: -1 });
HostPlaybackHistorySchema.index({ hostUserId: 1, playedAt: -1 });

export default mongoose.model('HostPlaybackHistory', HostPlaybackHistorySchema);
