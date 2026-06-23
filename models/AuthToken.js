import mongoose from 'mongoose';

const authTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  email: { type: String, lowercase: true, trim: true }, // For magic links
  token: { type: String, required: true, index: true },
  type: { type: String, enum: ['magic_link', 'refresh'], required: true },
  expiresAt: { type: Date, required: true }
});

// TTL index to automatically remove expired tokens
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('AuthToken', authTokenSchema);
