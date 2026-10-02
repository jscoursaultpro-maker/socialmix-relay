/**
 * services/djbrain/crossPartyFreshness.js
 * ★ DJ Brain Cloud — Fresh Rotation cross-party N=8, map keyée par Track._id.
 *
 * Port 1:1 de la doctrine lockée 14/08 (Task #121) déjà en prod sur
 * `/api/tracks/freshness/:hostUserId?v=2`. Même agrégation, mêmes constantes,
 * même fix Bug H (sécurité temporelle power-users). La SEULE différence : la map
 * est ré-encodée par `trackId` (ObjectId → String) et NON par deezerId, parce que
 * le scorer cloud (services/djbrain/scoring.js) clé `freshness[String(track._id)]`.
 * AUCUNE constante de doctrine n'est modifiée.
 */

import mongoose from 'mongoose';
import HostPlaybackHistory from '../../models/HostPlaybackHistory.js';
import Party from '../../models/Party.js';
import { computeFreshnessScore } from '../freshnessScoring.js';

/** Fenêtre LRU cross-soirées (métrique = soirées, pas jours). Doctrine lockée 14/08. */
export const CROSS_PARTY_WINDOW = 8;
/** Fix Bug H (04/09) — sécurité temporelle pour hosts power-users (>8 soirées/semaine). */
const STALENESS_TEMPORAL_FALLBACK_DAYS = 14;
const MS_IN_DAY = 24 * 3600 * 1000;

/**
 * Construit la map de fraîcheur cross-party d'un hôte, keyée par Track._id (String).
 * Isolation stricte par hostUserId (Michel ≠ Éric).
 *
 * @param {string|mongoose.Types.ObjectId} hostUserId
 * @param {object} [opts]
 * @param {number} [opts.nowMs=Date.now()]
 * @returns {Promise<Object>} { [String(trackId)]: { freshnessScore (0-100), partyStaleness (1-8 ou 999) } }
 */
export async function buildCrossPartyFreshness(hostUserId, opts = {}) {
  const nowMs = opts.nowMs || Date.now();
  if (!hostUserId) return {};

  // hostUserId peut être stocké string OU ObjectId selon l'âge de la donnée (fix 20/08).
  const variants = [String(hostUserId)];
  try { variants.push(new mongoose.Types.ObjectId(String(hostUserId))); } catch (_) {}

  // Dernière lecture par trackId, toutes soirées confondues (sort-first → $first exact).
  const history = await HostPlaybackHistory.aggregate([
    { $match: { hostUserId: { $in: variants }, trackId: { $ne: null } } },
    { $sort: { playedAt: -1 } },
    { $group: {
      _id: '$trackId',
      lastPlayedAt: { $first: '$playedAt' },
      lastPartyId: { $first: '$partyId' },
    } },
  ]);
  if (!history.length) return {};

  // N=8 dernières soirées du host → index de staleness (1 = la plus récente … 8 = 8ème).
  const recentParties = await Party.find({ hostUserId: { $in: variants } })
    .sort({ createdAt: -1 })
    .limit(CROSS_PARTY_WINDOW)
    .select('_id')
    .lean();
  const partyIndexMap = {};
  recentParties.forEach((p, idx) => { partyIndexMap[p._id.toString()] = idx + 1; });

  const map = {};
  for (const item of history) {
    if (!item._id) continue;
    const trackId = item._id.toString();
    const daysAgo = (nowMs - new Date(item.lastPlayedAt).getTime()) / MS_IN_DAY;
    const freshnessScore = computeFreshnessScore(daysAgo);

    // partyStaleness : position du lastPartyId dans les N=8 dernières soirées.
    //   1 = joué dans la + récente (malus max iOS) … 8 = 8ème (malus faible)
    //   999 = hors fenêtre / jamais joué = fresh (pas de malus)
    const lastPartyIdStr = item.lastPartyId ? item.lastPartyId.toString() : null;
    let partyStaleness = (lastPartyIdStr && partyIndexMap[lastPartyIdStr] !== undefined)
      ? partyIndexMap[lastPartyIdStr]
      : 999;

    // Fix Bug H — si track jouée < 14j mais hors fenêtre N=8 (host qui teste beaucoup),
    // forcer un staleness proportionnel pour préserver le malus (évite le replay inlassable).
    if (partyStaleness === 999 && daysAgo < STALENESS_TEMPORAL_FALLBACK_DAYS) {
      partyStaleness = Math.max(1, Math.min(8, Math.round(1 + (daysAgo * 7 / STALENESS_TEMPORAL_FALLBACK_DAYS))));
    }

    map[trackId] = { freshnessScore, partyStaleness };
  }
  return map;
}
