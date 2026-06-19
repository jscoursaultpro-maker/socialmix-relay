import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Track from '../models/Track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = '/Users/Jean-Sebastien/Documents/Claude/Projects/Social M/NORMALIZATION_REPORT.md';

const args = process.argv.slice(2);
const isDryRun = !args.includes('--apply');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const tracks = await Track.find().lean();
  let modifiedCount = 0;
  
  const phaseStats = {
    'arrivée -> arrival': 0,
    'décollage -> takeoff': 0,
    'montée -> takeoff': 0,
    'fin -> closing': 0,
    'cloture -> closing': 0,
    'apogée -> party': 0,
    'redescente -> closing': 0,
  };
  
  const genreStats = {
    'Variété Fr -> COCOVARIET': 0,
    'Chanson FR -> COCOVARIET': 0,
    'variété française -> COCOVARIET': 0,
    'Années 80 -> Pop': 0,
  };
  
  const nonPrevuCases = [];
  const sample = [];
  
  for (const t of tracks) {
    let phaseBefore = t.phase;
    let phaseAfter = t.phase;
    let genreBefore = t.genre;
    let genreAfter = t.genre;
    let changed = false;
    let typeChange = [];
    
    // Check phase
    if (t.phase) {
      const pLower = t.phase.toLowerCase().trim();
      if (pLower === 'arrivée' || pLower === 'arrivee') { phaseAfter = 'arrival'; phaseStats['arrivée -> arrival']++; changed = true; typeChange.push('phase'); }
      else if (pLower === 'décollage' || pLower === 'decollage') { phaseAfter = 'takeoff'; phaseStats['décollage -> takeoff']++; changed = true; typeChange.push('phase'); }
      else if (pLower === 'montée' || pLower === 'montee') { phaseAfter = 'takeoff'; phaseStats['montée -> takeoff']++; changed = true; typeChange.push('phase'); }
      else if (pLower === 'fin') { phaseAfter = 'closing'; phaseStats['fin -> closing']++; changed = true; typeChange.push('phase'); }
      else if (pLower === 'cloture' || pLower === 'clôture') { phaseAfter = 'closing'; phaseStats['cloture -> closing']++; changed = true; typeChange.push('phase'); }
      else if (pLower === 'apogée' || pLower === 'apogee') { phaseAfter = 'party'; phaseStats['apogée -> party']++; changed = true; typeChange.push('phase'); }
      else if (pLower === 'redescente') { phaseAfter = 'closing'; phaseStats['redescente -> closing']++; changed = true; typeChange.push('phase'); }
      else {
        // Unexpected case check
        if (['arrival', 'ambiance', 'takeoff', 'groove', 'party', 'closing'].includes(t.phase)) {
          // OK
        } else {
          // Extra space, weird casing, typo
          nonPrevuCases.push({ id: t._id, title: t.title, artist: t.artist, field: 'phase', value: t.phase });
        }
      }
    }
    
    // Check genre
    if (t.genre) {
      const gTrim = t.genre.trim();
      const gLower = gTrim.toLowerCase();
      if (gLower === 'variété fr' || gLower === 'variete fr') { genreAfter = 'COCOVARIET'; genreStats['Variété Fr -> COCOVARIET']++; changed = true; typeChange.push('genre'); }
      else if (gLower === 'chanson fr' || gLower === 'chanson française' || gLower === 'chanson francaise') { genreAfter = 'COCOVARIET'; genreStats['Chanson FR -> COCOVARIET']++; changed = true; typeChange.push('genre'); }
      else if (gLower === 'variété française' || gLower === 'variete francaise') { genreAfter = 'COCOVARIET'; genreStats['variété française -> COCOVARIET']++; changed = true; typeChange.push('genre'); }
      else if (gLower === 'années 80' || gLower === 'annees 80' || gLower === '80s') { genreAfter = 'Pop'; genreStats['Années 80 -> Pop']++; changed = true; typeChange.push('genre'); }
      else {
        // Just checking for trailing spaces
        if (t.genre !== t.genre.trim()) {
           nonPrevuCases.push({ id: t._id, title: t.title, artist: t.artist, field: 'genre', value: `"${t.genre}" (espace détecté)` });
        }
      }
    }
    
    if (changed) {
      modifiedCount++;
      if (sample.length < 20) {
        if (phaseBefore !== phaseAfter) {
          sample.push({ title: t.title, artist: t.artist, champ: 'phase', avant: phaseBefore, apres: phaseAfter });
        }
        if (genreBefore !== genreAfter) {
          sample.push({ title: t.title, artist: t.artist, champ: 'genre', avant: genreBefore, apres: genreAfter });
        }
      }
      
      if (!isDryRun) {
        const update = { $set: {} };
        if (phaseBefore !== phaseAfter) {
          update.$set.phase = phaseAfter;
          update.$set._legacyPhase = phaseBefore;
        }
        if (genreBefore !== genreAfter) {
          update.$set.genre = genreAfter;
          update.$set._legacyGenre = genreBefore;
        }
        await mongoose.connection.collection('tracks').updateOne({ _id: t._id }, update);
      }
    }
  }
  
  let md = `# NORMALIZATION REPORT — 16 Juin 2026\n\n`;
  md += `**Mode:** ${isDryRun ? '--dry-run (Aucune modification en base)' : '--apply (Modifications appliquées)'}\n\n`;
  
  md += `## Stats globales\n`;
  md += `- Tracks scannées : ${tracks.length}\n`;
  md += `- Tracks à modifier : ${modifiedCount}\n`;
  md += `- Tracks intactes : ${tracks.length - modifiedCount}\n\n`;
  
  md += `## Modifications phase\n`;
  for (const [k, v] of Object.entries(phaseStats)) md += `- ${k} : ${v} tracks\n`;
  md += `\n`;
  
  md += `## Modifications genre\n`;
  for (const [k, v] of Object.entries(genreStats)) md += `- ${k} : ${v} tracks\n`;
  md += `\n`;
  
  md += `## Sauvegarde des valeurs originales\n`;
  md += `Confirme que chaque track modifiée garde sa valeur originale dans \`_legacyPhase\` ou \`_legacyGenre\` via update direct MongoDB.\n\n`;
  
  md += `## Top 20 tracks affectées (échantillon)\n`;
  md += `| Titre | Artiste | Champ | Avant | Après |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const s of sample) {
    md += `| ${s.title} | ${s.artist} | ${s.champ} | ${s.avant} | ${s.apres} |\n`;
  }
  md += `\n`;
  
  if (nonPrevuCases.length > 0) {
    md += `## CAS NON PRÉVUS (non modifiés)\n`;
    md += `| Titre | Artiste | Champ | Valeur anormale |\n`;
    md += `|---|---|---|---|\n`;
    for (const c of nonPrevuCases) {
      md += `| ${c.title} | ${c.artist} | ${c.field} | ${c.value} |\n`;
    }
  }
  
  fs.writeFileSync(REPORT_PATH, md, 'utf-8');
  console.log(`Rapport généré: ${REPORT_PATH}`);
  
  // Calculate distribution after apply
  const finalTracks = await Track.find().lean();
  const phaseDist = { nil: 0, arrival: 0, ambiance: 0, takeoff: 0, groove: 0, party: 0, closing: 0 };
  const genreDist = {};
  
  for (const ft of finalTracks) {
    if (!ft.phase) phaseDist.nil++;
    else if (phaseDist[ft.phase] !== undefined) phaseDist[ft.phase]++;
    else phaseDist[ft.phase] = (phaseDist[ft.phase] || 0) + 1;
    
    const g = ft.genre || 'Inconnu';
    genreDist[g] = (genreDist[g] || 0) + 1;
  }
  
  console.log(`\n=== DISTRIBUTION PHASE ===`);
  let totalPhased = 0;
  for (const [p, c] of Object.entries(phaseDist)) {
    console.log(`- phase: ${p} : ${c}`);
    if (p !== 'nil' && c > 0 && ['arrival', 'ambiance', 'takeoff', 'groove', 'party', 'closing'].includes(p)) totalPhased += c;
  }
  console.log(`Total phasé : ${totalPhased} / ${finalTracks.length} (${Math.round(totalPhased / finalTracks.length * 100)}%)`);
  
  console.log(`\n=== DISTRIBUTION GENRE ===`);
  const sortedGenres = Object.entries(genreDist).sort((a,b) => b[1]-a[1]);
  for (let i = 0; i < Math.min(10, sortedGenres.length); i++) {
    console.log(`- ${sortedGenres[i][0]} : ${sortedGenres[i][1]}`);
  }
  
  await mongoose.disconnect();
}

run().catch(console.error);
