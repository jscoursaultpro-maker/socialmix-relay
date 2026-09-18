// Chargé en type="module" depuis index.html
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let _supabase = null;

export async function getSupabase() {
  if (_supabase) return _supabase;
  const res = await fetch('/api/config');
  const cfg = await res.json();
  _supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  return _supabase;
}

export async function signInWithProvider(provider, partyCode) {
  const supabase = await getSupabase();
  const redirectTo = `https://join.ahouai.com/auth/callback?next=/?code=${encodeURIComponent(partyCode)}&sb=1`;
  await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo }
  });
}

export async function getSession() {
  const supabase = await getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}
