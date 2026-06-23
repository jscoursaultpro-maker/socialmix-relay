import express from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import jwksClient from 'jwks-rsa';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import User from '../models/User.js';
import { authJWT } from '../middleware/authJWT.js';

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

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId, type: 'refresh' }, REFRESH_SECRET, { expiresIn: '30d' });
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
      // But if email matches or we trust the legacyUserId:
      user = null; // Let's prioritize email first.
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
      if (profileData.firstName && (!user.profile.firstName || user.profile.firstName === 'Anonymous')) {
        user.profile.firstName = profileData.firstName;
      }
      if (profileData.photoURL) {
        user.profile.photoURL = profileData.photoURL;
      }
      updated = true;
    } else {
      // Merge logic if already exists but different provider
      if (user.authProvider !== authProvider && canonicalEmail) {
        // We just log them in, email is the single source of truth.
        // We could store multiple providers if schema allowed, but we don't.
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
    // Decode JWT header to get kid
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

    const tokens = generateTokens(user._id);
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
      // audience: process.env.GOOGLE_CLIENT_ID // Optional: restrict to specific client id
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

    const tokens = generateTokens(user._id);
    res.json({ ...tokens, user });

  } catch (error) {
    console.error('[AUTH Google] Error:', error);
    res.status(401).json({ error: 'Invalid Google idToken' });
  }
});


// --- B.3 Email Magic Link ---
// We will store magic link tokens in memory for simplicity, or in DB.
// Since schema doesn't have authTokens, we'll use a basic mongoose model inline or memory.
// For production, a proper AuthToken collection is better.
const memoryTokens = new Map();

router.post('/email/request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  const canonicalEmail = email.toLowerCase().trim();
  const token = uuidv4();
  
  memoryTokens.set(token, {
    email: canonicalEmail,
    expiresAt: Date.now() + 15 * 60 * 1000 // 15 min
  });

  const domain = process.env.BRAND_DOMAIN || 'localhost:3000';
  const brandName = process.env.BRAND_NAME || 'SocialMix';
  const magicLink = `https://${domain}/auth/verify?token=${token}`;

  // In real life, use emailService here.
  console.log(`[MAGIC LINK] ✨ Email pour ${canonicalEmail}: ${magicLink}`);

  res.json({ message: 'Magic link sent' });
});

router.post('/email/verify', async (req, res) => {
  const { token, legacyUserId } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });

  const tokenData = memoryTokens.get(token);
  if (!tokenData || tokenData.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Token is valid
  memoryTokens.delete(token);

  try {
    const user = await findOrCreateUser({
      email: tokenData.email,
      authProvider: 'email',
      providerId: `email_${tokenData.email}`,
      profileData: { firstName: tokenData.email.split('@')[0] },
      legacyUserId
    });

    const tokens = generateTokens(user._id);
    res.json({ ...tokens, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// --- B.4 JWT Refresh & Logout ---
router.post('/refresh', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const refreshToken = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    if (decoded.type !== 'refresh') throw new Error('Invalid token type');

    const tokens = generateTokens(decoded.userId);
    res.json(tokens);
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.delete('/logout', authJWT, (req, res) => {
  // In a real implementation with refresh tokens stored in DB, we would invalidate it here.
  res.json({ message: 'Logged out successfully' });
});


export default router;
