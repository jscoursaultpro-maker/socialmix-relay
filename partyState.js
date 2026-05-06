// ─── Party State Factory ────────────────────────────────────────────
// Each party gets its own isolated state object.
// Used by server.js: const parties = new Map(); parties.set(code, createPartyState(code));

/**
 * Create a fresh party state for a given code.
 * Structure mirrors the original global partyState exactly.
 */
export function createPartyState(code) {
  return {
    code,
    mode: 'appMix',           // 'appMix' | 'djLive'
    currentTrack: null,        // {title, artist, genre, bpm, artworkURL}
    nextTrack: null,
    trackHistory: [],          // [{title, artist, genre, bpm, playedAt}]
    genreVotes: {},            // {genre: count}
    vibeScore: 0,
    participants: [],          // [{id, name, emoji, photo, joinedAt}]
    guestVotes: {},            // {guestId: {trackId: voteType}}
    suggestions: [],           // [{query, guestName, sentAt}]
    hostProfile: null,         // {name, emoji}
    photos: [],                // [{dataURL, guestName, sentAt}]
    photoHashes: new Set(),
    costumeEntries: [],        // [{guestId, guestName, emoji, photo, votes}]
    costumeOpen: true,         // Whether costume contest is still accepting votes
    costumeVoters: {},         // {voterId: targetId}
    participantScores: {},     // {key: {name, score, voteCount, participantId}}
    guestGenreVotes: {},       // {voterKey: genre}
    profilePointsGiven: new Set(),
    _genreVotedOnce: {},
    // Metadata
    createdAt: new Date().toISOString(),
    hostSocketId: null         // Track which socket is the host
  };
}

/**
 * Validate a party code format.
 * Codes are 4-8 uppercase alphanumeric characters.
 */
export function isValidPartyCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{4,8}$/.test(code);
}
