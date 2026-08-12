/**
 * services/userStats.js — Post-soirée user stats enrichment
 *
 * Called fire-and-forget after host:endParty / host:sendToAfterglow.
 * Idempotent: overwrites previous values on every call.
 *
 * Data sources:
 *   - Party: hostUserId (top-level), participants[], lifecycle.startedAt
 *   - HostPlaybackHistory: trackId → Track.genre (HPH.genre is always null,
 *     so we JOIN via HPH.trackId → Track.genre for topGenres)
 *   - Guest dedup: by email when available, fallback to name::emoji hash
 *
 * ★ Doctrine: never invent missing data. If genre is absent from Track, skip it.
 */
import User from '../models/User.js';
import Party from '../models/Party.js';
import HostPlaybackHistory from '../models/HostPlaybackHistory.js';
import Track from '../models/Track.js';

/**
 * Compute and persist stats for a host user.
 * @param {string|import('mongoose').Types.ObjectId} hostUserId
 * @returns {Promise<object|null>} computed stats or null if no ended parties
 */
export async function computeUserStats(hostUserId) {
  if (!hostUserId) {
    console.warn('[userStats] No hostUserId provided — skipping');
    return null;
  }

  const user = await User.findById(hostUserId).lean();
  if (!user) {
    console.warn(`[userStats] User ${hostUserId} not found — skipping`);
    return null;
  }

  // All ended parties for this host
  const parties = await Party.find({
    hostUserId,
    endedAt: { $ne: null }
  }).sort({ 'lifecycle.startedAt': 1 }).lean();

  if (parties.length === 0) {
    console.log(`[userStats] ${hostUserId}: no ended parties — skipping`);
    return null;
  }

  // ─── TOP GENRES (top 5) ────────────────────────────────────────────
  // HPH.genre is always null (0/3716 in prod), so we JOIN via trackId → Track
  const partyCodes = parties.map(p => p.code);
  const hphs = await HostPlaybackHistory.find({
    partyCode: { $in: partyCodes }
  }).select('trackId').lean();

  const trackIds = [...new Set(
    hphs.map(h => h.trackId?.toString()).filter(Boolean)
  )];

  let topGenres = [];
  if (trackIds.length > 0) {
    const tracks = await Track.find({
      _id: { $in: trackIds },
      genre: { $exists: true, $ne: null }
    }).select('_id genre').lean();

    const genreMap = new Map(tracks.map(t => [t._id.toString(), t.genre]));
    const genreCounts = {};

    for (const hph of hphs) {
      const genre = genreMap.get(hph.trackId?.toString());
      if (!genre) continue;  // ★ Doctrine: skip if genre absent, don't invent
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    }

    topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([genre, count]) => ({ genre, count }));
  }

  // ─── UNIQUE GUESTS HOSTED ─────────────────────────────────────────
  // Dedup by email (most reliable), fallback to name::emoji hash
  const seenGuests = new Set();
  for (const party of parties) {
    for (const p of (party.participants || [])) {
      if (p.isHost) continue;
      const key = p.email
        ? p.email.toLowerCase().trim()
        : `${p.name || ''}::${p.emoji || ''}`;
      if (key && key !== '::') seenGuests.add(key);
    }
  }
  const uniqueGuestsHosted = seenGuests.size;

  // ─── STREAKS (weekly) ─────────────────────────────────────────────
  const partyDates = parties
    .map(p => p.lifecycle?.startedAt ? new Date(p.lifecycle.startedAt) : null)
    .filter(Boolean)
    .sort((a, b) => a - b);

  const { currentStreak, longestStreak } = computeStreaks(partyDates);

  // ─── PERSIST (idempotent — overwrites) ────────────────────────────
  await User.findByIdAndUpdate(hostUserId, {
    $set: {
      'stats.topGenres': topGenres,
      'stats.uniqueGuestsHosted': uniqueGuestsHosted,
      'stats.currentStreak': currentStreak,
      'stats.longestStreak': longestStreak,
      'stats.lastComputedAt': new Date()
    }
  });

  console.log(`[userStats] ✅ ${user.email || hostUserId}: topGenres=${topGenres.length}, uniqueGuests=${uniqueGuestsHosted}, streak=${currentStreak}/${longestStreak}, parties=${parties.length}`);

  return { topGenres, uniqueGuestsHosted, currentStreak, longestStreak };
}

/**
 * Compute weekly streaks from sorted party dates.
 *
 * A "week" = ISO week (Mon→Sun). A streak is consecutive weeks with ≥1 party.
 * currentStreak counts backward from the current week.
 * longestStreak is the all-time record.
 *
 * @param {Date[]} dates — sorted ascending
 * @returns {{ currentStreak: number, longestStreak: number }}
 */
function computeStreaks(dates) {
  if (dates.length === 0) return { currentStreak: 0, longestStreak: 0 };

  // Get ISO week number for a date
  const getWeekKey = (d) => {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    // Thursday of current week determines the year
    dt.setDate(dt.getDate() + 3 - ((dt.getDay() + 6) % 7));
    const yearStart = new Date(dt.getFullYear(), 0, 4);
    const weekNo = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
    return `${dt.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  };

  // Collect unique weeks with at least 1 party
  const weeks = [...new Set(dates.map(getWeekKey))].sort();
  if (weeks.length === 0) return { currentStreak: 0, longestStreak: 0 };

  // Parse week key back to approx Date for comparison
  const weekToDate = (wk) => {
    const [y, w] = wk.split('-W').map(Number);
    const jan4 = new Date(y, 0, 4);
    const dayOffset = (w - 1) * 7;
    return new Date(jan4.getTime() + dayOffset * 86400000);
  };

  // Compute consecutive weeks
  let longest = 1;
  let current = 1;
  for (let i = 1; i < weeks.length; i++) {
    const prevDate = weekToDate(weeks[i - 1]);
    const currDate = weekToDate(weeks[i]);
    const diffDays = Math.round((currDate - prevDate) / 86400000);

    if (diffDays <= 7) {
      current++;
    } else {
      current = 1;
    }
    if (current > longest) longest = current;
  }

  // Check if current streak extends to this week
  const now = new Date();
  const thisWeek = getWeekKey(now);
  const lastPartyWeek = weeks[weeks.length - 1];

  // Current streak = streak ending at last party week, IF it's this week or last week
  const lastDate = weekToDate(lastPartyWeek);
  const nowDate = weekToDate(thisWeek);
  const gapDays = Math.round((nowDate - lastDate) / 86400000);

  let currentStreak;
  if (gapDays <= 7) {
    // Last party was this week or last week — count backward
    currentStreak = current;
  } else {
    // Gap > 1 week — streak is broken
    currentStreak = 0;
  }

  return { currentStreak, longestStreak: longest };
}

// Export for testing
export { computeStreaks as _computeStreaks };
