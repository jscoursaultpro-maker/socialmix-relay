import mongoose from 'mongoose';
import Party from '../models/Party.js';
import User from '../models/User.js';
import crypto from 'crypto';

const DRY_RUN = process.argv.includes('--dry-run');
const ROLLBACK = process.argv.includes('--rollback');

async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI or MONGO_URI env var required');
  await mongoose.connect(uri);
  console.log('📦 Connecté à MongoDB');
}

async function rollback() {
  console.log('🔄 Démarrage du ROLLBACK...' + (DRY_RUN ? ' (DRY-RUN)' : ''));
  if (DRY_RUN) {
    const count = await User.countDocuments({ isMigrated: true });
    console.log(`[DRY-RUN] ${count} users à supprimer.`);
    return;
  }
  const result = await User.deleteMany({ isMigrated: true });
  console.log(`✅ ROLLBACK terminé. ${result.deletedCount} users supprimés.`);
}

function isValidEmail(email) {
  return email && typeof email === 'string' && email.includes('@') && email.length > 5;
}

function cleanFirstName(raw) {
  if (!raw || typeof raw !== 'string') return 'Guest';
  return raw
    .trim()
    .replace(/\s+/g, ' ')        // collapse whitespace
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

async function migrate() {
  console.log('🚀 Démarrage de la MIGRATION RÉTROACTIVE' + (DRY_RUN ? ' (DRY-RUN)' : ''));
  
  const parties = await Party.find({}).lean();
  console.log(`📊 ${parties.length} soirées trouvées au total.`);
  
  let stats = {
    real: 0,
    demo: 0,
    test: 0,
    usersCreated: 0,
    uniqueEmails: new Set()
  };
  
  const userMap = new Map(); // canonicalEmail -> User Object
  
  for (const party of parties) {
    const participants = party.participants || [];
    const guestCount = participants.length;
    
    // Duration in minutes
    const start = party.lifecycle?.startedAt || party.createdAt;
    const end = party.endedAt || party.lifecycle?.lastActivityAt || new Date();
    const durationMs = new Date(end) - new Date(start);
    const durationMin = Math.max(0, Math.floor(durationMs / 60000));
    
    // Count emails
    const emailsInParty = new Set();
    participants.forEach(p => {
      if (isValidEmail(p.email)) emailsInParty.add(p.email.toLowerCase().trim());
    });
    
    let classification = 'TEST';
    if (guestCount >= 5 && durationMin >= 60 && emailsInParty.size >= 2) {
      classification = 'REAL';
    } else if (guestCount >= 2 && durationMin >= 30) {
      classification = 'DEMO';
    }
    
    if (classification === 'TEST') {
      stats.test++;
      continue;
    }
    
    if (classification === 'REAL') stats.real++;
    if (classification === 'DEMO') stats.demo++;
    
    // Process guests
    for (const p of participants) {
      if (!isValidEmail(p.email)) continue;
      
      const canonicalEmail = p.email.toLowerCase().trim();
      stats.uniqueEmails.add(canonicalEmail);
      
      if (!userMap.has(canonicalEmail)) {
        userMap.set(canonicalEmail, {
          authProvider: 'email',
          providerId: 'legacy_' + crypto.createHash('md5').update(canonicalEmail).digest('hex'),
          email: canonicalEmail,
          profile: {
            firstName: cleanFirstName(p.firstName || p.name),
            emoji: p.emoji || '🎉'
          },
          aliasHistory: [],
          partiesAttended: [],
          legacyUserIds: new Set(),
          emailVerified: false,
          isMigrated: true,
          createdAt: p.joinedAt || party.createdAt || new Date()
        });
      }
      
      const user = userMap.get(canonicalEmail);
      
      // Update created at if this party is older
      const joinedAt = new Date(p.joinedAt || party.createdAt || new Date());
      if (joinedAt < new Date(user.createdAt)) {
        user.createdAt = joinedAt;
      }
      
      // Add to aliasHistory
      user.aliasHistory.push({
        firstName: cleanFirstName(p.firstName || p.name),
        emoji: p.emoji,
        seenInParty: party.code,
        seenAt: joinedAt
      });
      
      // Add to partiesAttended
      user.partiesAttended.push({
        partyId: party._id,
        partyCode: party.code,
        role: p.role || 'guest',
        joinedAt: joinedAt,
        partyName: party.welcomeText || `Soirée ${party.code}`,
        partyCoverURL: party.coverPhoto,
        partyDate: party.scheduledFor || party.createdAt,
        legacyUserId: p.id || p.userId
      });
      
      if (p.id || p.userId) {
        user.legacyUserIds.add(p.id || p.userId);
      }
    }
  }
  
  console.log('\n--- RÉSULTATS DE CLASSIFICATION ---');
  console.log(`REAL: ${stats.real}`);
  console.log(`DEMO: ${stats.demo}`);
  console.log(`TEST (ignorées): ${stats.test}`);
  console.log(`Emails uniques détectés: ${stats.uniqueEmails.size}`);
  
  if (DRY_RUN) {
    console.log('\n--- DRY RUN OUTPUT ---');
    console.log('Les utilisateurs suivants seraient créés :');
    for (const [email, user] of userMap.entries()) {
      const aliasCount = user.aliasHistory.length;
      const personaCounts = {};
      user.aliasHistory.forEach(a => {
        const key = `${a.firstName} ${a.emoji || ''}`.trim();
        personaCounts[key] = (personaCounts[key] || 0) + 1;
      });
      const topPersonas = Object.entries(personaCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(p => `${p[0]} (${p[1]}x)`)
        .join(', ');
        
      console.log(`- ${email} (Prénom: ${user.profile.firstName}, Soirées: ${user.partiesAttended.length}, Alias: ${aliasCount})`);
      console.log(`  Top personas: ${topPersonas}`);
    }
    console.log('\nAucune écriture en base n\'a été effectuée.');
    process.exit(0);
  }
  
  console.log('\n💾 Sauvegarde en base de données...');
  
  let inserted = 0;
  for (const [email, userData] of userMap.entries()) {
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log(`⚠️ User ${email} existe déjà, ignoré.`);
      continue;
    }
    
    userData.legacyUserIds = Array.from(userData.legacyUserIds);
    
    const newUser = new User(userData);
    await newUser.save();
    inserted++;
  }
  
  console.log(`✅ Migration terminée. ${inserted} utilisateurs créés.`);
}

async function main() {
  await connectDB();
  
  if (ROLLBACK) {
    await rollback();
  } else {
    await migrate();
  }
  
  mongoose.disconnect();
}

main().catch(err => {
  console.error('Erreur fatale:', err);
  mongoose.disconnect();
  process.exit(1);
});
