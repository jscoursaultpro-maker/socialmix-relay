import mongoose from 'mongoose';

// ★ A6a — AudioEvent: structured audio pipeline audit trail
// TTL 30 days via MongoDB TTL index on ts field
// Captures crossfade timing, gaps, watchdog triggers, preQueue results
const AudioEventSchema = new mongoose.Schema({
  ts:        { type: Date, default: Date.now },
  partyCode: { type: String, required: true },
  hostId:    { type: String },                          // socket.id or guestId of host
  eventType: {
    type: String,
    required: true,
    enum: [
      'preQueueStarted',
      'preQueueCompleted',
      'preQueueFailed',
      'crossfadeStarted',
      'crossfadeCompleted',
      'crossfadeAborted',
      'gapDetected',
      'watchdogTriggered',
      'trackLoadFailed',
      'other'
    ]
  },
  eventId:   { type: String },                          // UUID from client (idempotency)
  meta:      { type: mongoose.Schema.Types.Mixed }      // Flexible payload per event type
}, { versionKey: false });

// TTL: auto-delete after 30 days
AudioEventSchema.index({ ts: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
// Efficient query by party + date range (primary query pattern for audit endpoint)
AudioEventSchema.index({ partyCode: 1, ts: -1 });

export const AudioEvent = mongoose.model('AudioEvent', AudioEventSchema);
