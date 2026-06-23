import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const authJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_for_dev');

    // Mongoose query
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'Account banned', reason: user.bannedReason });
    }
    
    if (user.isDeleted) {
      return res.status(401).json({ error: 'Account deleted' });
    }

    // Attach user to req
    req.user = user;
    
    // Update lastSeenAt silently
    User.updateOne({ _id: user._id }, { lastSeenAt: new Date() }).catch(console.error);

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', expired: true });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};
