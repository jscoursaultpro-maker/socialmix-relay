import mongoose from 'mongoose';

const GuestSessionSchema = new mongoose.Schema({
  partyCode:   { type: String, required: true, index: true },
  guestName:   { type: String, default: 'Guest' },
  guestEmoji:  { type: String, default: '🎉' },
  guestPhoto:  { type: String, default: null },
  phone:       { type: String, default: '' },
  email:       { type: String, default: '' },
  instagram:   { type: String, default: '' },
  joinedAt:    { type: Date, default: Date.now },
  leftAt:      { type: Date, default: null },
  totalScore:  { type: Number, default: 0 }
}, { timestamps: false });

export default mongoose.model('GuestSession', GuestSessionSchema);
