// Handle URL query ?code=X → fetch public-info → enrich landing

export async function initJoinFlow() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const sbMarker = params.get('sb') === '1';
  
  if (!code) return null;
  
  try {
    const res = await fetch(`/api/party/${code}/public-info`);
    if (!res.ok) throw new Error('PARTY_NOT_FOUND');
    const info = await res.json();
    return { code, info, sbMarker };
  } catch (e) {
    console.error('[join-flow] fetch error:', e);
    return { code, error: true, sbMarker };
  }
}

import { getSession } from "./supabase-client.js";

export async function detectPostAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  const sbMarker = params.get('sb') === '1';
  const code = params.get('code');
  if (!sbMarker || !code) return null;
  
  const session = await getSession();
  if (!session) return null;
  
  const res = await fetch(`/api/party/${code}/join-as-user`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!res.ok) {
    if (res.status === 403) {
      const body = await res.json();
      if (body.requireJoinRequest) return { needsJoinRequest: true, code };
    }
    return { error: true, status: res.status };
  }
  return { success: true, code };
}

