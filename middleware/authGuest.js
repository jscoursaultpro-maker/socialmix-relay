import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Party from '../models/Party.js';
import { supabasePublic } from '../utils/supabase.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET env var required');

export const verifyGuestAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Token missing' });
    }

    // 1. First, try legacy JWT auth (iOS host app)
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.userId) {
        const user = await User.findById(decoded.userId);
        if (user && !user.isDeleted && !user.isBanned) {
          req.user = user;
          return next();
        }
      }
    } catch (jwtError) {
      // If it fails, do not throw yet. We will try Supabase next.
      // E.g., TokenExpiredError or JsonWebTokenError
    }

    // 2. If legacy JWT fails (or token was from Supabase), try Supabase Auth
    const { data, error } = await supabasePublic.auth.getUser(token);
    
    if (!error && data.user) {
      const supabaseUser = data.user;
      
      // 3. Find or create User in MongoDB
      let user = await User.findOne({ email: supabaseUser.email });
      
      if (!user) {
        // Check if user exists by supabaseUserId just in case email changed
        user = await User.findOne({ supabaseUserId: supabaseUser.id });
      }

      if (!user) {
        // Create new user for this guest
        const handleBase = supabaseUser.email ? supabaseUser.email.split('@')[0] : 'guest';
        // Basic deduplication for handle
        const uniqueSuffix = Math.floor(Math.random() * 10000);
        const handle = `${handleBase}${uniqueSuffix}`;

        // ★ Parse name from SSO metadata (Apple provides full_name only on first login)
        const meta = supabaseUser.user_metadata || {};
        const rawFullName = meta.full_name || meta.name || '';
        const givenName = meta.given_name || meta.first_name || '';
        const familyName = meta.family_name || meta.last_name || '';
        
        let firstName = givenName;
        let lastName = familyName;
        
        // If no given_name but we have full_name, split it
        if (!firstName && rawFullName) {
          const parts = rawFullName.trim().split(/\s+/);
          firstName = parts[0] || '';
          lastName = parts.slice(1).join(' ') || lastName;
        }
        
        // Final fallback
        if (!firstName) firstName = 'Guest';

        console.log(`[authGuest] Creating new user: email=${supabaseUser.email} firstName="${firstName}" lastName="${lastName}" provider=${meta.iss || '?'}`);

        user = new User({
          email: supabaseUser.email,
          supabaseUserId: supabaseUser.id,
          profile: {
            firstName,
            lastName,
            handle,
            emoji: '👽',
          },
          createdViaSprintB: true,
        });
        await user.save();
      } else {
        // If user exists but doesn't have supabaseUserId linked, link it now
        if (!user.supabaseUserId) {
          user.supabaseUserId = supabaseUser.id;
          await user.save();
        }
      }

      if (user.isDeleted || user.isBanned) {
        return res.status(403).json({ error: 'User account is restricted' });
      }

      // Attach MongoDB user to request
      req.user = user;
      return next();
    }

    // 3. Fallback: treat token as internal session UUID (sbauth-bypass guests)
    // These guests authenticated via URL param and have no local Supabase session.
    // The server assigned them a UUID session token stored in party.sessionTokens.
    const partyCode = req.params.code || req.headers['x-party-code'] || '';
    if (partyCode) {
      const party = await Party.findOne(
        { code: partyCode.toUpperCase(), endedAt: null },
        { sessionTokens: 1, participants: 1 }
      );
      if (party) {
        const guestName = (party.sessionTokens || {})[token];
        if (guestName) {
          // Found session UUID → resolve participant's userId
          const participant = (party.participants || []).find(
            p => p.name === guestName && p.userId
          );
          if (participant) {
            const user = await User.findById(participant.userId);
            if (user && !user.isDeleted && !user.isBanned) {
              console.log(`[authGuest] ✅ Auth via session UUID for ${guestName} (userId: ${participant.userId})`);
              req.user = user;
              return next();
            }
          }
        }
      }
    }

    return res.status(401).json({ error: 'Invalid token (failed legacy JWT, Supabase, and session UUID lookup)' });
  } catch (error) {
    console.error('verifyGuestAuth Error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
};
