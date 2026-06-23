import mongoose from 'mongoose';

/**
 * HostPreference schema — Personal host weighting
 * 
 * Phase 3: Each host can boost/ban genres and specific tracks.
 * DJ Brain scoring = global × 0.7 + perso × 0.3
 */
const HostPreferenceSchema = new mongoose.Schema({
  hostId:        { type: String, required: true, unique: true, index: true },
  
  // Genre boost coefficients (genre → multiplier)
  // e.g. { "Electro": 1.5, "Hip-Hop": 0.8 }
  genreBoosts:   { type: Map, of: Number, default: {} },
  
  // ISRCs to always boost in recommendations
  boostedISRCs:  { type: [String], default: [] },
  
  // ISRCs to never recommend (hard exclusion)
  bannedISRCs:   { type: [String], default: [] }
}, {
  timestamps: true
});

export default mongoose.model('HostPreference', HostPreferenceSchema);
