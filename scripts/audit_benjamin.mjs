// Diagnostic urgent Benjamin
import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

const Party = mongoose.model('Party', new mongoose.Schema({}, { strict: false }));
const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

// Trouver toutes les parties actives
const activeParties = await Party.find(
  { endedAt: null },
  { code: 1, hostProfile: 1, pendingGuests: 1, participants: 1, preApprovedGuests: 1 }
).lean();

console.log(`\n📊 ${activeParties.length} parties actives :\n`);
for (const p of activeParties) {
  console.log(`─── ${p.code} ─── (host: ${p.hostProfile?.name || 'inconnu'})`);
  console.log(`  Participants: ${(p.participants || []).length}`);
  console.log(`  PendingGuests: ${(p.pendingGuests || []).length}`);
  (p.pendingGuests || []).forEach(g => {
    console.log(`    ⏳ ${g.firstName} ${g.lastName} <${g.email}> requestedAt=${g.requestedAt}`);
  });
  console.log(`  PreApprovedGuests: ${(p.preApprovedGuests || []).length}`);
}

// Trouver l'utilisateur Benjamin
const benjamin = await User.findOne({
  $or: [
    { 'profile.firstName': /Benjamin/i },
    { email: /benjamin/i }
  ]
}).lean();
console.log(`\n👤 Benjamin User:`, benjamin ? `_id=${benjamin._id} email=${benjamin.email} firstName=${benjamin.profile?.firstName}` : 'INTROUVABLE');

process.exit(0);
