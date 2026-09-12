/**
 * routes/user-fire-votes.js
 * ★ GET /api/user/me/fire-votes
 * Returns tracks fire-voted by the user cross-parties.
 */
import { Router } from 'express';
import Party from '../models/Party.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

const router = Router();

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'AUTH_MISSING', message: 'Authorization: Bearer <token> required' });
    }
    const token = authHeader.slice(7);
    const payload = await verifySupabaseJWT(token);
    const user = await findOrCreateFromSupabase(payload);
    req.currentUser = user;
    next();
  } catch (err) {
    if (err.name === 'AuthError') {
      return res.status(401).json({ error: 'AUTH_FAILED', message: err.message });
    }
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = req.currentUser;
    const userEmail = (currentUser.email || '').toLowerCase().trim();
    const userName = [currentUser.profile?.firstName, currentUser.profile?.lastName]
      .filter(Boolean).join(' ').trim() || currentUser.profile?.firstName || '';

    if (!userEmail && !userName) {
      return res.json({ fireVotes: [] });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 15, 1), 500);
    const excludeCode = req.query.excludeCode;
    const _idStr = currentUser._id.toString();

    // Helper: Normalize text for deduplication
    const normalizeText = (text) => {
      if (!text) return "";
      let s = String(text);
      s = s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
      s = s.replace(/[\(\[].*?[\)\]]/g, ""); // Strip anything in parentheses/brackets
      s = s.replace(/\b(feat\.?|ft\.?|remix|edit|version|remaster|master)\b.*/g, "");
      return s.trim();
    };

    // Build match condition for parties where this user participated
    const partyMatch = {
      $or: [
        { 'participants.email': userEmail },
        { hostEmail: userEmail },
        { hostUserId: _idStr },
        { hostUserId: currentUser._id }
      ].filter(Boolean)
    };
    if (excludeCode) {
      partyMatch.code = { $ne: excludeCode };
    }

    const startAgg = Date.now();
    const aggPipeline = [
      { $match: partyMatch },
      {
        $project: {
          createdAt: 1,
          hostEmail: 1,
          hostUserId: 1,
          participants: 1,
          guestVotesArray: { $objectToArray: { $ifNull: ["$guestVotes", {}] } },
          "trackHistory.title": 1,
          "trackHistory.artist": 1,
          "trackHistory.deezerId": 1,
          "trackHistory.trackId": 1,
          "trackHistory.albumArtworkURL": 1,
          "trackHistory.coverURL": 1
        }
      },
      // Extract fire voted titles for this user BEFORE unwind
      {
        $addFields: {
          fireTrackTitles: {
            $reduce: {
              input: {
                $map: {
                  input: {
                    $filter: {
                      input: "$guestVotesArray",
                      as: "gv",
                      cond: {
                        $or: [
                          { $and: [
                              { $eq: ["$$gv.k", "host"] },
                              { $or: [
                                  { $eq: ["$hostEmail", userEmail] },
                                  { $eq: [{ $toString: "$hostUserId" }, _idStr] }
                              ]}
                          ]},
                          { $eq: ["$$gv.k", _idStr] },
                          { $eq: ["$$gv.v._guestName", userName] },
                          { $in: ["$$gv.k", {
                              $map: {
                                input: {
                                  $filter: {
                                    input: { $ifNull: ["$participants", []] },
                                    as: "p",
                                    cond: { $eq: ["$$p.email", userEmail] }
                                  }
                                },
                                as: "pMatch",
                                in: { $ifNull: ["$$pMatch.userId", "$$pMatch.id"] }
                              }
                          }]}
                        ]
                      }
                    }
                  },
                  as: "validGv",
                  in: {
                    $map: {
                      input: {
                        $filter: {
                          input: { $objectToArray: "$$validGv.v" },
                          as: "voteItem",
                          cond: { $in: ["$$voteItem.v", ["fire", "feu"]] }
                        }
                      },
                      as: "fireItem",
                      in: { $toLower: { $trim: { input: "$$fireItem.k" } } }
                    }
                  }
                }
              },
              initialValue: [],
              in: { $concatArrays: ["$$value", "$$this"] }
            }
          }
        }
      },
      // Filter out parties where the user didn't fire vote any tracks
      { $match: { "fireTrackTitles.0": { $exists: true } } },
      // Filter trackHistory array BEFORE unwind to only keep fire voted tracks!
      {
        $addFields: {
          filteredTrackHistory: {
            $filter: {
              input: { $ifNull: ["$trackHistory", []] },
              as: "t",
              cond: {
                $in: [ 
                  { $toLower: { $trim: { input: { $ifNull: ["$$t.title", ""] } } } }, 
                  "$fireTrackTitles" 
                ]
              }
            }
          }
        }
      },
      { $project: { trackHistory: 0 } }, // Save memory
      { $unwind: "$filteredTrackHistory" },
      {
        $group: {
          _id: {
            $cond: {
              if: { $and: [
                { $ne: [{ $type: "$filteredTrackHistory.deezerId" }, "missing"] },
                { $ne: [{ $type: "$filteredTrackHistory.deezerId" }, "null"] }
              ]},
              then: { $toString: "$filteredTrackHistory.deezerId" },
              else: {
                $concat: [
                  { $toLower: { $trim: { input: { $ifNull: ["$filteredTrackHistory.title", "Inconnu"] } } } },
                  "|",
                  { $toLower: { $trim: { input: { $ifNull: ["$filteredTrackHistory.artist", "Artiste inconnu"] } } } }
                ]
              }
            }
          },
          id: { $first: { $ifNull: [{ $toString: "$filteredTrackHistory.deezerId" }, "$filteredTrackHistory.trackId", "$_id"] } },
          title: { $first: "$filteredTrackHistory.title" },
          artist: { $first: "$filteredTrackHistory.artist" },
          deezerID: { $first: "$filteredTrackHistory.deezerId" },
          coverURL: { $first: { $ifNull: ["$filteredTrackHistory.albumArtworkURL", "$filteredTrackHistory.coverURL"] } },
          count: { $sum: 1 },
          lastVotedAt: { $max: "$createdAt" }
        }
      },
      { $match: { 
          title: { $nin: ["Titre en cours", "Artiste inconnu", null] },
          artist: { $ne: "Artiste inconnu" }
      }},
      { $sort: { count: -1, lastVotedAt: -1 } },
      { $limit: limit }
    ];

    const aggResult = await Party.aggregate(aggPipeline);

    // Deduping the result from MongoDB
    const dedupMap = new Map();
    for (const track of aggResult) {
      const normTitle = normalizeText(track.title);
      const normArtist = normalizeText(track.artist);
      const key = `${normTitle}|${normArtist}`;

      if (!dedupMap.has(key)) {
        dedupMap.set(key, { ...track });
      } else {
        const existing = dedupMap.get(key);
        existing.count += track.count;
        if (new Date(track.lastVotedAt) > new Date(existing.lastVotedAt)) {
          existing.lastVotedAt = track.lastVotedAt;
          existing.title = track.title;
          existing.artist = track.artist;
        }
        if (!existing.coverURL && track.coverURL) {
          existing.coverURL = track.coverURL;
        }
      }
    }

    let fireVotes = Array.from(dedupMap.values());
    fireVotes.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return new Date(b.lastVotedAt) - new Date(a.lastVotedAt);
    });

    fireVotes = fireVotes.slice(0, limit);

    console.log(`[UserFireVotes] user=${userName} email=${userEmail} → agg ${aggResult.length} tracks, deduped ${fireVotes.length} tracks (took ${Date.now() - startAgg}ms)`);
    return res.json({ fireVotes: fireVotes.map(fv => ({
      id: fv.id, title: fv.title, artist: fv.artist,
      deezerID: fv.deezerID, coverURL: fv.coverURL,
      count: fv.count
    })) });
  } catch (err) {
    console.error('[UserFireVotes] ❌ Error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
