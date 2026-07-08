import mongoose from 'mongoose';

// ★ fix(#21 RGPD) — GuestSession enrichi avec email obligatoire, consentement, IP, userAgent
// Permet le droit à l'oubli (art. 17 RGPD) via DELETE /api/guest/data

const GuestSessionSchema = new mongoose.Schema({
  partyCode:          { type: String, required: true, index: true },
  guestName:          { type: String, required: true },
  lastName:           { type: String, default: '' },
  alias:              { type: String, default: '' },
  guestEmoji:         { type: String, default: '🎉' },
  guestPhoto:         { type: String, default: null },
  phone:              { type: String, default: '' },
  email:              { type: String, required: true, index: true },
  instagram:          { type: String, default: '' },
  // RGPD consent fields
  consentVersion:     { type: String, default: '1.0' },
  consentAcceptedAt:  { type: Date, required: true },
  // Audit trail
  ipAddress:          { type: String, default: null },
  userAgent:          { type: String, default: null },
  socketId:           { type: String, default: null },
  userId:             { type: String, default: null },
  sessionToken:       { type: String, default: null },
  // Legacy fields preserved
  joinedAt:           { type: Date, default: Date.now },
  leftAt:             { type: Date, default: null },
  totalScore:         { type: Number, default: 0 }
}, { timestamps: false });

export default mongoose.model('GuestSession', GuestSessionSchema);
