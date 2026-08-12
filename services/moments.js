/**
 * services/moments.js — Auto-détection moments-clés batch post-soirée
 *
 * Called fire-and-forget after host:endParty / host:sendToAfterglow.
 * Idempotent: skips if party.moments[] already populated.
 *
 * Data sources:
 *   - party.guestVotes: { guestSocketId: { trackTitle: 'fire'|'like'|'bof' } }
 *   - party.participantScores: { key: { name, score, voteCount, participantId } }
 *   - party.participants[]: { name, emoji, joinedAt, isHost }
 *   - party.photos[]: embedded photos (or Photo collection via partyCode)
 *   - HostPlaybackHistory: per-track play records with voteScore, phase
 *
 * ★ Doctrine: never invent missing data — skip moment type if data insufficient.
 */
import Party from '../models/Party.js';
import { Photo } from '../models/Photo.js';

/**
 * Compute and persist moments for an ended party.
 * @param {string|import('mongoose').Types.ObjectId} partyId
 * @returns {Promise<object[]>} computed moments
 */
export async function computeMoments(partyId) {
  const party = await Party.findById(partyId).lean();
  if (!party) {
    console.warn(`[computeMoments] Party ${partyId} not found — skipping`);
    return [];
  }
  if (!party.endedAt) {
    console.warn(`[computeMoments] Party ${party.code} still live — skipping`);
    return [];
  }

  // ★ Idempotent: don't recompute if moments already exist
  if (party.moments && party.moments.length > 0) {
    console.log(`[${party.code}] computeMoments: already has ${party.moments.length} moments — skipping`);
    return party.moments;
  }

  const moments = [];
  const now = new Date();

  // ─── Type 1: peak_votes — window with most fire votes ──────────────
  try {
    const peakMoment = computePeakVotes(party);
    if (peakMoment) moments.push({ ...peakMoment, computedAt: now });
  } catch (err) {
    console.warn(`[${party.code}] peak_votes failed:`, err.message);
  }

  // ─── Type 2: guest_mvp — top scoring guest ────────────────────────
  try {
    const mvpMoment = computeGuestMvp(party);
    if (mvpMoment) moments.push({ ...mvpMoment, computedAt: now });
  } catch (err) {
    console.warn(`[${party.code}] guest_mvp failed:`, err.message);
  }

  // ─── Type 3: track_hall_of_fame — track with ≥3 fire votes ────────
  try {
    const fameMoment = computeTrackHallOfFame(party);
    if (fameMoment) moments.push({ ...fameMoment, computedAt: now });
  } catch (err) {
    console.warn(`[${party.code}] track_hall_of_fame failed:`, err.message);
  }

  // ─── Type 4: first_guest — first non-host participant ─────────────
  try {
    const firstMoment = computeFirstGuest(party);
    if (firstMoment) moments.push({ ...firstMoment, computedAt: now });
  } catch (err) {
    console.warn(`[${party.code}] first_guest failed:`, err.message);
  }

  // ─── Type 5: best_photo — photo from Cloudinary (Photo collection) ─
  try {
    const photoMoment = await computeBestPhoto(party);
    if (photoMoment) moments.push({ ...photoMoment, computedAt: now });
  } catch (err) {
    console.warn(`[${party.code}] best_photo failed:`, err.message);
  }

  // ─── Persist ──────────────────────────────────────────────────────
  if (moments.length > 0) {
    await Party.findByIdAndUpdate(partyId, { $set: { moments } });
    console.log(`[${party.code}] ✨ Computed ${moments.length} moments: ${moments.map(m => m.type).join(', ')}`);
  } else {
    console.log(`[${party.code}] computeMoments: no moments detected (insufficient data)`);
  }

  return moments;
}

// ═══════════════════════════════════════════════════════════════════════
// DETECTORS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Peak votes: aggregate fire votes from guestVotes, find the track with
 * the most fire votes overall. Min 3 fire votes total to trigger.
 */
function computePeakVotes(party) {
  const guestVotes = party.guestVotes || {};
  // Aggregate fire votes per track
  const fireByTrack = {};
  let totalFire = 0;

  for (const [, votes] of Object.entries(guestVotes)) {
    if (typeof votes !== 'object') continue;
    for (const [trackTitle, voteType] of Object.entries(votes)) {
      if (voteType === 'fire') {
        fireByTrack[trackTitle] = (fireByTrack[trackTitle] || 0) + 1;
        totalFire++;
      }
    }
  }

  if (totalFire < 3) return null;  // Min 3 fire votes to trigger

  // Find top track
  let topTrack = null;
  let topFeu = 0;
  for (const [title, count] of Object.entries(fireByTrack)) {
    if (count > topFeu) {
      topTrack = title;
      topFeu = count;
    }
  }

  // Find approximate timestamp from trackHistory
  const histEntry = (party.trackHistory || []).find(t => t.title === topTrack);
  const ts = histEntry?.playedAt ? new Date(histEntry.playedAt) : new Date(party.endedAt);

  return {
    type: 'peak_votes',
    ts,
    meta: {
      totalFireVotes: totalFire,
      topTrack,
      topTrackFeuVotes: topFeu,
      uniqueVoters: Object.keys(guestVotes).length
    }
  };
}

/**
 * Guest MVP: guest (non-host) with highest score in participantScores.
 * Min 10 points to trigger.
 */
function computeGuestMvp(party) {
  const scores = party.participantScores || {};
  let mvpName = null;
  let mvpData = null;

  for (const [key, data] of Object.entries(scores)) {
    if (key === 'host') continue;  // Skip host
    if (!data || typeof data.score !== 'number') continue;
    if (!mvpData || data.score > mvpData.score) {
      mvpName = key;
      mvpData = data;
    }
  }

  if (!mvpData || mvpData.score < 10) return null;

  // Find emoji from participants
  const participant = (party.participants || []).find(p =>
    p.name === mvpName || p.name === mvpData.name
  );

  return {
    type: 'guest_mvp',
    ts: new Date(party.endedAt),
    meta: {
      guestName: mvpData.name || mvpName,
      guestEmoji: participant?.emoji || '🎉',
      points: mvpData.score,
      voteCount: mvpData.voteCount || 0
    }
  };
}

/**
 * Track hall of fame: track with ≥3 fire votes from guestVotes.
 * Returns the track with the MOST fire votes if multiple qualify.
 */
function computeTrackHallOfFame(party) {
  const guestVotes = party.guestVotes || {};
  const fireByTrack = {};

  for (const [, votes] of Object.entries(guestVotes)) {
    if (typeof votes !== 'object') continue;
    for (const [trackTitle, voteType] of Object.entries(votes)) {
      if (voteType === 'fire') {
        fireByTrack[trackTitle] = (fireByTrack[trackTitle] || 0) + 1;
      }
    }
  }

  // Find best track with ≥3 feu
  let bestTrack = null;
  let bestFeu = 0;
  for (const [title, count] of Object.entries(fireByTrack)) {
    if (count >= 3 && count > bestFeu) {
      bestTrack = title;
      bestFeu = count;
    }
  }

  if (!bestTrack) return null;

  // Get artist + phase from trackHistory
  const histEntry = (party.trackHistory || []).find(t => t.title === bestTrack);

  return {
    type: 'track_hall_of_fame',
    ts: histEntry?.playedAt ? new Date(histEntry.playedAt) : new Date(party.endedAt),
    meta: {
      title: bestTrack,
      artist: histEntry?.artist || null,
      feuVotes: bestFeu,
      phase: histEntry?.phase || null
    }
  };
}

/**
 * First guest: first non-host participant to join (by joinedAt).
 */
function computeFirstGuest(party) {
  const guests = (party.participants || []).filter(p => !p.isHost && p.joinedAt);
  if (guests.length === 0) return null;

  // Sort by joinedAt ascending
  guests.sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
  const first = guests[0];

  return {
    type: 'first_guest',
    ts: new Date(first.joinedAt),
    meta: {
      guestName: first.name,
      guestEmoji: first.emoji || '🎉',
      joinedAt: first.joinedAt
    }
  };
}

/**
 * Best photo: from Photo collection (Cloudinary).
 * Uses first photo as "best" since we don't have likes yet.
 * Returns null if no photos exist.
 */
async function computeBestPhoto(party) {
  // Try Photo collection first (Cloudinary URLs)
  const photos = await Photo.find({
    partyCode: party.code,
    deletedAt: null
  }).sort({ sentAt: 1 }).limit(1).lean();

  if (photos.length > 0) {
    const p = photos[0];
    return {
      type: 'best_photo',
      ts: p.sentAt ? new Date(p.sentAt) : new Date(party.endedAt),
      meta: {
        photoId: p._id.toString(),
        guestName: p.guestName || null,
        guestEmoji: p.guestEmoji || null,
        url: p.url,  // Cloudinary CDN URL
        caption: p.caption || null
      }
    };
  }

  // No photos in Photo collection — skip (don't use embedded base64)
  return null;
}
