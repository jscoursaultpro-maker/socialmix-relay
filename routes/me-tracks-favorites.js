/**
 * routes/me-tracks-favorites.js
 * GET /api/me/tracks/favorites?limit=6&offset=0&excludeCode=XYZ
 * Returns tracks fire-voted (🔥) by the user across ALL ended parties, paginated.
 * Auth: verifyGuestAuth (supports legacy JWT + Supabase).
 *
 * Réponse : { items: [...], total: <number>, hasMore: <bool> }
 * Compatibilité : appelants avec ?limit=20 sans offset reçoivent le même contenu
 * qu'avant (les 20 premiers) + total/hasMore en plus.
 * Tri : score Feu décroissant, puis récence (count DESC, lastVotedAt DESC).
 *
 * Fix dédupication : $limit retiré du pipeline Mongo — il était appliqué
 * AVANT la dédupication JS (comportement incorrect côté pagination).
 *
 * Lighter version of user-fire-votes.js, using verifyGuestAuth.
 *
 * ★ fix(#28) — Sécurité cross-user (calqué sur Fix #18 / Chantier C) :
 *   1. Guard strict: userEmail OU userId Mongo requis (userName seul insuffisant)
 *   2. Suppression du match _guestName global (fuite cross-parties par prénom homonyme)
 *   3. Guards $ne userEmail "" pour éviter match des votes anonymes (email vide → 3048+ votes)
 *
 * Doctrine 3.9 : quand on fixe un pattern (agrégation, guard identité), grep TOUS
 * les fichiers utilisant le même pattern avant de considérer le fix complet.
 */
import { Router } from 'express';
import { verifyGuestAuth } from '../middleware/authGuest.js';
import Party from '../models/Party.js';

const router = Router();

router.get('/tracks/favorites', verifyGuestAuth, async (req, res) => {
  try {
    const user = req.user;
    const userId = user._id.toString();
    const userName = [user.profile?.firstName, user.profile?.lastName]
      .filter(Boolean).join(' ').trim() || user.profile?.firstName || user.firstName || '';
    const userEmail = (user.email || '').toLowerCase().trim();

    // ★ fix(#28) — Guard strict : userId Mongo OU email valide requis.
    // userName seul est insuffisant : un prénom commun ("Nicolas", "Sarah") matcherait
    // TOUS les participants homonymes cross-parties → fuite de données.
    const hasValidEmail  = userEmail.length > 0;
    const hasValidUserId = /^[0-9a-f]{24}$/i.test(userId);
    if (!hasValidEmail && !hasValidUserId) {
      console.warn(`[MeTracksFavorites] ⚠️ GUARD: no valid identity (userId='${userId}' email='${userEmail}') → returning empty`);
      return res.json({ tracks: [] });
    }

    // A1 — Validation limit / offset (valeurs invalides → défaut, jamais 400)
    const rawLimit  = parseInt(req.query.limit);
    const rawOffset = parseInt(req.query.offset);
    const limit  = isNaN(rawLimit)  ? 6  : Math.min(Math.max(rawLimit, 1), 50);
    const offset = isNaN(rawOffset) ? 0  : Math.max(rawOffset, 0);
    const excludeCode = req.query.excludeCode || null;

    // Match ended parties where user participated
    // ★ fix(#28) — Ne matcher par email QUE si email non-vide, sinon on match
    // tous les participants anonymes (email="" → 3048+ votes dans la BDD).
    const emailFilter = hasValidEmail
      ? [{ 'participants.email': userEmail }, { hostEmail: userEmail }]
      : [];
    const partyMatch = {
      endedAt: { $ne: null },
      $or: [
        ...emailFilter,
        { hostUserId: userId },
        { hostUserId: user._id }
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
      // Extract fire voted titles for this user
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
                          // ★ fix(#28) — Clause host : guard $ne "" sur hostEmail
                          { $and: [
                              { $eq: ["$$gv.k", "host"] },
                              { $or: [
                                  // hostEmail : seulement si email non-vide
                                  { $and: [{ $ne: [userEmail, ""] }, { $eq: ["$hostEmail", userEmail] }] },
                                  { $eq: [{ $toString: "$hostUserId" }, userId] }
                              ]}
                          ]},
                          // Clause socketId direct
                          { $eq: ["$$gv.k", userId] },
                          // ★ fix(#28) — _guestName SUPPRIMÉ : match global par prénom
                          // "Nicolas" matchait TOUS les Nicolas cross-parties.
                          // L'identification doit passer par userId ou email uniquement.
                          // Clause participants.email : guard $ne "" pour éviter match anonymes
                          { $in: ["$$gv.k", {
                              $map: {
                                input: {
                                  $filter: {
                                    input: { $ifNull: ["$participants", []] },
                                    as: "p",
                                    // ★ fix(#28) — guard email vide
                                    cond: { $and: [{ $ne: [userEmail, ""] }, { $eq: ["$$p.email", userEmail] }] }
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
      // Only parties with fire votes
      { $match: { "fireTrackTitles.0": { $exists: true } } },
      // Filter trackHistory to only fire-voted tracks
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
      { $project: { trackHistory: 0 } },
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
      { $sort: { count: -1, lastVotedAt: -1 } }
      // Pas de $limit ici — la dédupication JS doit voir tous les résultats
    ];

    const aggResult = await Party.aggregate(aggPipeline);

    // Dedup
    const normalizeText = (text) => {
      if (!text) return "";
      let s = String(text).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
      s = s.replace(/[\(\[].*?[\)\]]/g, "");
      s = s.replace(/\b(feat\.?|ft\.?|remix|edit|version|remaster|master)\b.*/g, "");
      return s.trim();
    };

    const dedupMap = new Map();
    for (const track of aggResult) {
      const key = `${normalizeText(track.title)}|${normalizeText(track.artist)}`;
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
        if (!existing.coverURL && track.coverURL) existing.coverURL = track.coverURL;
      }
    }

    let allTracks = Array.from(dedupMap.values());
    allTracks.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return new Date(b.lastVotedAt) - new Date(a.lastVotedAt);
    });

    // A1 — Pagination après dédupication
    const total   = allTracks.length;
    const items   = allTracks.slice(offset, offset + limit).map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      deezerID: t.deezerID,
      artworkUrl: t.coverURL || null,
      count: t.count
    }));
    const hasMore = offset + items.length < total;

    console.log(`[me/tracks/favorites] user=${userName} limit=${limit} offset=${offset} → ${items.length}/${total} (hasMore=${hasMore}, took ${Date.now() - startAgg}ms)`);
    return res.json({ items, total, hasMore });
  } catch (err) {
    console.error('[me/tracks/favorites] ❌ Error:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
