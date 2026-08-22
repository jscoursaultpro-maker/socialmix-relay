import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import Party from '../models/Party.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function anonymizeEmail(email) {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}***@${domain}`;
}

async function runAudit() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) throw new Error('MONGO_URI or MONGODB_URI env var required');
  await mongoose.connect(MONGO_URI);

  const parties = await Party.find({}, 'code hostProfile createdAt endedAt lifecycle participants');

  let totals = {
    REAL: { parties: 0, guests: 0, emails: 0 },
    DEMO: { parties: 0, guests: 0, emails: 0 },
    TEST: { parties: 0, guests: 0, emails: 0 }
  };

  let results = [];
  let stfbunData = {
    users: [],
    emails: []
  };

  for (const party of parties) {
    const code = party.code || 'UNKNOWN';
    const name = (party.hostProfile && party.hostProfile.name) ? party.hostProfile.name : 'Unknown Host';
    const createdAt = party.createdAt || party._id.getTimestamp();
    
    let lastActivity = createdAt;
    if (party.lifecycle && party.lifecycle.lastActivityAt) {
      lastActivity = new Date(party.lifecycle.lastActivityAt);
    } else if (party.endedAt) {
      lastActivity = new Date(party.endedAt);
    }

    let guestCount = 0;
    let emailCount = 0;
    let ips = new Set();
    
    if (party.participants && Array.isArray(party.participants)) {
      for (const p of party.participants) {
        if (p.isHost) continue;
        guestCount++;
        
        if (p.email && p.email.trim() !== '') emailCount++;
        
        if (p.ip) ips.add(p.ip); // if captured

        // Try to update lastActivity using joinedAt if it's later
        if (p.joinedAt) {
          const jDate = new Date(p.joinedAt);
          if (jDate > lastActivity) lastActivity = jDate;
        }

        if (code === 'STFBUN') {
          stfbunData.users.push({
            userId: p.userId,
            name: p.name,
            emoji: p.emoji,
            email: p.email
          });
          if (p.email && p.email.trim() !== '') {
            stfbunData.emails.push(anonymizeEmail(p.email));
          }
        }
      }
    }

    const durationMinutes = Math.max(0, Math.round((lastActivity.getTime() - createdAt.getTime()) / 60000));
    
    let tag = "TEST";
    if (guestCount >= 5 && durationMinutes >= 60 && emailCount >= 2) {
      tag = "REAL";
    } else if (guestCount >= 2 && durationMinutes >= 30) {
      tag = "DEMO";
    }

    totals[tag].parties++;
    totals[tag].guests += guestCount;
    totals[tag].emails += emailCount;

    results.push({
      code,
      name,
      createdAt: createdAt.toISOString().split('T')[0],
      guestCount,
      emailCount,
      durationMinutes,
      ips: ips.size,
      tag
    });
  }

  results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // --- Print results ---

  console.log("=== TOTALS BY CATEGORY ===");
  console.log(`REAL: ${totals.REAL.parties} parties, ${totals.REAL.guests} guests, ${totals.REAL.emails} emails`);
  console.log(`DEMO: ${totals.DEMO.parties} parties, ${totals.DEMO.guests} guests, ${totals.DEMO.emails} emails`);
  console.log(`TEST: ${totals.TEST.parties} parties, ${totals.TEST.guests} guests, ${totals.TEST.emails} emails`);
  console.log("----------------------------");

  console.log("\n=== REAL / DEMO PARTIES (Sample) ===");
  for (const r of results.filter(x => x.tag !== 'TEST')) {
    console.log(`[${r.tag}] ${r.code} - Host: ${r.name} - Date: ${r.createdAt} - Guests: ${r.guestCount} - Emails: ${r.emailCount} - Duration: ${r.durationMinutes}m`);
  }

  console.log("\n=== STFBUN VALIDATION ===");
  console.log(`Total Stored Guests: ${stfbunData.users.length}`);
  
  let uniqueIds = new Set(stfbunData.users.map(u => u.userId));
  console.log(`Unique UserIds: ${uniqueIds.size}`);
  
  console.log("Emails Anonymized:");
  stfbunData.emails.forEach(e => console.log(" - " + e));

  console.log("\nUsers:");
  stfbunData.users.forEach(u => console.log(` - ${u.name} ${u.emoji || ''} (userId: ${u.userId})`));

  await mongoose.disconnect();
}

runAudit().catch(console.error);
