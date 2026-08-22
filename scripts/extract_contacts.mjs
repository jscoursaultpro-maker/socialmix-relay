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

  const parties = await Party.find({}, 'code hostProfile participants');
  
  let contacts = [];

  for (const party of parties) {
    if (party.participants && Array.isArray(party.participants)) {
      for (const p of party.participants) {
        if (p.isHost) continue;
        
        const hasEmail = p.email && p.email.trim() !== '';
        const hasPhone = p.phone && p.phone.trim() !== '';
        
        if (hasEmail || hasPhone) {
          contacts.push({
            partyCode: party.code,
            userId: p.userId || 'Unknown',
            name: p.name || 'Anonymous',
            emoji: p.emoji || '👤',
            email: hasEmail ? p.email.trim() : '-',
            phone: hasPhone ? p.phone.trim() : '-'
          });
        }
      }
    }
  }

  // Remove exact duplicates based on userId
  const uniqueContacts = [];
  const seenIds = new Set();
  for (const c of contacts) {
    if (!seenIds.has(c.userId)) {
      seenIds.add(c.userId);
      uniqueContacts.push(c);
    }
  }

  console.log(`Found ${uniqueContacts.length} unique contacts.\n`);
  
  console.log("| Nom | Email | Téléphone | Party | UserId |");
  console.log("| :--- | :--- | :--- | :--- | :--- |");
  for (const c of uniqueContacts) {
    console.log(`| ${c.name} ${c.emoji} | ${c.email} | ${c.phone} | ${c.partyCode} | \`${c.userId}\` |`);
  }

  await mongoose.disconnect();
}

runAudit().catch(console.error);
