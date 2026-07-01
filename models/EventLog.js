import mongoose from 'mongoose';

// ★ A3c — EventLog: structured audit trail per socket event
// TTL 30 days via MongoDB TTL index on ts field
const EventLogSchema = new mongoose.Schema({
  ts:        { type: Date, default: Date.now },
  partyCode: { type: String, required: true, index: true },
  eventType: { type: String, required: true },       // 'vote' | 'suggest' | 'photo' | 'genreVote'
  eventId:   { type: String },                       // UUID from client (may be absent for legacy)
  guestId:   { type: String },                       // No PII — just ID
  decision:  { type: String, enum: ['accepted', 'duplicate', 'rejected'], default: 'accepted' },
  latencyMs: { type: Number }                        // Server processing time (reserved)
}, { versionKey: false });

// TTL: auto-delete after 30 days
EventLogSchema.index({ ts: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
// Efficient query by party + date range
EventLogSchema.index({ partyCode: 1, ts: 1 });

export const EventLog = mongoose.model('EventLog', EventLogSchema);
