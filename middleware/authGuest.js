import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Party from '../models/Party.js';
import { supabasePublic } from '../utils/supabase.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET env var required');

const cookieAuthRateLimit = new Map();
function checkCookieRateLimit(ip) {
  const now = Date.now();
  const entry = cookieAuthRateLimit.get(ip) || { count: 0, resetTime: now + 60000 };
  if (now > entry.resetTime) {
    entry.count = 1;
    entry.resetTime = now + 60000;
  } else {
    entry.count++;
  }
  cookieAuthRateLimit.set(ip, entry);
  return entry.count <= 30;
}

export const verifyGuestAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      if (!checkCookieRateLimit(ip)) {
        return res.status(429).json({ error: 'Too Many Requests' });
      }

      const cookieStr = req.headers.cookie || '';
      const cookies = Object.fromEntries(cookieStr.split(';').map(c => {
        const parts = c.split('=');
        return [parts[0].trim(), parts.slice(1).join('=')];
      }));

      if (cookies['sbauth']) {
        try {
          const payloadStr = Buffer.from(decodeURIComponent(cookies['sbauth']), 'base64').toString('utf8');
          const payload = JSON.parse(payloadStr);
          if (payload && payload.userId) {
            const user = await User.findById(payload.userId);
            if (user && !user.isDeleted && !user.isBanned) {
              console.log('[authGuest] auth via cookie sbauth');
              req.user = user;
              return next();
            }
          }
        } catch (e) {
          console.warn('[authGuest] sbauth decode failed:', e.message);
        }
      }

      const sbTokens = Object.keys(cookies).filter(k => k.match(/^sb-.*-auth-token/)).sort();
      if (sbTokens.length > 0) {
        try {
          const combined = sbTokens.map(k => cookies[k]).join('');
          const decodedCookie = decodeURIComponent(combined);
          let jsonStr = decodedCookie;
          if (jsonStr.startsWith('base64-')) {
            jsonStr = Buffer.from(jsonStr.replace('base64-', ''), 'base64').toString('utf8');
          }
          const sessionObj = JSON.parse(jsonStr);
          if (sessionObj && sessionObj.access_token) {
            console.log('[authGuest] auth via cookie supabase');
            token = sessionObj.access_token;
          }
        } catch (e) {
          console.warn('[authGuest] supabase cookie parse failed:', e.message);
        }
      }

      if (!token) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
      }
    }
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
        // ★ Sanitize handle : regex User schema n'accepte que [a-z0-9_-]{3,20}
        // On remplace tout caractère invalide (dont le '.' des emails) par '_'
        const rawBase = supabaseUser.email ? supabaseUser.email.split('@')[0] : 'guest';
        const cleanBase = rawBase.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 15) || 'guest';
        const uniqueSuffix = Math.floor(Math.random() * 10000);
        const handle = `${cleanBase}${uniqueSuffix}`.slice(0, 20);

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

    // 4. Fallback: hostSecret lookup (iOS host boost, iOS host commands)
    // iOS host may send Authorization: Bearer <hostSecret UUID>
    if (partyCode) {
      const partyForHost = await Party.findOne(
        { code: partyCode.toUpperCase(), endedAt: null },
        { hostSecret: 1, hostUserId: 1 }
      );
      if (partyForHost && partyForHost.hostSecret === token && partyForHost.hostUserId) {
        const hostUser = await User.findById(partyForHost.hostUserId);
        if (hostUser && !hostUser.isDeleted && !hostUser.isBanned) {
          console.log(`[authGuest] ✅ Auth via hostSecret for host userId: ${hostUser._id}`);
          req.user = hostUser;
          req.authMethod = 'host-secret';
          return next();
        }
      }
    }

    return res.status(401).json({ error: 'Invalid token (failed legacy JWT, Supabase, session UUID, and hostSecret lookup)' });
  } catch (error) {
    console.error('verifyGuestAuth Error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
};
