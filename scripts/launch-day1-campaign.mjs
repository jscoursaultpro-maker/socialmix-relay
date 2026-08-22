import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import AuthToken from '../models/AuthToken.js';
import { sendEmail } from '../services/emailService.js';
import crypto from 'crypto';

// Load .env
dotenv.config({ path: '../.env' });
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DRY_RUN = !process.argv.includes('--execute');

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/socialmix';
  await mongoose.connect(uri);
  console.log('📦 Connecté à MongoDB');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCampaign() {
  console.log('🚀 Démarrage Campagne Day 1 V2' + (DRY_RUN ? ' (DRY-RUN)' : ' (EXECUTE)'));
  
  const templatePath = path.join(__dirname, '../emails/welcome-v2.html');
  const htmlTemplate = fs.readFileSync(templatePath, 'utf-8');
  
  const users = await User.find({
    email: { $ne: null },
    isMigrated: true,
    emailVerified: false
  });
  
  console.log(`📊 ${users.length} utilisateurs cibles trouvés.`);
  
  let sent = 0;
  
  for (const user of users) {
    const partiesCount = user.partiesAttended ? user.partiesAttended.length : 0;
    if (partiesCount === 0) continue; // Safety check
    
    const tokenStr = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(tokenStr).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours exceptionnellement
    
    const domain = process.env.BRAND_DOMAIN || 'localhost:3000';
    const protocol = domain.includes('localhost') ? 'http' : 'https';
    const magicLink = `${protocol}://${domain}/api/auth/magic-link?token=${tokenStr}`;
    
    let emailHtml = htmlTemplate
      .replace(/\{\{firstName\}\}/g, user.profile.firstName || 'Guest')
      .replace(/\{\{partiesCount\}\}/g, partiesCount)
      .replace(/\{\{magicLink\}\}/g, magicLink);
    
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Prêt à envoyer à ${user.email} (Parties: ${partiesCount}) - Link: ${magicLink}`);
    } else {
      console.log(`Envoi à ${user.email}...`);
      
      // Save token
      await AuthToken.create({
        userId: user._id,
        tokenHash: hashedToken,
        type: 'magic_link',
        expiresAt
      });
      
      // Send email
      await sendEmail({
        to: user.email,
        subject: "Ton historique de soirées t'attend \uD83C\uDF89", // 🎉 emoji
        html: emailHtml
      });
      
      sent++;
      await sleep(1000); // Batch sleep 1s
    }
  }
  
  if (DRY_RUN) {
    console.log(`\n✅ DRY-RUN terminé. Ajoutez --execute pour lancer l'envoi.`);
  } else {
    console.log(`\n✅ Campagne terminée. ${sent} emails envoyés.`);
  }
  process.exit(0);
}

async function main() {
  await connectDB();
  await runCampaign();
}

main().catch(err => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
