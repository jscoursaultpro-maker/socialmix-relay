import jwt from 'jsonwebtoken';
import User from '../models/User.js';
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
    
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid token (failed both legacy JWT and Supabase)' });
    }

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

      user = new User({
        email: supabaseUser.email,
        supabaseUserId: supabaseUser.id,
        firstName: supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || 'Guest',
        handle,
        emoji: '👽',
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
    next();
  } catch (error) {
    console.error('verifyGuestAuth Error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
};
