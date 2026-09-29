/**
 * routes/djbrain-lite.js
 * ★ feat(host-web) — Sélection provisoire de titres pour le cockpit hôte web.
 *
 * PROVISOIRE — sera remplacé par le DJ Brain serveur (scoring complet).
 * Contrat de réponse stable : [{trackId, title, artist, spotifyUri, durationMs}]
 *
 * GET /api/djbrain-lite/next?partyCode=X&count=5&phase=arrival
 *   → jusqu'à `count` titres de la BDD ayant un providers.spotify.trackId,
 *     phase donnée (défaut: arrival), triés par qualityLevel desc puis aléatoire,
 *     en excluant les titres déjà joués dans la soirée (party.trackHistory).
 *
 * Aucune règle de scoring inventée : filtre + tri qualityLevel uniquement.
 */

import { Router } from 'express';
import Track from '../models/Track.js';

const router = Router();

// qualityLevel → poids pour tri (identique à server.js QUALITY_ORDER)
const QUALITY_WEIGHT = { platine: 4, complete: 3, partielle: 2, vide: 1 };

router.get('/next', async (req, res) => {
  try {
    const partyCode = (req.query.partyCode || '').toUpperCase();
    const count     = Math.min(parseInt(req.query.count) || 5, 20);
    const phase     = req.query.phase || 'arrival';

    // Récupérer la party depuis le RAM store (accessible via app.get('parties'))
    const parties = req.app.get('parties');
    const party   = partyCode ? parties?.get(partyCode) : null;

    // Titres déjà joués cette soirée (exclure par titre normalisé)
    const playedTitles = new Set(
      (party?.trackHistory || []).map(t => (t.title || '').toLowerCase().trim())
    );

    // ── Filtres ──────────────────────────────────────────────────────────────
    const filter = {
      'providers.spotify.trackId': { $exists: true, $ne: null, $ne: '' },
      isBlocked:   { $ne: true },
      suggestable: { $ne: false }
    };

    // Phase : si 'arrival', utiliser le filtre standard, sinon laisser ouvert
    // (PROVISOIRE : pas de logique de phase complexe, juste le champ phase si présent)
    if (phase && phase !== 'any') {
      // Inclure tracks sans phase (older records) + tracks de la phase cible
      filter.$or = [{ phase }, { phase: { $exists: false } }, { phase: null }];
    }

    // Limiter à qualityLevel connu (ne pas remonter des tracks sans metadata)
    filter.qualityLevel = { $in: ['platine', 'complete', 'partielle'] };

    // ── Query ─────────────────────────────────────────────────────────────────
    // Fetch plus de résultats pour pouvoir exclure déjà joués + shuffler
    const raw = await Track.find(filter)
      .sort({ qualityLevel: -1, 'performance.feuRatio': -1 })
      .limit(count * 8)   // pool large pour exclusion + shuffle
      .select('title artist durationMs qualityLevel providers.spotify.trackId coverArtURL')
      .lean();

    // ── Post-processing ───────────────────────────────────────────────────────
    const eligible = raw
      .filter(t => !playedTitles.has((t.title || '').toLowerCase().trim()))
      .filter(t => t.providers?.spotify?.trackId);

    // Shuffle dans chaque niveau de qualité (Fisher-Yates partiel)
    const shuffled = _shuffleByQuality(eligible);

    // Limiter au count demandé
    const result = shuffled.slice(0, count).map(t => ({
      trackId:    t._id.toString(),
      title:      t.title,
      artist:     t.artist,
      spotifyUri: `spotify:track:${t.providers.spotify.trackId}`,
      durationMs: t.durationMs || 0,
      coverArtURL: t.coverArtURL || null,
      qualityLevel: t.qualityLevel,
      // PROVISOIRE : pas de score, pas de recommandation contextuelle
      _source: 'djbrain-lite'
    }));

    console.log(`[djbrain-lite] /next partyCode=${partyCode} phase=${phase} → ${result.length} tracks (pool ${eligible.length})`);

    res.json({
      tracks:    result,
      count:     result.length,
      phase,
      partyCode: partyCode || null,
      _note:     'PROVISOIRE — sera remplacé par DJ Brain serveur. Contrat stable : [{trackId, title, artist, spotifyUri, durationMs}]',
      generatedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('[djbrain-lite] /next error:', err.message);
    res.status(500).json({ error: 'djbrain-lite error', message: err.message });
  }
});

// ─── Utils ────────────────────────────────────────────────────────────────────

/**
 * Shuffle les tracks en préservant l'ordre de priorité inter-niveaux.
 * Platine avant Complete avant Partielle, mais ordre aléatoire au sein de chaque niveau.
 */
function _shuffleByQuality(tracks) {
  // Grouper par qualityLevel
  const groups = {};
  tracks.forEach(t => {
    const lvl = t.qualityLevel || 'vide';
    if (!groups[lvl]) groups[lvl] = [];
    groups[lvl].push(t);
  });

  // Shuffler chaque groupe (Fisher-Yates)
  Object.values(groups).forEach(arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  });

  // Réassembler en ordre de qualité décroissant
  return ['platine', 'complete', 'partielle', 'vide']
    .flatMap(lvl => groups[lvl] || []);
}

export default router;
