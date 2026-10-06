/**
 * routes/user-fire-votes.js
 * ★ GET /api/user/me/fire-votes
 * Returns tracks fire-voted by the user cross-parties.
 *
 * ★ fix(#18) — Sécurité cross-user:
 *   1. Guard strict: userEmail OU userId Mongo 24-char requis (plus || !userName)
 *   2. Suppression du match _guestName global (source de fuite cross-user par prénom commun)
 *   3. Guards contre userEmail="" dans les $eq Mongo (évite match des 3048 votes anonymes)
 */
import { Router } from 'express';
import Party from '../models/Party.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';
import { enrichArtwork } from '../services/deezerArtwork.js';

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

    const _idStr = currentUser._id.toString();

    // ★ fix(#18) — GUARD SÉCURITÉ CROSS-USER
    // Identité forte = email non-vide OU userId Mongo valide (24 hex chars)
    // Avant : if (!userEmail && !userName) → userName vide passait guard si email="",
    //         exposant les votes anonymes et les homonymes cross-parties.
    const hasValidEmail  = userEmail.length > 0;
    const hasValidUserId = /^[0-9a-f]{24}$/i.test(_idStr);

    if (!hasValidEmail && !hasValidUserId) {
      console.warn(`[UserFireVotes] ⚠️ GUARD: no valid identity (email="${userEmail}", userId="${_idStr}") → returning empty`);
      return res.json({ fireVotes: [] });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 15, 1), 500);
    const excludeCode = req.query.excludeCode;

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
    // ★ fix(#18): conditionne chaque clause email sur hasValidEmail pour éviter match chaîne vide
    const partyMatchOr = [
      hasValidEmail ? { 'participants.email': userEmail } : null,
      hasValidEmail ? { hostEmail: userEmail }            : null,
      { hostUserId: _idStr },
      { hostUserId: currentUser._id }
    ].filter(Boolean);

    const partyMatch = { $or: partyMatchOr };
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
                          // Clause 1: key === "host" ET (email exact non-vide OU userId exact)
                          // ★ fix(#18): $and avec $ne ["", userEmail] évite le match email vide
                          { $and: [
                              { $eq: ["$$gv.k", "host"] },
                              { $or: [
                                  // Email match: seulement si userEmail non-vide
                                  { $and: [
                                      { $ne: [userEmail, ""] },
                                      { $eq: ["$hostEmail", userEmail] }
                                  ]},
                                  // UserId match: toujours safe (24-char Mongo ID)
                                  { $eq: [{ $toString: "$hostUserId" }, _idStr] }
                              ]}
                          ]},
                          // Clause 2: key === userId exact (24-char Mongo ID, toujours safe)
                          { $eq: ["$$gv.k", _idStr] },
                          // Clause 3: key est un userId de participant dont l'email == userEmail
                          // ★ fix(#18): guard userEmail non-vide DANS la condition $filter participants
                          // ★ fix(#18): SUPPRIMÉ { $eq: ["$$gv.v._guestName", userName] }
                          //   → source de fuite cross-user: "Nicolas" matchait TOUS les Nicolas
                          { $in: ["$$gv.k", {
                              $map: {
                                input: {
                                  $filter: {
                                    input: { $ifNull: ["$participants", []] },
                                    as: "p",
                                    cond: {
                                      // ★ fix(#18): guard chaîne vide — $and avec $ne userEmail ""
                                      $and: [
                                        { $ne: [userEmail, ""] },
                                        { $eq: ["$$p.email", userEmail] }
                                      ]
                                    }
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

    fireVotes = await enrichArtwork(fireVotes.slice(0, limit));

    console.log(`[UserFireVotes] user=${userName} email=${userEmail} hasValidEmail=${hasValidEmail} hasValidUserId=${hasValidUserId} → agg ${aggResult.length} tracks, deduped ${fireVotes.length} tracks (took ${Date.now() - startAgg}ms)`);
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
