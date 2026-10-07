const artworkCache = new Map();

function cacheKey(track) {
  return `${String(track?.artist || '').trim().toLowerCase()}|${String(track?.title || '').trim().toLowerCase()}`;
}

async function lookupArtwork(track) {
  const key = cacheKey(track);
  if (!key || key === '|') return null;
  if (artworkCache.has(key)) return artworkCache.get(key);

  try {
    const deezerID = Number(track.deezerID || track.deezerId || 0);
    const query = encodeURIComponent(`${track.artist || ''} ${track.title || ''}`.trim());
    const url = deezerID > 0
      ? `https://api.deezer.com/track/${deezerID}`
      : `https://api.deezer.com/search?q=${query}&limit=5`;
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(`Deezer ${response.status}`);
    const payload = await response.json();
    const wantedArtist = String(track.artist || '').toLowerCase();
    const wantedTitle = String(track.title || '').toLowerCase();
    const candidates = deezerID > 0 ? [payload] : (Array.isArray(payload.data) ? payload.data : []);
    const match = candidates.find(item =>
      String(item.artist?.name || '').toLowerCase().includes(wantedArtist) &&
      String(item.title || '').toLowerCase().includes(wantedTitle)
    ) || candidates[0];
    const result = match ? {
      deezerID: match.id || track.deezerID || null,
      artworkUrl: match.album?.cover_big || match.album?.cover_medium || match.album?.cover || null
    } : null;
    artworkCache.set(key, result);
    return result;
  } catch (error) {
    console.warn(`[DeezerArtwork] ${key}: ${error.message}`);
    return null;
  }
}

export async function enrichArtwork(items) {
  return Promise.all(items.map(async item => {
    const current = item.artworkUrl || item.coverURL;
    if (current) return { ...item, artworkUrl: current, coverURL: current };
    const found = await lookupArtwork(item);
    if (!found?.artworkUrl) return item;
    return {
      ...item,
      deezerID: item.deezerID || found.deezerID,
      artworkUrl: found.artworkUrl,
      coverURL: found.artworkUrl
    };
  }));
}
