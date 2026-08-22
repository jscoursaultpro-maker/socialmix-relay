import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import Party from '../models/Party.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runAudit() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) throw new Error('MONGO_URI or MONGODB_URI env var required');
  await mongoose.connect(MONGO_URI);

  let totalGuests = 0;
  let guestsWithUserId = 0;
  let guestsWithSessionToken = 0;

  const parties = await Party.find({}, 'code participants');
  
  for (const party of parties) {
    if (party.participants && Array.isArray(party.participants)) {
      for (const p of party.participants) {
        if (p.isHost) continue;
        totalGuests++;
        if (p.userId) guestsWithUserId++;
        if (p.sessionToken) guestsWithSessionToken++;
      }
    }
  }

  console.log(`Total Guest Sessions: ${totalGuests}`);
  console.log(`With userId: ${guestsWithUserId}`);
  console.log(`With sessionToken: ${guestsWithSessionToken}`);

  await mongoose.disconnect();
}

runAudit().catch(console.error);
