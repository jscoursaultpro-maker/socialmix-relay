import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

async function detectPotentialCover(t, tracksCollection) {
  if (!t.title) return { suspected: false, likely_original_artists: [] };
  const norm = t.title.toLowerCase().replace(/\(.*?\)/g, '').trim();
  if (!norm) return { suspected: false, likely_original_artists: [] };
  const matches = await tracksCollection.find({
    _id: { $ne: t._id },
    title: new RegExp('^' + escapeRegex(norm) + '(.*?)?$', 'i'),
    artist: { $ne: t.artist },
    deezerRank: { $gt: t.deezerRank || 0 }
  }).toArray();
  
  if (matches.length > 0) {
    const likely_original_artists = matches.map(m => `${m.artist} (deezerRank ${m.deezerRank})`);
    return { suspected: true, likely_original_artists };
  }
  return { suspected: false, likely_original_artists: [] };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env manually
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')
    .filter(l => l.match(/^[A-Z]/) && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.substring(0, idx).trim(), l.substring(idx + 1).replace(/^"|"$/g, '').trim()];
    })
);

const MONGO_URI = process.env.MONGO_URI || env.MONGO_URI || env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI manquant');
  process.exit(1);
}

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    const tracksCollection = db.collection('tracks');

    const tracks = await tracksCollection
      .find({
        qualityLevel: { $nin: ['complete', 'platine'] },
        isVerified: { $ne: true },
        suggestable: { $ne: false }
      })
      .sort({ deezerRank: -1 })
      .limit(20)
      .toArray();

    const BATCH_COUNT = 2;
    const BATCH_SIZE = 10;
    const START_NUM = 19;

    for (let b = 0; b < BATCH_COUNT; b++) {
      const batchTracks = tracks.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
      if (batchTracks.length === 0) break;

      const batchNum = START_NUM + b;
      const batchNumStr = String(batchNum).padStart(3, '0');

      const batch = {
        _meta: {
          batch_number: batchNum,
          total_tracks: batchTracks.length,
        created_at: new Date().toISOString(),
        doctrine_version: "AHOUAI_DOCTRINE_PHASES v2 (14 juillet 2026)",
        sort_strategy: "deezerRank DESC (popularité prioritaire)",
        champs_qualifies_par_claude: 25
      },
      _instruction: "Tu es DJ pro expert AhOuai. Classifie ces 10 tracks selon la doctrine officielle (voir _doctrine). Renseigne l'exhaustivité des 25 champs par track. Réponds UNIQUEMENT avec le JSON { classifications: [...10 objets...] } sans texte autour, dans le format _format_reponse_par_track.\n\nSignal deezerRank + suspected_cover :\n- Si suspected_cover.suspected=true : cover redondante, phase arrival/ambiance, suggestable=false\n- Si suspected_cover.suspected=false ET deezerRank > 500000 : probablement original/remix officiel, suggestable=true\n- Si suspected_cover.suspected=false ET deezerRank < 100000 avec titre = tube connu : intuition DJ pro\n- Doctrine premium : suggestions guests = originaux uniquement, zéro déception\n\nAttention releaseDate Apple Music = date sortie sur Apple Music (souvent compilation ou remaster). Pour les tubes anciens en compilation, utilise ton jugement DJ pro pour deviner la vraie année originale (releaseYear).",
      _doctrine: {
        doctrine_reference: "DOCTRINE_PREMIUM_V2.md dans workspace Social M (14 juillet 2026)",
        regles_absolues_v2: [
          "confidence flag OBLIGATOIRE par track (high/medium/low)",
          "BPM basé sur pattern genre section 2 de la doctrine (voir DOCTRINE_PREMIUM_V2.md)",
          "Half-time/double-time correction systématique",
          "Notes DJ 3 éléments minimum (contexte artiste + usage DJ + corrections)",
          "isBanger=false par défaut si artiste inconnu (confidence=low)",
          "Pas de valeurs par défaut génériques (120 BPM, 0.78 danceability, energy 7)",
          "Auto-évaluation qualité 11 items avant validation"
        ],
        phases: {
          arrival: { role: "Apéro chic, madeleine douce", bpm: "70-110", energy: "3.5-5", exemples_banger: ["Sade Smooth Operator", "Norah Jones Don't Know Why"] },
          ambiance: { role: "Warm-up chaleureux", bpm: "80-115", energy: "5-6.5", exemples_banger: ["Marvin Gaye What's Going On", "Ed Sheeran mid-tempo"] },
          takeoff: { role: "Montée, premiers pas dansants", bpm: "100-125", energy: "6.5-7.5", exemples_banger: ["Donna Summer", "Kool & The Gang Celebration"] },
          groove: { role: "Lancé stable dancefloor", bpm: "115-130", energy: "7.5-8.5", exemples_banger: ["Sister Sledge We Are Family", "Bruno Mars Uptown Funk"] },
          party: { role: "Peak time explosion", bpm: "120-135", energy: "8.5-10", exemples_banger: ["Avicii Wake Me Up", "Guetta", "Sapés Comme Jamais"] },
          closing: { role: "Madeleine de Proust — feu d'artifice émotionnel éclectique", bpm: "flexible", energy: "flexible", exemples_banger: ["Bill Withers Lean on Me", "Queen Bohemian Rhapsody", "Piaf Non je ne regrette rien", "Journey Don't Stop Believin'"] }
        },
        regles_absolues: [
          "phaseAlternate = phase adjacente (sauf party ⇄ closing autorisé même si non adjacent stricto sensu)",
          "uiCategoriesSecondary ne contient JAMAIS uiCategoryPrimary",
          "isBanger CONTEXTUEL à la phase — banger arrival, banger closing existent. PAS de restriction phases.",
          "isFiller=true → JAMAIS isBanger=true (mutuellement exclusifs)",
          "BPM/energy alignés à la phase, MAIS closing accepte du hors-box (madeleine émotionnelle)",
          "phase 'party' (jamais 'peak')",
          "tags = array de strings libres parmi (au moins un pertinent) : peak-time, warm-up, closing, safe, risky, sing-along, romantic, memory-lane, banger-crowd, danceable, groovy",
          "partyMoment = vue simplifiée 3 phases : warm-up (arrival+ambiance+takeoff), peak (groove+party), closing (closing), ou all (universel)",
          "cooldownDays = 14 par défaut. Ajuster : hits massifs 21j, tubes plus rares 7j"
        ],
        ui_categories_9: ["Chill", "Pop", "Rock", "Rap", "Latin", "Old school", "Urban Groove", "Dance", "Électro"],
        genres_bdd_11: ["Chill", "Pop", "COCOVARIET", "Rock", "Hip-Hop", "R&B", "Latin", "Afro", "Disco", "House", "Electro"]
      },
      _format_reponse_par_track: {
        id: "<copie exacte>",
        confidence: "<high|medium|low>",
        confidence_notes: "<explication courte niveau confidence>",
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
        isFiller: "<bool — track utilitaire de comblement/transition, mutuellement exclusif avec isBanger>",
        era: "<50s|60s|70s|80s|90s|2000s|2010s|2020s>",
        releaseYear: "<int 1950-2026 ou null si inconnu>",
        mood: "<fun|emotional|aggressive|chill>",
        language: "<FR|EN|ES|PT|instrumental|autre>",
        hasLyrics: "<bool>",
        explicit: "<bool>",
        tags: ["<array strings libres — peak-time, warm-up, closing, safe, risky, sing-along, romantic, memory-lane, banger-crowd, danceable, groovy — au moins 1>"],
        partyMoment: "<warm-up|peak|closing|all>",
        cooldownDays: "<int, défaut 14, ajusté selon popularité>",
        notes: "<note DJ courte pour Jean-Sé, contexte usage>",
        suggestable: "<bool — false si cover redondante, true si original/remix officiel/artiste unique>",
        justification: "<1 ligne d'explication du choix phase + isBanger + tags principaux>"
      },
      tracks_a_classer: await Promise.all(batchTracks.map(async (t, i) => {
        const id_str = (t.providers?.deezer?.trackId && t.providers.deezer.trackId > 0) 
            ? String(t.providers.deezer.trackId) 
            : t._id.toString();

        const coverCheck = await detectPotentialCover(t, tracksCollection);

        return {
          index: i + 1,
          id: id_str,
          title: t.title || "...",
          artist: t.artist || "...",
          album: t.album || null,
          genre_actuel: t.genre || null,
          bpm_actuel: t.bpm || null,
          energy_actuel: t.energy || null,
          phase_actuelle: t.phase || null,
          uiCat_actuel: t.uiCategoryPrimary || null,
          uiSec_actuel: t.uiCategoriesSecondary || null,
          danceability_actuel: t.danceability || null,
          isBanger_actuel: t.isBanger || null,
          era_actuel: t.era || null,
          releaseYear_actuel: t.releaseYear || null,
          mood_actuel: t.mood || null,
          language_actuel: t.language || null,
          hasLyrics_actuel: t.hasLyrics || null,
          explicit_actuel: t.explicit || null,
          tags_actuels: t.tags || null,
          partyMoment_actuel: t.partyMoment || null,
          cooldownDays_actuel: t.cooldownDays || null,
          deezerRank: t.deezerRank || null,
          duration_sec: t.duration || null,
          suspected_cover: coverCheck,
          coverage_check: {
            has_deezer_id: !!t.providers?.deezer?.trackId,
            has_isrc: !!t.isrc,
            has_spotify_id: !!t.providers?.spotify?.trackId,
            has_apple_music_id: !!t.providers?.appleMusic?.trackId,
            isrc_value: t.isrc || null
          },
          appleMusicMetadata: {
            genreNames: t.appleMusicMetadata?.genreNames || [],
            releaseDate: t.appleMusicMetadata?.releaseDate || null,
            durationInMillis: t.appleMusicMetadata?.durationInMillis || 0
          }
        };
      }))
    };

    const outPath = path.join(__dirname, '..', 'batches_chatgpt', 'batch_in', `batch_in_${batchNumStr}.json`);
    fs.writeFileSync(outPath, JSON.stringify(batch, null, 2), 'utf8');
    console.log(`✅ Fichier généré avec succès : ${outPath}`);
  }
    
  } catch (err) {
    console.error('Erreur :', err);
  } finally {
    await mongoose.disconnect();
  }
})();
