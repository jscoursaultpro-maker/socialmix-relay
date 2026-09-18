import { Router } from 'express';
const router = Router();

// Public config for frontend (safe to expose)
router.get('/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

export default router;
