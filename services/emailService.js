import sgMail from '@sendgrid/mail';

const apiKey = process.env.SENDGRID_API_KEY;
const isDevMode = !apiKey || apiKey === 'PLACEHOLDER_TO_BE_FILLED';

if (!isDevMode) {
  sgMail.setApiKey(apiKey);
}

export const sendEmail = async ({ to, subject, html }) => {
  const brandName = process.env.BRAND_NAME || 'Ahouai';
  const brandEmail = process.env.BRAND_EMAIL || 'hello@localhost';
  
  // Replace placeholders if any (in case they are sent as {{brandName}})
  const finalHtml = html.replace(/\{\{brandName\}\}/g, brandName);
  
  const msg = {
    to,
    from: {
      email: brandEmail,
      name: brandName
    },
    subject,
    html: finalHtml
  };

  if (isDevMode) {
    console.log('\n================ DEV MODE EMAIL ================');
    console.log(`To: ${to}`);
    console.log(`From: ${msg.from.name} <${msg.from.email}>`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:\n${finalHtml}`);
    console.log('================================================\n');
    return { success: true, mode: 'console' };
  }

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    console.error('SendGrid Error:', error.response ? error.response.body : error);
    throw new Error('Failed to send email');
  }
};
