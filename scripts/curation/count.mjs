// scripts/curation/count.mjs
// Comptage read-only : état du catalogue + taille du stock à qualifier.
// Sert de "preuve de connexion" dans le workflow curation-count (secret + Atlas OK).
// Écrit aussi un résumé dans COUNT_OUT (fichier) si défini, pour relecture hors logs GitHub.

import fs from 'fs';
import mongoose from 'mongoose';
import { connectMongo } from './lib.mjs';
import { CANDIDATE_QUERY } from './export_inbox.mjs';

const db = await connectMongo();
const tracks = db.collection('tracks');

const byQL = await tracks.aggregate([
  { $group: { _id: { $ifNull: ['$qualityLevel', 'absent'] }, n: { $sum: 1 } } },
  { $sort: { n: -1 } }
]).toArray();

const total = await tracks.countDocuments({});
const candidates = await tracks.countDocuments(CANDIDATE_QUERY);
const candidatesWithDeezerId = await tracks.countDocuments({ ...CANDIDATE_QUERY, 'providers.deezer.trackId': { $gt: 0 } });
const verified = await tracks.countDocuments({ isVerified: true });
const noPhase = await tracks.countDocuments({ $or: [{ phase: null }, { phase: '' }, { phase: { $exists: false } }] });
const last24h = await tracks.countDocuments({ createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } });

const lines = [];
lines.push('================ CATALOGUE AHOUAI — COMPTAGE ================');
lines.push(`Date (UTC)              : ${new Date().toISOString()}`);
lines.push(`Total tracks            : ${total}`);
for (const r of byQL) lines.push(`  qualityLevel=${String(r._id).padEnd(9)} : ${r.n}`);
lines.push(`isVerified=true (platine, intouchable) : ${verified}`);
lines.push(`Sans phase              : ${noPhase}`);
lines.push(`Créées dernières 24 h   : ${last24h}`);
lines.push('--------------------------------------------------------------');
lines.push(`CANDIDATES curation auto (vide/partielle, non vérifiées, non bloquées) : ${candidates}`);
lines.push(`  dont avec deezer trackId : ${candidatesWithDeezerId}`);
lines.push('==============================================================');
console.log('\n' + lines.join('\n') + '\n');
if (process.env.COUNT_OUT) fs.writeFileSync(process.env.COUNT_OUT, lines.join('\n') + '\n', 'utf8');

await mongoose.disconnect();
