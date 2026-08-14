// services/voteReconciliation.js
// Task #114 (bis) — Cron réconciliation Party.guestVotes → Track.performance
//
// Contourne la volatilité de pendingRatings (RAM only, perdu au redémarrage server).
// Recalcule Track.performance.ratings + feuRatio EN 100% IDEMPOTENT depuis
// Party.guestVotes persistants. Peut être re-run sans risque, écrase les valeurs.
//
// Doctrine appliquée (mémoire host-is-guest 14/08) :
//   - Les votes `guest:host` sont COMPTÉS comme n'importe quel vote guest
//   - Aucun filtrage par identité du votant
//
// Résolution trackKey (title → isrc) :
//   1. Cherche dans party.trackHistory (post-fix trackDoc a isrc)
//   2. Fallback dans party.suggestions (post-backfill 14/08 a isrc)
//   3. Sinon vote orphelin (compté dans notFound)

import Party from '../models/Party.js';
import Track from '../models/Track.js';

/**
 * Réconcilie tous les votes des parties récentes vers Track.performance.
 *
 * @param {Object} opts
 * @param {Date}   [opts.since=null]     Filtre parties (createdAt >=). Défaut : toutes.
 * @param {boolean}[opts.dryRun=false]   Si true, calcule sans écrire.
 * @returns {Promise<Object>} Rapport { partiesScanned, trackRatingsCount, updated, notFound, dryRun, executedAt }
 */
export async function reconcileAllVotes({ since = null, dryRun = false } = {}) {
  const filter = since ? { createdAt: { $gte: since } } : {};
  const parties = await Party.find(filter)
    .select('code guestVotes trackHistory suggestions')
    .lean();

  // Aggregate votes par ISRC (source de vérité pour Track catalogue)
  // Map<isrc, { isrc, title, artist, feu, cool, bof, sources }>
  const trackRatings = new Map();
  let voteOrphans = 0;

  for (const party of parties) {
    // ── Build title → trackMeta index (trackHistory prioritaire, suggestions fallback)
    const titleIndex = new Map();
    for (const t of (party.trackHistory || [])) {
      if (!t.title) continue;
      const key = t.title.toLowerCase().trim();
      if (!titleIndex.has(key)) {
        titleIndex.set(key, {
          isrc: t.isrc || null,
          deezerID: t.deezerId || t.deezerID || null,
          artist: t.artist || '',
          source: 'trackHistory'
        });
      }
    }
    for (const s of (party.suggestions || [])) {
      if (!s.title) continue;
      const key = s.title.toLowerCase().trim();
      if (!titleIndex.has(key)) {
        titleIndex.set(key, {
          isrc: s.isrc || null,
          deezerID: s.deezerID || s.deezerId || null,
          artist: s.artist || '',
          source: 'suggestion'
        });
      }
    }

    // ── Iterate votes (inclut guest:host — doctrine host-is-guest 14/08)
    const gv = party.guestVotes || {};
    for (const [_guestId, tracks] of Object.entries(gv)) {
      for (const [voteTitle, vote] of Object.entries(tracks || {})) {
        const key = (voteTitle || '').toLowerCase().trim();
        const meta = titleIndex.get(key);
        if (!meta || !meta.isrc) {
          voteOrphans++;
          continue;
        }
        if (!trackRatings.has(meta.isrc)) {
          trackRatings.set(meta.isrc, {
            isrc: meta.isrc,
            title: voteTitle,
            artist: meta.artist,
            feu: 0, cool: 0, bof: 0,
            sourcesSeen: new Set()
          });
        }
        const r = trackRatings.get(meta.isrc);
        r.sourcesSeen.add(meta.source);
        if (vote === 'fire') r.feu++;
        else if (vote === 'like') r.cool++;
        else if (vote === 'meh') r.bof++;
      }
    }
  }

  // ── Rebuild Track.performance FROM SCRATCH (idempotent)
  let updated = 0;
  let notFound = 0;
  for (const r of trackRatings.values()) {
    const total = r.feu + r.cool + r.bof;
    if (total === 0) continue;
    const feuRatio = r.feu / total;

    if (dryRun) {
      updated++;
      continue;
    }

    try {
      const result = await Track.updateOne(
        { isrc: r.isrc },
        {
          $set: {
            'performance.ratings.feu': r.feu,
            'performance.ratings.cool': r.cool,
            'performance.ratings.bof': r.bof,
            'performance.feuRatio': feuRatio,
          }
        }
      );
      if (result.matchedCount === 0) notFound++;
      else updated++;
    } catch (err) {
      notFound++;
      console.error(`[VoteReconciliation] ❌ ${r.isrc}: ${err.message}`);
    }
  }

  return {
    partiesScanned: parties.length,
    trackRatingsCount: trackRatings.size,
    updated,
    notFound,
    voteOrphans,
    dryRun,
    executedAt: new Date().toISOString()
  };
}
