import mongoose from 'mongoose';

const FriendshipSchema = new mongoose.Schema({
  // ★ Bug E-fix-3 — _id String pour matcher les IDs business "fr_XXX_YYY" générés in-memory
  _id:          { type: String, required: true },
  userA:        { type: String, required: true },       // userId (alphabetically smaller)
  userB:        { type: String, required: true },       // userId (alphabetically larger)
  status:       { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  requestedBy:  { type: String, required: true },       // userId of the initiator
  metAt:        { type: String, default: null },        // partyCode where they met (optional)
  createdAt:    { type: Date, default: Date.now },
  acceptedAt:   { type: Date, default: null }
}, { _id: false });

// Unique pair — userA < userB enforced by application code
FriendshipSchema.index({ userA: 1, userB: 1 }, { unique: true });
// Fast lookup for a user's friends
FriendshipSchema.index({ userA: 1, status: 1 });
FriendshipSchema.index({ userB: 1, status: 1 });

export default mongoose.model('Friendship', FriendshipSchema);
