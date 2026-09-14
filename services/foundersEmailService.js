import sgMail from '@sendgrid/mail';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const FROM_ADDRESS = process.env.SENDGRID_FROM || 'hello@ahouai.com';

export async function sendFoundersConfirmationEmail({ email, position, total }) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('[foundersEmail] SENDGRID_API_KEY missing, skip send');
    return { sent: false, reason: 'sendgrid_not_configured' };
  }
  const msg = {
    to: email,
    from: FROM_ADDRESS,
    subject: 'Ta place de Founder AhOuai est réservée 🎉',
    text: `Salut,\n\nTu es officiellement sur la liste des Founders AhOuai. Ta position : #${position} sur 2500.\n\nOn te contactera au lancement du programme (Q2 2027) pour finaliser ton adhésion (39€ à vie).\n\nPas de compte à créer maintenant, on garde juste ton email jusque-là. Pour te désinscrire à tout moment : réponds à ce mail.\n\nMerci de nous faire confiance si tôt.\n\n— L'équipe AhOuai`,
  };
  try {
    const [response] = await sgMail.send(msg);
    return { sent: true, statusCode: response.statusCode };
  } catch (err) {
    console.error('[foundersEmail] SendGrid error:', err.code || err.message);
    return { sent: false, reason: 'sendgrid_error', code: err.code };
  }
}
