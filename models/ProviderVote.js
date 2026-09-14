import mongoose from 'mongoose';
const { Schema } = mongoose;

// Singleton document for global provider vote counts.
// _id is always 'counts' — single document, upserted on first vote.
const providerVoteSchema = new Schema({
  _id: { type: String, default: 'counts' },
  deezer: { type: Number, default: 0 },
  qobuz: { type: Number, default: 0 },
  tidal: { type: Number, default: 0 }
}, {
  timestamps: true,
  collection: 'provider_votes'
});

// Static helper to get current counts
providerVoteSchema.statics.getCounts = async function () {
  const doc = await this.findById('counts');
  if (!doc) return { deezer: 0, qobuz: 0, tidal: 0 };
  return {
    deezer: doc.deezer || 0,
    qobuz: doc.qobuz || 0,
    tidal: doc.tidal || 0
  };
};

export default mongoose.model('ProviderVote', providerVoteSchema);
