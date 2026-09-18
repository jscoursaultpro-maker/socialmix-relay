import cookie from 'cookie';
import { supabasePublic } from '../utils/supabase.js';

export async function verifySupabaseSession(req, res, next) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const token = cookies['sb-access-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'NO_SESSION' });
  }
  
  try {
    const { data, error } = await supabasePublic.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'INVALID_SESSION' });
    }
    
    // Attach user info to req
    req.supabaseUser = {
      id: data.user.id,
      email: data.user.email,
      provider: data.user.app_metadata?.provider
    };
    
    next();
  } catch (err) {
    console.error('[verifySupabaseSession] error:', err.message);
    return res.status(401).json({ error: 'SESSION_ERROR' });
  }
}
