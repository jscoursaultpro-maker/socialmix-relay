import express from 'express';
import Track from '../../models/Track.js';

const router = express.Router();

// POST /api/admin/batch/generate
// Generates a batch JSON payload of unqualified tracks ready for Claude/ChatGPT classification
router.post('/generate', async (req, res) => {
  const limit = Math.min(parseInt(req.body.limit) || 10, 30);

  try {
    const tracks = await Track.find({
      qualityLevel: { $nin: ['complete', 'platine'] },
      isVerified: { $ne: true },
      suggestable: { $ne: false }
    })
    .sort({ 'performance.totalPlays': -1, deezerRank: -1, createdAt: -1 })
    .limit(limit)
    .lean();

    if (!tracks.length) {
      return res.json({ batch: null, message: 'Toutes les tracks sont qualifiées ✅', count: 0 });
    }

    const batch = {
      _meta: {
        total_tracks: tracks.length,
        created_at: new Date().toISOString(),
        doctrine_version: "AHOUAI_DOCTRINE_PHASES v2 (14 juillet 2026)"
      },
      _instruction: `Tu es DJ pro expert AhOuai. Classifie ces ${tracks.length} tracks selon la doctrine officielle (voir _doctrine). Renseigne l'exhaustivité des 25 champs par track. Réponds UNIQUEMENT avec le JSON { classifications: [...${tracks.length} objets...] } sans texte autour, dans le format _format_reponse_par_track.`,
      _doctrine: {
        phases: {
          arrival:  { role: "Apéro chic, madeleine douce", bpm: "70-110", energy: "3.5-5" },
          ambiance: { role: "Warm-up chaleureux", bpm: "80-115", energy: "5-6.5" },
          takeoff:  { role: "Montée, premiers pas dansants", bpm: "100-125", energy: "6.5-7.5" },
          groove:   { role: "Lancé stable dancefloor", bpm: "115-130", energy: "7.5-8.5" },
          party:    { role: "Peak time explosion", bpm: "120-135", energy: "8.5-10" },
          closing:  { role: "Madeleine de Proust — feu d'artifice émotionnel éclectique", bpm: "flexible", energy: "flexible" }
        },
        regles: [
          "phaseAlternate = phase adjacente",
          "uiCategoriesSecondary ne contient JAMAIS uiCategoryPrimary",
          "isBanger CONTEXTUEL à la phase",
          "isFiller=true → JAMAIS isBanger=true",
          "BPM/energy alignés à la phase, closing accepte du hors-box",
          "phase 'party' (jamais 'peak')",
          "cooldownDays = 14 par défaut. Hits massifs 21j, tubes rares 7j"
        ],
        ui_categories_9: ["Chill", "Pop", "Rock", "Rap", "Latin", "Old school", "Urban Groove", "Dance", "Électro"],
        genres_bdd_11: ["Chill", "Pop", "COCOVARIET", "Rock", "Hip-Hop", "R&B", "Latin", "Afro", "Disco", "House", "Electro"]
      },
      _format_reponse_par_track: {
        id: "<copie exacte>",
        confidence: "<high|medium|low>",
        genreBDD: "<parmi 11 genres BDD>",
        uiCategoryPrimary: "<parmi 9 UI categories>",
        uiCategoriesSecondary: ["<0-2 catégories jamais = uiCategoryPrimary>"],
        phase: "<arrival|ambiance|takeoff|groove|party|closing>",
        phaseAlternate: "<phase adjacente>",
        energy: "<int 1-10>",
        bpm: "<int 60-220>",
        danceability: "<float 0.0-1.0>",
        isBanger: "<bool>",
        isSingalong: "<bool>",
        isEmotional: "<bool>",
        isCaliente: "<bool>",
        isHardcore: "<bool>",
        isFiller: "<bool>",
        era: "<50s|60s|70s|80s|90s|2000s|2010s|2020s>",
        releaseYear: "<int 1950-2026 ou null>",
        mood: "<fun|emotional|aggressive|chill>",
        language: "<FR|EN|ES|PT|instrumental|autre>",
        hasLyrics: "<bool>",
        explicit: "<bool>",
        tags: ["<peak-time|warm-up|closing|safe|risky|sing-along|romantic|memory-lane|banger-crowd|danceable|groovy>"],
        partyMoment: "<warm-up|peak|closing|all>",
        cooldownDays: "<int>",
        suggestable: "<bool>",
        notes: "<note DJ courte>"
      },
      tracks_a_classer: tracks.map((t, i) => ({
        index: i + 1,
        id: t._id.toString(),
        title: t.title || "...",
        artist: t.artist || "...",
        album: t.album || null,
        genre_actuel: t.genre || null,
        bpm_actuel: t.bpm || null,
        energy_actuel: t.energy || null,
        phase_actuelle: t.phase || null,
        deezerRank: t.deezerRank || null,
        source: t.source || null
      }))
    };

    console.log(`[Batch] ✅ Generated batch for ${tracks.length} unqualified tracks`);
    res.json({ batch, count: tracks.length });
  } catch (err) {
    console.error('[Batch] ❌ generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/batch/import
// Imports Claude/ChatGPT classification results back into MongoDB
router.post('/import', async (req, res) => {
  const { classifications } = req.body;
  if (!Array.isArray(classifications) || !classifications.length) {
    return res.status(400).json({ error: 'classifications array required' });
  }

  const FIELDS = [
    'uiCategoryPrimary', 'uiCategoriesSecondary', 'phase', 'phaseAlternate',
    'energy', 'bpm', 'danceability', 'isBanger', 'isSingalong', 'isEmotional',
    'isCaliente', 'isHardcore', 'isFiller', 'era', 'releaseYear', 'mood',
    'language', 'hasLyrics', 'explicit', 'tags', 'partyMoment', 'cooldownDays',
    'notes', 'suggestable', 'confidence'
  ];

  let updated = 0, notFound = 0, errors = 0;

  for (const c of classifications) {
    try {
      if (!c.id) { errors++; continue; }

      const $set = { classifiedBy: 'claude_batch_hub', adminQualified: true };
      if (c.genreBDD) $set.genre = c.genreBDD;
      for (const f of FIELDS) {
        if (c[f] !== undefined && c[f] !== null) $set[f] = c[f];
      }

      const result = await Track.updateOne({ _id: c.id }, { $set });
      if (result.matchedCount > 0) {
        updated++;
      } else {
        notFound++;
        console.warn(`[Batch Import] Track not found: ${c.id}`);
      }
    } catch (err) {
      errors++;
      console.error(`[Batch Import] Error updating ${c.id}:`, err.message);
    }
  }

  console.log(`[Batch Import] ✅ Updated: ${updated}, NotFound: ${notFound}, Errors: ${errors}`);
  res.json({ updated, notFound, errors, total: classifications.length });
});

export default router;
