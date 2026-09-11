import mongoose from 'mongoose';

const foundersIntentSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true 
  },
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    default: null 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  source: { 
    type: String, 
    default: 'iOS-V7' 
  },
  userAgent: { 
    type: String, 
    default: null 
  },
  ipHash: { 
    type: String, 
    default: null 
  }
});

// Create index
foundersIntentSchema.index({ email: 1 }, { unique: true });

const FoundersIntent = mongoose.models.FoundersIntent || mongoose.model('FoundersIntent', foundersIntentSchema, 'foundersIntent');
export default FoundersIntent;
