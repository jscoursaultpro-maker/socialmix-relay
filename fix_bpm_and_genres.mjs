/**
 * fix_bpm_and_genres.mjs
 * 
 * 1. Divise par 2 tous les BPM > 170 dans curated_base_v3.json
 * 2. Corrige les genres évidents erronés
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, './curated_base_v3.json');

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const tracks = db.tracks || [];

let bpmFixed = 0;
let genreFixed = 0;

// ─── Corrections de genre évidentes ────────────────────────────────────────
// [titre lowercase, artiste lowercase] => nouveau genre
const GENRE_FIXES = [
  // Eminem "Love The Way You Lie" classé Latin → Hip-Hop
  { titleMatch: 'love the way you lie', artistMatch: 'eminem', newGenre: 'Hip-Hop' },
  // The Sundays "Summertime" classé Latin → Pop (groupe brit indie)
  { titleMatch: 'summertime', artistMatch: 'the sundays', newGenre: 'Pop' },
  // TV Girl "Loving Machine" classé Latin → Pop (indie pop américain)
  { titleMatch: 'loving machine', artistMatch: 'tv girl', newGenre: 'Pop' },
  // AURORA "Runaway" classé Latin → Pop (pop norvégienne)
  { titleMatch: 'runaway', artistMatch: 'aurora', newGenre: 'Pop' },
  // Ace of Base "All That She Wants" classé Afro → Pop (pop suédois)
  { titleMatch: 'all that she wants', artistMatch: 'ace of base', newGenre: 'Pop' },
  // France Gall "Musique" classé Variété Fr → COCOVARIET
  { titleMatch: 'musique', artistMatch: 'france gall', newGenre: 'COCOVARIET' },
  // Céline Dion "J'irai où tu iras" classé Variété Fr → COCOVARIET
  { artistMatch: 'céline dion', genreMatch: 'Variété Fr', newGenre: 'COCOVARIET' },
  // Angèle "Oui ou non" classé Variété Fr → COCOVARIET
  { titleMatch: 'oui ou non', artistMatch: 'angèle', newGenre: 'COCOVARIET' },
  // Jean-Jacques Goldman "Et l'on n'y peut rien" classé Pop → COCOVARIET
  { artistMatch: 'jean-jacques goldman', newGenre: 'COCOVARIET' },
  // Toutes les Variété Fr restantes → COCOVARIET
  { genreMatch: 'Variété Fr', newGenre: 'COCOVARIET' },
];

for (const t of tracks) {
  const titleL  = (t.title  || '').toLowerCase();
  const artistL = (t.artist || '').toLowerCase();

  for (const fix of GENRE_FIXES) {
    const matchTitle  = !fix.titleMatch  || titleL.includes(fix.titleMatch);
    const matchArtist = !fix.artistMatch || artistL.includes(fix.artistMatch);
    const matchGenre  = !fix.genreMatch  || t.genre === fix.genreMatch;

    if (matchTitle && matchArtist && matchGenre && t.genre !== fix.newGenre) {
      console.log(`  🎭 Genre: "${t.title}" — ${t.artist}: ${t.genre} → ${fix.newGenre}`);
      t.genre = fix.newGenre;
      genreFixed++;
      break;
    }
  }
}

// ─── Correction BPM > 170 (half-time → divide by 2) ────────────────────────
// Cas à laisser intact : Enigma "Sadeness" — on le note mais on le divise quand même
// car 191/2 = 96 BPM est plus cohérent, et l'utilisateur décidera s'il veut le garder

for (const t of tracks) {
  if (t.bpm && t.bpm > 170) {
    const original = t.bpm;
    t.bpm = Math.round(t.bpm / 2);
    console.log(`  ⚡ BPM: "${t.title}" — ${t.artist}: ${original} → ${t.bpm} BPM`);
    bpmFixed++;
  }
}

// ─── Sauvegarde ──────────────────────────────────────────────────────────────
db.generatedAt = new Date().toISOString();
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log('\n══════════════════════════════════════════');
console.log(`  ✅ BPM corrigés (÷2)    : ${bpmFixed}`);
console.log(`  ✅ Genres corrigés      : ${genreFixed}`);
console.log(`  📄 curated_base_v3.json mis à jour`);
console.log('══════════════════════════════════════════\n');
