/**
 * rebuild-metadata.mjs
 * ═══════════════════════════════════════════════════════════════
 * SOURCE DE VÉRITÉ : curated_base_v3.json
 *
 * Ce script reconstruit track_metadata.json (embarqué dans l'app iOS)
 * à partir de curated_base_v3.json (la base curée via le monitor).
 *
 * WORKFLOW :
 *   1. Corrections dans le monitor (sur Render)
 *   2. Cliquer "⬇️ Exporter DB" dans le monitor
 *   3. Remplacer relay-server/curated_base_v3.json par le fichier téléchargé
 *   4. node relay-server/rebuild-metadata.mjs
 *   5. git add -A && git commit -m "chore: Sync curated DB" && git push
 *   6. Xcode → Clean Build Folder (Shift+Cmd+K) + Run (Cmd+R)
 * ═══════════════════════════════════════════════════════════════
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CURATED_PATH  = path.join(__dirname, 'curated_base_v3.json');
const METADATA_PATH = path.join(__dirname, '../SocialMixApp/SocialMixApp/Resources/track_metadata.json');

// ─── Normalisation des genres (synchronisée avec DJBrain.swift) ───
const GENRE_NORM = {
  'deep house': 'House', 'progressive house': 'House', 'tech house': 'House',
  'tropical house': 'House', 'future house': 'House', 'tribal house': 'House',
  'nu-disco': 'Disco', 'funk': 'Disco', 'funk/soul': 'Disco', 'funk / soul': 'Disco',
  'dance-pop': 'Electro', 'eurodance': 'Electro', 'trance': 'Electro',
  'techno': 'Electro', 'electro house': 'Electro',
  'hip hop': 'Hip-Hop', 'trap': 'Hip-Hop', 'drum n bass': 'Hip-Hop',
  'r&b': 'R&B', 'contemporary r&b': 'R&B',
  'reggaeton': 'Latin', 'bachata': 'Latin', 'guaracha': 'Latin', 'reggae': 'Latin',
  'afrobeat': 'Afro', 'afro house': 'Afro',
  'pop rock': 'Pop', 'synth-pop': 'Pop', 'k-pop': 'Pop',
  'alternative rock': 'Rock',
  'ambient': 'Chill', 'jazz': 'Jazz',
  'chanson': 'COCOVARIET', 'variété fr': 'COCOVARIET',
  'folk, world, & country': 'COCOVARIET',
};
function normalizeGenre(g) {
  if (!g) return '';
  const key = g.trim().toLowerCase();
  return GENRE_NORM[key] || g;
}

// ─── Genres valides pour l'app ───
const VALID_GENRES = new Set([
  'House', 'Electro', 'Disco', 'Pop', 'Hip-Hop', 'R&B',
  'Latin', 'Reggaeton', 'Afro', 'Rock', 'COCOVARIET',
  'Chill', 'Ambient', 'Jazz', 'Classical'
]);

// 1. Charger la source de vérité
console.log('📂 Lecture de curated_base_v3.json...');
const curated = JSON.parse(fs.readFileSync(CURATED_PATH, 'utf-8'));
const tracks = curated.tracks || [];
console.log(`📀 ${tracks.length} titres dans curated_base_v3.json`);

// 2. Charger le metadata existant (pour préserver les cover_medium déjà enrichies)
let existingMeta = {};
try {
  existingMeta = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
  console.log(`📂 ${Object.keys(existingMeta).length} titres existants dans track_metadata.json (covers préservées)`);
} catch { console.log('⚠️ Pas de track_metadata.json existant — création from scratch'); }

// Construire un index par clé normalisée pour retrouver les covers
function makeKey(title, artist) {
  return [title, artist].map(s => (s||'')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(feat\.?|ft\.?|featuring)\b/gi,'')
    .replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim()
  ).join('__');
}

const coverIndex = {};
for (const entry of Object.values(existingMeta)) {
  if (entry.cover_medium) {
    coverIndex[makeKey(entry.title, entry.artist)] = entry.cover_medium;
  }
}

// 3. Reconstruire track_metadata.json
const newMeta = {};
let excluded = 0;
let withCover = 0;

for (const t of tracks) {
  if (!t.title || !t.artist) continue;
  if (t.genre === 'EXCLUDED') { excluded++; continue; }
  if (t.needs_review && !t.genre) continue; // Ignorer les non-qualifiés sans genre

  const genre = normalizeGenre(t.genre);
  if (!VALID_GENRES.has(genre)) { excluded++; continue; }

  const fileKey = `${t.title} - ${t.artist}`;
  const normKey = makeKey(t.title, t.artist);
  const cover = t.cover_medium || coverIndex[normKey] || null;
  if (cover) withCover++;

  newMeta[fileKey] = {
    title:        t.title,
    artist:       t.artist,
    bpm:          t.bpm ? Math.round(t.bpm) : 0,
    energy:       t.energy ? Math.round(t.energy) : 0,
    genre:        genre,
    phase:        t.phase || null,
    danceability: t.danceability || 0,
    deezerID:     t.deezerID || 0,
    ...(cover ? { cover_medium: cover } : {}),
    ...(t.isrc  ? { isrc: t.isrc }     : {}),
  };
}

const total = Object.keys(newMeta).length;
console.log(`\n✅ ${total} titres reconstruits (${excluded} exclus)`);
console.log(`🖼  ${withCover} pochettes conservées`);

// 4. Sauvegarder
fs.writeFileSync(METADATA_PATH, JSON.stringify(newMeta, null, 2), 'utf-8');
console.log(`\n💾 track_metadata.json mis à jour !`);

// 5. Ventilation finale
const genreCount = {};
for (const e of Object.values(newMeta)) {
  genreCount[e.genre] = (genreCount[e.genre] || 0) + 1;
}
const sorted = Object.entries(genreCount).sort((a, b) => b[1] - a[1]);
console.log('\n── Ventilation finale ──');
sorted.forEach(([g, c]) => {
  const bar = '█'.repeat(Math.round(c / 15));
  console.log(`  ${g.padEnd(18)} ${String(c).padStart(4)}  ${bar}`);
});

console.log('\n📋 Prochaines étapes :');
console.log('   git add -A && git commit -m "chore: Sync curated DB" && git push');
console.log('   Xcode → Shift+Cmd+K (Clean) + Cmd+R (Run)');
