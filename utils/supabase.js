import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[supabase] SUPABASE_URL or SUPABASE_ANON_KEY missing');
}

// Client public (pour verify token)
export const supabasePublic = createClient(supabaseUrl, supabaseAnonKey);

// Client admin (pour exchange OAuth code)
export const supabaseAdmin = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : supabasePublic;

export default supabasePublic;
