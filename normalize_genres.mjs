/**
 * normalize_genres.mjs
 *
 * Normalise les genres CSV bruts → genres SocialMix dans curated_base_v3.json
 * - Mappings clairs : appliqués automatiquement
 * - Genres incertains : flagués needs_review: true pour le monitor
 * - Aucun titre supprimé
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, './curated_base_v3.json');

// ─── Table de mapping CSV genre → SocialMix genre ────────────────────────────
// null = garder le genre original + needs_review: true
const GENRE_MAP = {
  // ── Hip-Hop / Urban ─────────────────────────────────────────────────────────
  'Hip Hop':          'Hip-Hop',
  'Hip-Hop':          'Hip-Hop',
  'Pop Rap':          'Hip-Hop',
  'Trap':             'Hip-Hop',
  'Gangsta':          'Hip-Hop',
  'Jazzy Hip-Hop':    'Hip-Hop',
  'Trip Hop':         'Hip-Hop',

  // ── House ────────────────────────────────────────────────────────────────────
  'House':            'House',
  'Progressive House':'House',
  'Deep House':       'House',
  'Tech House':       'House',
  'French House':     'House',
  'Future House':     'House',
  'Tropical House':   'House',
  'Tribal House':     'House',
  'Euro House':       'House',
  'Garage House':     'House',
  'Hard House':       'House',
  'Hands Up':         'House',
  'Hip-House':        'House',
  'Dance / Club':     'House',
  'Dance':            'House',

  // ── Electro ──────────────────────────────────────────────────────────────────
  'Electro':          'Electro',
  'Electro House':    'Electro',
  'Techno':           'Electro',
  'Trance':           'Electro',
  'Hard Trance':      'Electro',
  'Eurodance':        'Electro',
  'Drum n Bass':      'Electro',
  'Dubstep':          'Electro',
  'Synthwave':        'Electro',
  'Electroclash':     'Electro',
  'ELECTRONIC':       'Electro',
  'Deep Techno':      'Electro',
  'Progressive Breaks':'Electro',
  'Hi NRG':           'Electro',
  'Eurobeat':         'Electro',
  'Psy-Trance':       'Electro',
  'Leftfield':        'Electro',
  'Big Beat':         'Electro',
  'Hardcore':         'Electro',
  'IDM':              'Electro',

  // ── Pop ──────────────────────────────────────────────────────────────────────
  'Pop':              'Pop',
  'Dance-pop':        'Pop',   // provisional — needs_review pour les cas House
  'Synth-pop':        'Pop',
  'Indie Pop':        'Pop',
  'Europop':          'Pop',
  'Power Pop':        'Pop',
  'K-pop':            'Pop',
  'New Wave':         'Pop',

  // ── Disco ────────────────────────────────────────────────────────────────────
  'Disco':            'Disco',
  'Nu-Disco':         'Disco',
  'Italodance':       'Disco',

  // ── R&B / Soul ───────────────────────────────────────────────────────────────
  'Contemporary R&B': 'R&B',
  'R&B':              'R&B',
  'RnB/Swing':        'R&B',
  'Soul':             'R&B',
  'Neo Soul':         'R&B',
  'Funk / Soul':      'R&B',   // R&B plus approprié que Disco pour une soirée

  // ── Latin ────────────────────────────────────────────────────────────────────
  'Latin':            'Latin',
  'Guaracha':         'Latin',
  'Bachata':          'Latin',

  // ── Reggaeton ────────────────────────────────────────────────────────────────
  'Reggaeton':        'Reggaeton',
  'Dancehall':        'Reggaeton',
  'Reggae-Pop':       'Reggaeton',

  // ── Afro ─────────────────────────────────────────────────────────────────────
  'Reggae':           'Afro',
  'Dub':              'Afro',

  // ── Rock ─────────────────────────────────────────────────────────────────────
  'Rock':             'Rock',
  'Rock & Roll':      'Rock',
  'Indie Rock':       'Rock',
  'Pop Rock':         'Rock',
  'Surf':             'Rock',
  'Goth Rock':        'Rock',
  'Emo':              'Rock',

  // ── COCOVARIET ───────────────────────────────────────────────────────────────
  'Chanson':          'COCOVARIET',

  // ── Chill ────────────────────────────────────────────────────────────────────
  'Downtempo':        'Chill',
  'Balearic':         'Chill',

  // ── Ambient ──────────────────────────────────────────────────────────────────
  'Ambient':          'Ambient',

  // ── Incertains → needs_review (on garde le genre CSV original) ───────────────
  'UK Garage':        null,   // Electro ? R&B ? → monitor
  'Bass Music':       null,   // Electro ? → monitor
  'Jazz':             null,   // → monitor (reclassifier titre par titre)
  'Classical':        null,   // → monitor
  'Non-Music':        null,   // → monitor
  'Industrial':       null,   // → monitor
  'Sound Collage':    null,   // → monitor
  'Experimental':     null,   // → monitor
  'Stage & Screen':   null,   // → monitor
  'New Age':          null,   // → monitor
  'Chiptune':         null,   // → monitor
  'Cut-up/DJ':        null,   // → monitor
  'Folk':             null,   // → monitor
  'Folk, World, & Country': null, // → monitor
  'Soundtrack':       null,   // → monitor
  'Theme':            null,   // → monitor
};

// ─── Load DB ──────────────────────────────────────────────────────────────────
const db     = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const tracks = db.tracks || [];

let mapped       = 0;
let flagged      = 0;
let alreadyGood  = 0;
let unknown      = 0;

const reviewGenres = {};
const mappedGenres = {};

for (const t of tracks) {
  const csvGenre = t.genre || '';
  
  if (GENRE_MAP.hasOwnProperty(csvGenre)) {
    const target = GENRE_MAP[csvGenre];
    
    if (target === null) {
      // Incertain → flag pour monitor
      t.needs_review = true;
      flagged++;
      reviewGenres[csvGenre] = (reviewGenres[csvGenre] || 0) + 1;
    } else if (t.genre !== target) {
      // Mapping clair → appliquer
      t.genre = target;
      t.needs_review = false;
      mapped++;
      mappedGenres[csvGenre] = mappedGenres[csvGenre] || { to: target, count: 0 };
      mappedGenres[csvGenre].count++;
    } else {
      // Déjà correct
      alreadyGood++;
    }
  } else {
    // Genre inconnu de la table → flag pour monitor
    t.needs_review = true;
    unknown++;
    reviewGenres[csvGenre] = (reviewGenres[csvGenre] || 0) + 1;
    console.log(`  ⚠️  Genre inconnu: "${csvGenre}" — "${t.title}" — ${t.artist}`);
  }
}

// ─── Save ─────────────────────────────────────────────────────────────────────
db.generatedAt = new Date().toISOString();
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

// ─── Report ───────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  NORMALISATION GENRES — RAPPORT');
console.log('══════════════════════════════════════════════════════');
console.log(`  ✅ Genres normalisés         : ${mapped}`);
console.log(`  ✅ Déjà corrects             : ${alreadyGood}`);
console.log(`  🔍 Flagués needs_review      : ${flagged + unknown}`);
console.log('');
console.log('  Mappings appliqués:');
Object.entries(mappedGenres)
  .sort((a,b) => b[1].count - a[1].count)
  .forEach(([from, { to, count }]) => {
    console.log(`    "${from}".padEnd(25) → ${to} (${count} tracks)`);
  });
console.log('');
console.log('  Genres → monitor (needs_review):');
Object.entries(reviewGenres)
  .sort((a,b) => b[1] - a[1])
  .forEach(([g, c]) => {
    console.log(`    "${g}" : ${c} tracks`);
  });

// Résumé par genre final
const finalGenres = {};
tracks.forEach(t => { finalGenres[t.genre] = (finalGenres[t.genre] || 0) + 1; });
console.log('\n  Distribution finale des genres:');
Object.entries(finalGenres).sort((a,b) => b[1]-a[1]).forEach(([g,c]) => {
  console.log(`    ${g.padEnd(20)} : ${c}`);
});
console.log('══════════════════════════════════════════════════════\n');
