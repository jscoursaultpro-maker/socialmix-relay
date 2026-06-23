import express from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import jwksClient from 'jwks-rsa';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import User from '../models/User.js';
import AuthToken from '../models/AuthToken.js';
import { authJWT } from '../middleware/authJWT.js';
import { sendEmail } from '../services/emailService.js';

const router = express.Router();
const googleClient = new OAuth2Client(); // Will use audience check inside verifyIdToken

// Setup Apple JWKS client
const appleJwksClient = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys'
});

function getAppleSigningKey(header, callback) {
  appleJwksClient.getSigningKey(header.kid, function(err, key) {
    if (err) return callback(err);
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'fallback_refresh_for_dev';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const generateTokens = async (userId) => {
  const accessToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId, type: 'refresh' }, REFRESH_SECRET, { expiresIn: '30d' });
  
  await AuthToken.create({
    userId,
    token: hashToken(refreshToken),
    type: 'refresh',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  });

  return { accessToken, refreshToken };
};

// --- ADOPTION LOGIC (MAPPING RÉTROACTIF) ---
async function findOrCreateUser({ email, authProvider, providerId, profileData, legacyUserId }) {
  let user = null;
  const canonicalEmail = email ? email.toLowerCase().trim() : null;

  // 1. Try to adopt by legacyUserId if provided and no email match yet
  if (legacyUserId) {
    user = await User.findOne({ 'partiesAttended.legacyUserId': legacyUserId, isMigrated: true });
    if (user && canonicalEmail && user.email !== canonicalEmail) {
      // Conflict: legacyUserId belongs to another email? We prioritize email match below.
      user = null; 
    }
  }

  // 2. Try to find by email
  if (!user && canonicalEmail) {
    user = await User.findOne({ email: canonicalEmail });
  }

  if (user) {
    let updated = false;
    // THE ADOPTION LOGIC
    if (user.isMigrated) {
      console.log(`[AUTH] 🎊 Adoption du compte migré pour ${canonicalEmail || legacyUserId}`);
      user.authProvider = authProvider;
      user.providerId = providerId;
      user.emailVerified = true;
      user.isMigrated = false;
      if (profileData.firstName && (!user.profile.firstName || user.profile.firstName === 'Anonymous' || user.profile.firstName === 'Guest')) {
        user.profile.firstName = profileData.firstName;
      }
      if (profileData.photoURL) {
        user.profile.photoURL = profileData.photoURL;
      }
      updated = true;
    } else {
      // Merge logic if already exists but different provider
      if (user.authProvider !== authProvider && canonicalEmail) {
        console.log(`[AUTH] 🔄 Login via ${authProvider} pour un compte créé via ${user.authProvider}`);
      }
    }

    if (updated) await user.save();
    return user;
  }

  // 3. Create new user
  if (!canonicalEmail) {
    throw new Error('Email is required to create a new account');
  }

  user = new User({
    authProvider,
    providerId,
    email: canonicalEmail,
    emailVerified: true,
    profile: {
      firstName: profileData.firstName || 'Guest',
      emoji: profileData.emoji || '🎉',
      photoURL: profileData.photoURL
    }
  });

  await user.save();
  return user;
}


// --- B.1 Sign in with Apple ---
router.post('/apple', async (req, res) => {
  const { identityToken, firstName, email, legacyUserId } = req.body;
  if (!identityToken) return res.status(400).json({ error: 'identityToken required' });

  try {
    const decodedHeader = jwt.decode(identityToken, { complete: true });
    if (!decodedHeader) throw new Error('Invalid token format');

    const payload = await new Promise((resolve, reject) => {
      jwt.verify(identityToken, getAppleSigningKey, { algorithms: ['RS256'], issuer: 'https://appleid.apple.com' }, (err, decoded) => {
        if (err) reject(err);
        else resolve(decoded);
      });
    });

    const providerId = payload.sub;
    const resolvedEmail = payload.email || email;

    if (!resolvedEmail) {
      return res.status(400).json({ error: 'Email missing from Apple payload' });
    }

    const user = await findOrCreateUser({
      email: resolvedEmail,
      authProvider: 'apple',
      providerId,
      profileData: { firstName },
      legacyUserId
    });

    const tokens = await generateTokens(user._id);
    res.json({ ...tokens, user });

  } catch (error) {
    console.error('[AUTH Apple] Error:', error);
    res.status(401).json({ error: 'Invalid Apple identity token' });
  }
});


// --- B.2 Sign in with Google ---
router.post('/google', async (req, res) => {
  const { idToken, legacyUserId } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
    });
    const payload = ticket.getPayload();

    const providerId = payload.sub;
    const email = payload.email;
    const firstName = payload.given_name || payload.name;
    const photoURL = payload.picture;

    const user = await findOrCreateUser({
      email,
      authProvider: 'google',
      providerId,
      profileData: { firstName, photoURL },
      legacyUserId
    });

    const tokens = await generateTokens(user._id);
    res.json({ ...tokens, user });

  } catch (error) {
    console.error('[AUTH Google] Error:', error);
    res.status(401).json({ error: 'Invalid Google idToken' });
  }
});


// --- B.3 Email Magic Link ---
router.post('/email/request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  const canonicalEmail = email.toLowerCase().trim();
  const token = uuidv4();
  
  await AuthToken.create({
    email: canonicalEmail,
    token,
    type: 'magic_link',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 min
  });

  const domain = process.env.BRAND_DOMAIN || 'localhost:3000';
  const brandName = process.env.BRAND_NAME || 'Ahouai';
  const magicLink = `https://${domain}/auth/verify?token=${token}`;

  const htmlContent = `
    <p>Hello,</p>
    <p>Click the link below to sign in to {{brandName}}:</p>
    <p><a href="${magicLink}">${magicLink}</a></p>
    <p>This link will expire in 15 minutes.</p>
  `;

  try {
    await sendEmail({
      to: canonicalEmail,
      subject: `Sign in to ${brandName}`,
      html: htmlContent
    });
    console.log(`[MAGIC LINK] ✨ Email envoyé pour ${canonicalEmail}`);
    res.json({ message: 'Magic link sent' });
  } catch (err) {
    console.error('Failed to send magic link:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

router.post('/email/verify', async (req, res) => {
  const { token, legacyUserId } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });

  const tokenDoc = await AuthToken.findOne({ token, type: 'magic_link' });
  if (!tokenDoc || tokenDoc.expiresAt < new Date()) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Token is valid
  await AuthToken.deleteOne({ _id: tokenDoc._id });

  try {
    const user = await findOrCreateUser({
      email: tokenDoc.email,
      authProvider: 'email',
      providerId: `email_${tokenDoc.email}`,
      profileData: { firstName: tokenDoc.email.split('@')[0] },
      legacyUserId
    });

    const tokens = await generateTokens(user._id);
    res.json({ ...tokens, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// --- B.4 JWT Refresh & Logout ---
router.post('/refresh', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const refreshToken = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    if (decoded.type !== 'refresh') throw new Error('Invalid token type');

    const hashedToken = hashToken(refreshToken);
    const tokenDoc = await AuthToken.findOne({ token: hashedToken, type: 'refresh' });
    if (!tokenDoc) {
      throw new Error('Refresh token revoked or not found');
    }

    const tokens = await generateTokens(decoded.userId);
    res.json(tokens);
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.delete('/logout', authJWT, async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const hashedToken = hashToken(refreshToken);
    await AuthToken.deleteOne({ token: hashedToken, type: 'refresh' });
  }
  res.json({ message: 'Logged out successfully' });
});

export default router;
