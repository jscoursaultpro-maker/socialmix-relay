import mongoose from 'mongoose';

const PhotoSchema = new mongoose.Schema({
  partyCode:     { type: String, required: true, index: true },
  guestName:     { type: String, required: true },
  guestId:       { type: String, required: true },
  guestEmoji:    { type: String, default: '' },
  url:           { type: String, required: true },  // Cloudinary URL
  publicId:      { type: String, default: '' },     // Pour suppression Cloudinary
  width:         { type: Number, default: 0 },
  height:        { type: Number, default: 0 },
  sizeKB:        { type: Number, default: 0 },
  caption:       { type: String, default: '', maxlength: 280 },
  sentAt:        { type: Date, default: Date.now },
  takenAt:       { type: Date, default: Date.now },  // si EXIF
  uploadSource:  { type: String, enum: ['live', 'library', 'host'], default: 'live' },
  isCover:       { type: Boolean, default: false }, // si désignée cover
  deletedAt:     { type: Date, default: null }       // soft delete (RGPD)
}, { timestamps: true });

// Index composé pour queries AfterGlow
PhotoSchema.index({ partyCode: 1, sentAt: -1 });
PhotoSchema.index({ partyCode: 1, deletedAt: 1 });

export const Photo = mongoose.model('Photo', PhotoSchema);
