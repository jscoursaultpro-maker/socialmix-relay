// Older iOS clients send trackTitle; web clients may send an ID or "current".
export function resolveVoteTrackTitle(party, data) {
  const requested = String(data.trackTitle || data.trackId || 'current');
  const track = requested === 'current' ? party.currentTrack :
    [party.currentTrack, ...(party.trackHistory || [])].filter(Boolean).find(t =>
      [t.title, t.id, t.trackId, t.deezerId, t.appleMusicId].filter(Boolean).some(id => String(id) === requested));
  return track?.title || (requested !== 'current' ? requested : null);
}
