// Match recording identifiers or the complete normalized title + artist.
// Avoid substring matching: remixes and similarly named songs remain distinct.
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function sameSuggestedTrack(a, b) {
  if (a.suggestionId && b.id && String(a.suggestionId) === String(b.id)) return true;
  if (b.suggestionId && a.id && String(b.suggestionId) === String(a.id)) return true;
  for (const field of ['isrc', 'deezerID', 'appleMusicID', 'spotifyID']) {
    if (a[field] && b[field] && String(a[field]).toLowerCase() === String(b[field]).toLowerCase()) return true;
  }
  return !!normalized(a.title) && !!normalized(a.artist) &&
    normalized(a.title) === normalized(b.title) && normalized(a.artist) === normalized(b.artist);
}
export function reconcilePlayedSuggestions(party) {
  const played = [...(party.trackHistory || []), party.currentTrack].filter(Boolean);
  let changed = false;
  for (const suggestion of party.suggestions || []) {
    if (!['pending', 'queued', 'next'].includes(suggestion.status)) continue;
    const track = played.find(t => sameSuggestedTrack(suggestion, t));
    if (!track) continue;
    suggestion.status = 'played';
    suggestion.playedAt ||= track.playedAt || track.startedAt || new Date().toISOString();
    changed = true;
  }
  if (changed) party.isDirty = true;
  return changed;
}
