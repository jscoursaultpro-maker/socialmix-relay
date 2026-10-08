// scripts/curation/pool_state_report.mjs
// Rapport hebdomadaire sur l'état du pool DJ Brain : couverture par phase,
// genre, energy range, carences, candidats disponibles. Écrit un markdown
// dans curation-data/logs/pool-state-YYYY-MM-DD.md et le pousse sur la
// branche curation-data via git. Pensé pour tourner en cron Render.
//
// Usage :
//   node scripts/curation/pool_state_report.mjs [--data-dir ./curation-data] [--no-commit]
//
// Env requis : MONGODB_URI (ou .env en local), GIT_USER_EMAIL / GIT_USER_NAME optionnels.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import mongoose from 'mongoose';
import Track from '../../models/Track.js';
import { connectMongo, todayStamp, PHASES } from './lib.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const DATA_DIR = path.resolve(String(arg('data-dir', process.env.CURATION_DATA_DIR || './curation-data')));
const NO_COMMIT = arg('no-commit', false) === true || process.env.NO_COMMIT === '1';

// ─── Cibles pool par phase (baseline — à ajuster selon vision Jean-Sé) ──
const PHASE_TARGETS = {
  arrival: 150, ambiance: 200, takeoff: 200, groove: 300, party: 350, closing: 150
};
const TOTAL_TARGET = Object.values(PHASE_TARGETS).reduce((a, b) => a + b, 0);

const ENERGY_RANGES = [
  { label: 'low (1-3)', min: 1, max: 3 },
  { label: 'mid (4-6)', min: 4, max: 6 },
  { label: 'high (7-10)', min: 7, max: 10 },
];

// ─── Main ─────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  await connectMongo();
  const stamp = todayStamp();
  console.log(`\n=== POOL STATE REPORT — ${stamp} ===\n`);

  // Comptages globaux
  const total = await Track.countDocuments({});
  const eligible = await Track.countDocuments({
    qualityLevel: { $in: ['complete', 'platine'] },
    suggestable: { $ne: false },
  });
  const platine = await Track.countDocuments({ qualityLevel: 'platine' });
  const complete = await Track.countDocuments({ qualityLevel: 'complete' });
  const partielle = await Track.countDocuments({ qualityLevel: 'partielle' });
  const empty = await Track.countDocuments({ qualityLevel: { $in: ['empty', null, undefined] } });
  const emptyWithIsrc = await Track.countDocuments({
    qualityLevel: { $in: ['empty', null, undefined] },
    isrc: { $exists: true, $ne: null, $ne: '' },
  });

  // Confidence en attente
  const lowConf = await Track.countDocuments({ confidence: 'low' });
  const medConf = await Track.countDocuments({ confidence: 'medium' });

  // Par phase (éligible)
  const byPhase = {};
  for (const phase of PHASES) {
    byPhase[phase] = {
      total: await Track.countDocuments({ phase, qualityLevel: { $in: ['complete', 'platine'] }, suggestable: { $ne: false } }),
      byEnergy: {},
    };
    for (const r of ENERGY_RANGES) {
      byPhase[phase].byEnergy[r.label] = await Track.countDocuments({
        phase, qualityLevel: { $in: ['complete', 'platine'] }, suggestable: { $ne: false },
        energy: { $gte: r.min, $lte: r.max },
      });
    }
  }

  // Par phase × genre
  const byPhaseGenre = await Track.aggregate([
    { $match: { qualityLevel: { $in: ['complete', 'platine'] }, suggestable: { $ne: false }, phase: { $ne: null } } },
    { $group: { _id: { phase: '$phase', genre: '$genre' }, count: { $sum: 1 } } },
    { $sort: { '_id.phase': 1, count: -1 } },
  ]);

  // Carences : phases en-dessous de leur cible
  const carences = [];
  for (const phase of PHASES) {
    const target = PHASE_TARGETS[phase];
    const actual = byPhase[phase].total;
    const gap = target - actual;
    if (gap > 0) carences.push({ phase, actual, target, gap });
  }
  carences.sort((a, b) => b.gap - a.gap);

  // Carences fines : phase × energy range (<30 = alerte)
  const carencesFines = [];
  for (const phase of PHASES) {
    for (const r of ENERGY_RANGES) {
      const count = byPhase[phase].byEnergy[r.label];
      if (count < 30) carencesFines.push({ phase, energy: r.label, count });
    }
  }
  carencesFines.sort((a, b) => a.count - b.count);

  // ─── Écriture markdown ─────────────────────────────────────────────
  const lines = [];
  lines.push(`# État du pool DJ Brain — ${stamp}`);
  lines.push('');
  lines.push(`_Rapport automatique hebdomadaire (cron \`pool-state-weekly\`)._`);
  lines.push('');
  lines.push('## 📊 Vue d\'ensemble');
  lines.push('');
  lines.push(`| Catégorie | Nombre |`);
  lines.push(`|---|---|`);
  lines.push(`| Total BDD | **${total.toLocaleString('fr-FR')}** |`);
  lines.push(`| Pool éligible DJ Brain (complete + platine, suggestable) | **${eligible.toLocaleString('fr-FR')}** |`);
  lines.push(`| └─ dont platine (isVerified=true) | ${platine.toLocaleString('fr-FR')} |`);
  lines.push(`| └─ dont complete | ${complete.toLocaleString('fr-FR')} |`);
  lines.push(`| Qualité partielle (à promouvoir) | ${partielle.toLocaleString('fr-FR')} |`);
  lines.push(`| Qualité empty (candidats) | ${empty.toLocaleString('fr-FR')} |`);
  lines.push(`| └─ dont ISRC propre (gisement propre) | **${emptyWithIsrc.toLocaleString('fr-FR')}** |`);
  lines.push(`| Confidence \`low\` en attente de review manuelle | ${lowConf.toLocaleString('fr-FR')} |`);
  lines.push(`| Confidence \`medium\` | ${medConf.toLocaleString('fr-FR')} |`);
  lines.push('');

  lines.push('## 🎯 Pool éligible par phase');
  lines.push('');
  lines.push(`| Phase | Tracks | Cible | Statut |`);
  lines.push(`|---|---|---|---|`);
  for (const phase of PHASES) {
    const n = byPhase[phase].total;
    const target = PHASE_TARGETS[phase];
    const pct = Math.round((n / target) * 100);
    const status = n >= target ? '✅' : n >= target * 0.75 ? '🟡' : '🔴';
    lines.push(`| **${phase}** | ${n.toLocaleString('fr-FR')} | ${target} | ${status} ${pct}% |`);
  }
  const sumActual = PHASES.reduce((s, p) => s + byPhase[p].total, 0);
  lines.push(`| _Total_ | _${sumActual.toLocaleString('fr-FR')}_ | _${TOTAL_TARGET}_ | _${Math.round((sumActual / TOTAL_TARGET) * 100)}%_ |`);
  lines.push('');

  lines.push('## ⚡ Pool éligible par phase × energy range');
  lines.push('');
  lines.push(`| Phase | low (1-3) | mid (4-6) | high (7-10) |`);
  lines.push(`|---|---|---|---|`);
  for (const phase of PHASES) {
    const row = ENERGY_RANGES.map(r => byPhase[phase].byEnergy[r.label]);
    lines.push(`| **${phase}** | ${row[0]} | ${row[1]} | ${row[2]} |`);
  }
  lines.push('');

  lines.push('## 🎨 Pool éligible par phase × genreBDD (top 5 par phase)');
  lines.push('');
  const byPhaseMap = {};
  for (const row of byPhaseGenre) {
    const p = row._id.phase;
    if (!byPhaseMap[p]) byPhaseMap[p] = [];
    byPhaseMap[p].push({ genre: row._id.genre, count: row.count });
  }
  for (const phase of PHASES) {
    const rows = byPhaseMap[phase] || [];
    const top5 = rows.slice(0, 5).map(r => `${r.genre} (${r.count})`).join(', ');
    lines.push(`- **${phase}** : ${top5 || '_vide_'}`);
  }
  lines.push('');

  if (carences.length) {
    lines.push('## 🔴 Carences par phase (sous la cible)');
    lines.push('');
    lines.push(`| Phase | Actuel | Cible | Manque |`);
    lines.push(`|---|---|---|---|`);
    for (const c of carences) lines.push(`| **${c.phase}** | ${c.actual} | ${c.target} | **${c.gap}** |`);
    lines.push('');
  } else {
    lines.push('## ✅ Aucune carence par phase (toutes au-dessus de la cible)');
    lines.push('');
  }

  if (carencesFines.length) {
    lines.push('## 🟠 Carences fines par phase × energy (<30 tracks)');
    lines.push('');
    lines.push(`| Phase | Energy | Tracks |`);
    lines.push(`|---|---|---|`);
    for (const c of carencesFines) lines.push(`| **${c.phase}** | ${c.energy} | ${c.count} |`);
    lines.push('');
  }

  lines.push('## 📋 Actions recommandées');
  lines.push('');
  if (carences.length > 0) {
    lines.push(`- **Prioriser les imports sur les ${carences.length} phase(s) en carence** : ${carences.map(c => `${c.phase} (+${c.gap} à combler)`).join(', ')}`);
  }
  if (emptyWithIsrc > 100) {
    lines.push(`- **Attaquer le pool "empty + ISRC propre"** : ${emptyWithIsrc.toLocaleString('fr-FR')} tracks sont des candidats de qualité pour la curation (Deezer vérifié).`);
  }
  if (lowConf > 20) {
    lines.push(`- **Review manuelle** : ${lowConf} tracks \`confidence=low\` attendent un arbitrage.`);
  }
  if (!carences.length && !carencesFines.length) {
    lines.push('- Pool globalement équilibré. Focus sur enrichissement providers (Spotify) ou vision V2.');
  }
  lines.push('');
  lines.push(`---`);
  lines.push(`_Généré le ${new Date().toISOString()} par \`pool_state_report.mjs\`._`);
  lines.push('');

  const outPath = path.join(DATA_DIR, 'logs', `pool-state-${stamp}.md`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`✅ Rapport écrit : ${outPath}`);
  console.log(`   Pool éligible : ${eligible} / ${TOTAL_TARGET} cible (${Math.round((eligible / TOTAL_TARGET) * 100)}%)`);
  console.log(`   Carences : ${carences.length} phase(s), ${carencesFines.length} cran(s) phase×energy`);

  // ─── Commit + push sur curation-data ───────────────────────────────
  if (!NO_COMMIT) {
    try {
      const cwd = DATA_DIR;
      execSync(`git config user.email "${process.env.GIT_USER_EMAIL || 'curation-bot@ahouai.com'}"`, { cwd, stdio: 'pipe' });
      execSync(`git config user.name "${process.env.GIT_USER_NAME || 'AhOuai Pool State Bot'}"`, { cwd, stdio: 'pipe' });
      execSync(`git add logs/pool-state-${stamp}.md`, { cwd, stdio: 'pipe' });
      // Un rapport du même jour peut déjà exister → amend n'est pas souhaité (on garde l'historique)
      // On commit seulement si diff non vide
      const diff = execSync('git diff --cached --name-only', { cwd }).toString().trim();
      if (!diff) {
        console.log(`ℹ️  Pas de changement à commiter (rapport identique).`);
      } else {
        execSync(`git commit -m "curation: pool state ${stamp} (${eligible} éligibles, ${carences.length} carences)"`, { cwd, stdio: 'pipe' });
        execSync(`git push origin HEAD:curation-data`, { cwd, stdio: 'pipe' });
        console.log(`✅ Commit + push sur curation-data OK`);
      }
    } catch (err) {
      console.warn(`⚠️  Commit/push a échoué : ${err.message}`);
      console.warn(`   Le rapport est écrit localement dans ${outPath} mais pas poussé.`);
    }
  }

  await mongoose.disconnect();
}
