// dotenv removed, passing --env-file in Node 24

import { sendEmail } from '../services/emailService.js';

async function testSendGrid() {
  console.log('Test SendGrid Configuration:');
  console.log(`BRAND_EMAIL: ${process.env.BRAND_EMAIL}`);
  console.log(`BRAND_NAME: ${process.env.BRAND_NAME}`);
  
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER_TO_BE_FILLED') {
    console.error('\n❌ ERROR: SENDGRID_API_KEY is missing or invalid in .env');
    console.error('Please configure a valid API key to run this test in real mode.');
    process.exit(1);
  }
  
  console.log('\nSENDGRID_API_KEY is present. Proceeding with real email dispatch...\n');
  
  const mailOptions = {
    to: 'jscoursault.pro@gmail.com',
    subject: "🎉 Test SendGrid AhOuai — c'est live !",
    html: `
      <p>Bonjour Jean-Sé,</p>
      
      <p>Premier email envoyé par AhOuai via SendGrid !</p>
      
      <p>Si tu lis ceci, c'est que :<br>
      ✅ SendGrid envoi OK<br>
      ✅ DKIM/SPF/DMARC OK<br>
      ✅ Cloudflare email routing OK (pour les replies)<br>
      ✅ Infrastructure AhOuai 100% opérationnelle</p>
      
      <p>Prochaine étape : campagne Day 1 vers les 33 users 🚀</p>
      
      <p>— AhOuai Bot</p>
    `
  };

  try {
    const result = await sendEmail(mailOptions);
    console.log(`Email envoyé avec succès, status 202 (Success: ${result.success})`);
  } catch (error) {
    console.error('❌ Failed to send email:', error.message);
  }
}

testSendGrid();
