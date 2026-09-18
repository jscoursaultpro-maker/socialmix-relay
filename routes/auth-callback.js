import { Router } from 'express';
import cookie from 'cookie';
import { supabaseAdmin } from '../utils/supabase.js';

const router = Router();

// GET /auth/callback?code=<oauth_code>&next=<url_encoded>
router.get('/callback', async (req, res) => {
  const { code, next } = req.query;
  
  if (!code) {
    return res.redirect('/?error=missing_code');
  }
  
  try {
    // Exchange OAuth code for session
    const { data, error } = await supabaseAdmin.auth.exchangeCodeForSession(code);
    
    if (error || !data.session) {
      console.error('[auth/callback] exchange failed:', error?.message);
      return res.redirect('/?error=auth_failed');
    }
    
    // Set httpOnly cookie with session tokens
    res.setHeader('Set-Cookie', [
      cookie.serialize('sb-access-token', data.session.access_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/'
      }),
      cookie.serialize('sb-refresh-token', data.session.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
        path: '/'
      })
    ]);
    
    // Redirect to next (or root with code param)
    const redirectTo = next && next.startsWith('/') ? next : '/';
    return res.redirect(redirectTo);
    
  } catch (err) {
    console.error('[auth/callback] error:', err.message);
    return res.redirect('/?error=auth_error');
  }
});

export default router;
