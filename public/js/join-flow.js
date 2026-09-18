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
