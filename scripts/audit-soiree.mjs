#!/usr/bin/env node
/**
 * AUDIT SOIRÉE AhOuai — générique, READ-ONLY STRICT
 * ================================================
 * Usage :
 *   node scripts/audit-soiree.mjs --list       → liste les 20 dernières soirées
 *   node scripts/audit-soiree.mjs FTMP63       → audit complet, rapport dans audits/
 *
 * GARANTIES READ-ONLY :
 *   - aucun import de server.js (pas de socket, pas de listener)
 *   - uniquement find / findOne / aggregate / countDocuments
 *   - readPreference secondaryPreferred
 *   - aucun save/update/insert/delete/drop (vérifiable par grep sur ce fichier)
 *
 * DOCTRINE FACTS ONLY : toute donnée absente → "N/A — <raison>", jamais de supposition.
 * Les noms de champs sont ceux RÉELLEMENT écrits par server.js (vérifiés dans le code
 * source le 2026-10-03), pas ceux du template d'audit.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ quiet: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const AUDIT_DIR = join(ROOT, 'audits');

const ARG = process.argv[2];
if (!ARG) {
  console.error('Usage: node scripts/audit-soiree.mjs <CODE_SOIREE> | --list');
  process.exit(1);
}

// ─────────────────────────── helpers ───────────────────────────
const NA = (reason) => `N/A — ${reason}`;
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : NA('dénominateur = 0'));
const iso = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : null);
const dur = (ms) => {
  if (ms == null || Number.isNaN(ms)) return NA('timestamps manquants');
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m${String(s % 60).padStart(2, '0')}s`;
};
const ts = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; };
const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o).sort().join(', ') : NA('objet absent'));
const table = (headers, rows) => {
  if (!rows || !rows.length) return '_(aucune ligne)_';
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`,
    ...rows.map(r => `| ${r.map(c => (c === null || c === undefined ? '—' : String(c).replace(/\|/g, '\\|'))).join(' | ')} |`)].join('\n');
};
const OID_RE = /^[0-9a-fA-F]{24}$/;
const LEGACY_GUEST_RE = /^guest_.+_\d+$/;

async function loadModel(file, named) {
  const mod = await import(`../models/${file}`);
  return mod.default || (named && mod[named]) || Object.values(mod).find(v => v && v.modelName);
}

const anomalies = [];
const queriesUsed = [];
const flag = (sev, title, detail, grep = null, fix = null) => anomalies.push({ sev, title, detail, grep, fix });
const q = (label, code) => queriesUsed.push({ label, code });

await mongoose.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
mongoose.set('strictQuery', true);

const Party   = await loadModel('Party.js');
const Photo   = await loadModel('Photo.js', 'Photo');
const HPH     = await loadModel('HostPlaybackHistory.js');
const Guest   = await loadModel('GuestSession.js');
const EventLg = await loadModel('EventLog.js', 'EventLog');

// ── --list ──
if (ARG === '--list') {
  const ps = await Party.find({}, {
    code: 1, createdAt: 1, endedAt: 1, 'lifecycle.status': 1,
    streamingProvider: 1, participants: 1, suggestions: 1, photos: 1, messages: 1,
    trackHistory: 1, isDemoParty: 1, isJustPlay: 1
  }).sort({ createdAt: -1 }).limit(20).lean();
  console.log(table(
    ['code', 'créée', 'statut', 'provider', 'guests', 'sugg', 'photos', 'msg', 'tracks', 'flags'],
    ps.map(p => [p.code, iso(p.createdAt), (p.lifecycle && p.lifecycle.status) || '—', p.streamingProvider || '—',
      (p.participants || []).length, (p.suggestions || []).length, (p.photos || []).length,
      (p.messages || []).length, (p.trackHistory || []).length,
      [p.isDemoParty && 'demo', p.isJustPlay && 'justplay', p.endedAt && 'ended'].filter(Boolean).join('+') || '—'])
  ));
  await mongoose.disconnect();
  process.exit(0);
}

const CODE = ARG.toUpperCase();

// ═══════════ ÉTAPE 0 — Party + fenêtre temporelle ═══════════
q('Étape 0 — party', `Party.findOne({ code: '${CODE}' }).lean()`);
const party = await Party.findOne({ code: CODE }).lean();
if (!party) {
  console.error(`❌ Aucune soirée avec le code ${CODE}. Lancer --list pour voir les codes existants.`);
  await mongoose.disconnect();
  process.exit(1);
}

const T0 = ts(party.lifecycle && party.lifecycle.startedAt) || ts(party.createdAt);
const TF = ts(party.endedAt) || ts(party.lifecycle && party.lifecycle.lastActivityAt) || Date.now();
const openEnded = !party.endedAt;
const totalMs = T0 && TF ? TF - T0 : null;

const suggestions  = Array.isArray(party.suggestions) ? party.suggestions : [];
const participants = Array.isArray(party.participants) ? party.participants : [];
const messages     = Array.isArray(party.messages) ? party.messages : [];
const embPhotos    = Array.isArray(party.photos) ? party.photos : [];
const history      = Array.isArray(party.trackHistory) ? party.trackHistory : []; // newest-first (cappedUnshift)
const scores       = (party.participantScores && typeof party.participantScores === 'object') ? party.participantScores : {};

if (!party.hostUserId) flag('P0', 'hostUserId absent sur la Party',
  'party.hostUserId est null → aucune friendship ni scoring host fiable possible.',
  "Party.countDocuments({ hostUserId: null })",
  'Injecter le hostUserId Supabase dans host:startParty (cf. audit 9ZNH4U bug racine #1).');

// ═══════════ ÉTAPE 1 — Invités ═══════════
q('Étape 1 — GuestSession', `GuestSession.find({ partyCode: '${CODE}' }).lean()`);
const guestSessions = await Guest.find({ partyCode: CODE }).lean();

const sugByAuthor = new Map();
for (const s of suggestions) {
  const k = s.authorUserId || s.guestId || s.suggestedBy || '(inconnu)';
  sugByAuthor.set(String(k), (sugByAuthor.get(String(k)) || 0) + 1);
}
const boostsByUser = new Map();
for (const s of suggestions) for (const b of (Array.isArray(s.boostedBy) ? s.boostedBy : [])) {
  boostsByUser.set(String(b), (boostsByUser.get(String(b)) || 0) + 1);
}
const msgByAuthor = new Map();
for (const m of messages) {
  const k = m.authorUserId || m.guestName || '(inconnu)';
  msgByAuthor.set(String(k), (msgByAuthor.get(String(k)) || 0) + 1);
}

const pRows = participants.map(p => {
  const id = p.userId ? String(p.userId) : (p.id || '—');
  return [p.isHost ? '🎧 host' : 'guest', p.name || '—', id.slice(0, 26),
    p.userId ? (OID_RE.test(String(p.userId)) ? 'ObjectId' : (LEGACY_GUEST_RE.test(String(p.userId)) ? 'legacy' : 'autre')) : 'absent',
    iso(p.joinedAt), p.connected === false ? 'déco' : 'ok',
    sugByAuthor.get(id) || 0, boostsByUser.get(id) || 0, msgByAuthor.get(p.name) || msgByAuthor.get(id) || 0];
});

const noUserId  = participants.filter(p => !p.userId);
const legacyIds = participants.filter(p => p.userId && !OID_RE.test(String(p.userId)));
const orphans   = participants.filter(p => p.connected === false);
const emailMap  = new Map();
for (const p of participants) {
  const e = (p.email || '').toLowerCase().trim();
  if (!e) continue;
  if (!emailMap.has(e)) emailMap.set(e, new Set());
  emailMap.get(e).add(String(p.userId || p.id || '?'));
}
const multiId = [...emailMap.entries()].filter(([, ids]) => ids.size > 1);

if (noUserId.length) flag('P1', `${noUserId.length} participant(s) sans userId`,
  `Participants concernés : ${noUserId.map(p => p.name || '?').join(', ')}. Sans userId : pas de friendship, pas de scoring cross-party.`,
  "Party.aggregate([{ $unwind: '$participants' }, { $match: { 'participants.userId': null } }, { $group: { _id: '$code', n: { $sum: 1 } } }])");
if (multiId.length) flag('P1', `${multiId.length} email(s) avec plusieurs userId (pattern Task #21)`,
  multiId.map(([e, ids]) => `${e} → ${[...ids].join(' / ')}`).join(' ; '),
  "Party.aggregate([{ $unwind: '$participants' }, { $group: { _id: '$participants.email', ids: { $addToSet: '$participants.userId' } } }, { $match: { 'ids.1': { $exists: true } } }])",
  'Consolidation multi-userId (Task #21).');

// ═══════════ ÉTAPE 2 — Photos ═══════════
q('Étape 2 — Photos', `Photo.find({ partyCode: '${CODE}' }).lean()   // ⚠ indexée par partyCode, PAS partyId`);
const photos = await Photo.find({ partyCode: CODE }).lean();
const photosLive    = photos.filter(p => !p.deletedAt);
const photosDeleted = photos.filter(p => p.deletedAt);
const photosNoOwner = photos.filter(p => !p.uploaderUserId);
const photoKB = photos.reduce((a, p) => a + (p.sizeKB || 0), 0);

const photoByUploader = new Map();
for (const p of photos) {
  const k = p.uploaderUserId || `(null:${p.guestName || '?'})`;
  photoByUploader.set(String(k), (photoByUploader.get(String(k)) || 0) + 1);
}

const photoDelta = embPhotos.length - photosLive.length;
if (photoDelta !== 0) flag('P1', `Divergence photos embedded (${embPhotos.length}) vs collection Photo vivantes (${photosLive.length})`,
  `Delta = ${photoDelta > 0 ? '+' : ''}${photoDelta}. Pattern Task #20 (la galerie affiche N, la BDD en a M).`,
  "// comparer party.photos.length vs Photo.countDocuments({ partyCode, deletedAt: null }) sur toutes les soirées");
if (photosNoOwner.length) flag('P1', `${photosNoOwner.length}/${photos.length} photo(s) sans uploaderUserId (ACL Task #39)`,
  'Sans uploaderUserId, aucune ACL de suppression possible pour ces photos.',
  "Photo.countDocuments({ uploaderUserId: null })");
const embNoId = embPhotos.filter(p => !p.id && !p._id);
if (embNoId.length) flag('P1', `${embNoId.length}/${embPhotos.length} photo(s) embedded sans champ id (bug #71)`,
  'Le push dans party.photos ne porte pas le Photo._id → impossible de relier embedded ↔ collection.',
  "// grep server.js: party.photos.push( → vérifier présence de id: photoDoc._id",
  'Ajouter `id: photoDoc._id` au push (fix bug #71, audit 9ZNH4U).');

// ═══════════ ÉTAPE 3 — Messages ═══════════
const msgLens = messages.map(m => (m.message || '').length).filter(n => n > 0);
const msgNoAuthor = messages.filter(m => !m.authorUserId);
if (messages.length && msgNoAuthor.length) flag('P2', `${msgNoAuthor.length}/${messages.length} message(s) sans authorUserId`,
  'ACL delete message (prep #39 V1.1) inopérante sur ces messages.',
  "// party.messages[].authorUserId null sur quelles soirées");

// ═══════════ ÉTAPES 4 & 6 — Boosts / Scores ═══════════
let totalBoostedBy = 0, totalBoostCount = 0, totalBoostedByUsers = 0;
const incoherent = [];
const boostersSet = new Set();
let bbuNoPhoto = 0, bbuAnon = 0;

for (const s of suggestions) {
  const bb  = Array.isArray(s.boostedBy) ? s.boostedBy : [];
  const bbu = Array.isArray(s.boostedByUsers) ? s.boostedByUsers : [];
  const bc  = typeof s.boostCount === 'number' ? s.boostCount : null;
  totalBoostedBy += bb.length; totalBoostedByUsers += bbu.length; totalBoostCount += (bc || 0);
  bb.forEach(b => boostersSet.add(String(b)));
  for (const u of bbu) { if (!u || !u.photoURL) bbuNoPhoto++; if (!u || !u.userId || u.firstName === 'Un invité') bbuAnon++; }
  if (bc !== null && bc !== bb.length) incoherent.push({ t: s.title, bc, bb: bb.length, bbu: bbu.length });
  if (bb.length !== new Set(bb.map(String)).size) flag('P1', `Double-boost détecté sur "${s.title}"`,
    `boostedBy contient des doublons : ${bb.join(', ')}`,
    "// suggestions[].boostedBy avec doublons sur toutes les soirées");
}
if (incoherent.length) flag('P1', `${incoherent.length} suggestion(s) avec boostCount ≠ boostedBy.length`,
  incoherent.slice(0, 8).map(i => `"${i.t}" : boostCount=${i.bc} vs boostedBy=${i.bb} (boostedByUsers=${i.bbu})`).join(' ; '),
  "// drift compteur vs source de vérité (pattern Task #7 RAM↔Mongo)",
  'Recalculer boostCount depuis boostedBy.length au write-time, ou le supprimer comme champ dérivé.');

// ═══════════ ÉTAPE 5 — Suggestions ═══════════
const byStatus = new Map();
for (const s of suggestions) byStatus.set(s.status || '(absent)', (byStatus.get(s.status || '(absent)') || 0) + 1);
const withAuthor   = suggestions.filter(s => s.authorUserId);
const withSuggBy   = suggestions.filter(s => s.suggestedBy);
const withSuggUser = suggestions.filter(s => s.suggestedByUser);
const playedSug    = suggestions.filter(s => s.status === 'played');
const notPlayed    = suggestions.filter(s => s.status !== 'played');
const latencies    = playedSug.map(s => (ts(s.playedAt) && ts(s.sentAt)) ? ts(s.playedAt) - ts(s.sentAt) : null).filter(Boolean).sort((a, b) => a - b);

if (suggestions.length && withAuthor.length < suggestions.length) flag('P1',
  `${suggestions.length - withAuthor.length}/${suggestions.length} suggestion(s) sans authorUserId (Task #43)`,
  'Sans authorUserId, isMine côté serveur retombe sur les fallbacks (guestId/socketId) → "Mes suggestions" peut être faux cross-session.',
  "Party.aggregate([{ $unwind: '$suggestions' }, { $match: { 'suggestions.authorUserId': null } }, { $group: { _id: '$code', n: { $sum: 1 } } }])");
if (suggestions.length && withSuggUser.length < suggestions.length) flag('P2',
  `${suggestions.length - withSuggUser.length}/${suggestions.length} suggestion(s) sans suggestedByUser (Task #44)`,
  "Snapshot d'enrichissement absent → avatar/prénom résolus à la lecture, ou pas du tout.",
  "// % suggestedByUser non null par date de soirée (mesure l'effet du deploy #44)");

const socketLike = suggestions.filter(s => !s.suggestedBy && s.authorUserId);
if (socketLike.length) flag('P2', `${socketLike.length} suggestion(s) avec authorUserId mais sans suggestedBy`,
  "Cohérent avec le write-through Socket.IO (server.js ~L6945) qui omet suggestedBy alors que la voie REST (routes/party-suggest.js L66) l'écrit. Divergence de schéma entre les 2 chemins d'écriture.",
  "// grep server.js vs routes/party-suggest.js : champs du $push suggestions",
  "Aligner les deux chemins d'écriture sur le même jeu de champs.");

// ═══════════ ÉTAPE 7 — Titres joués (HPH + trackHistory) ═══════════
q('Étape 7 — HPH', `HostPlaybackHistory.find({ $or: [{ partyId: ObjectId('${party._id}') }, { partyCode: '${CODE}' }] }).sort({ playedAt: 1 }).lean()`);
const hph = await HPH.find({ $or: [{ partyId: party._id }, { partyCode: CODE }] }).sort({ playedAt: 1 }).lean();
const histChrono = [...history].reverse(); // trackHistory est newest-first

const hphDelta = histChrono.length - hph.length;
if (hphDelta !== 0) flag(hphDelta > 0 ? 'P1' : 'P2',
  `Delta trackHistory (${histChrono.length}) vs HostPlaybackHistory (${hph.length}) = ${hphDelta > 0 ? '+' : ''}${hphDelta}`,
  hphDelta > 0
    ? `${hphDelta} write(s) HPH perdu(s) silencieusement — pattern fire-and-forget (Chantier 4). Aucun alerting.`
    : `${-hphDelta} doc(s) HPH sans équivalent dans trackHistory (cap 500 atteint ? dedup bug #87 ? réouverture de soirée ?).`,
  "// pour chaque party : party.trackHistory.length vs HPH.countDocuments({ partyId })",
  'Wrapper safePersist + alerting sur échec de write (Chantier 4).');

const hphZeroVotes = hph.filter(h => !h.voteScore || (!h.voteScore.feu && !h.voteScore.cool && !h.voteScore.bof));
if (hph.length && hphZeroVotes.length === hph.length) flag('P1',
  `TOUS les HPH (${hph.length}) ont voteScore à 0 (pattern Task #40)`,
  "Le snapshot de votes n'arrive jamais dans HPH alors que trackHistory porte fireCount/likeCount/mehCount.",
  "HostPlaybackHistory.countDocuments({ 'voteScore.feu': 0, 'voteScore.cool': 0, 'voteScore.bof': 0 })");

const seen = new Map();
const repeats = [];
for (const t of histChrono) {
  const k = (t.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!k) continue;
  if (seen.has(k)) repeats.push(t.title); else seen.set(k, 1);
}
if (repeats.length) flag('P2', `${repeats.length} titre(s) rejoué(s) dans la même soirée`,
  repeats.slice(0, 10).join(' ; '),
  "// playedKeys anti-replay : vérifier party.playedKeys vs doublons trackHistory");

// ═══════════ ÉTAPE 8 — Phases ═══════════
const phaseSeq = [];
for (const t of histChrono) {
  const ph = t.phase || 'unknown';
  const at = ts(t.playedAt);
  if (!phaseSeq.length || phaseSeq[phaseSeq.length - 1].phase !== ph) phaseSeq.push({ phase: ph, from: at, n: 1 });
  else { phaseSeq[phaseSeq.length - 1].n++; phaseSeq[phaseSeq.length - 1].to = at; }
}
const PHASE_ORDER = ['arrival', 'ambiance', 'takeoff', 'groove', 'party', 'closing'];
const rollbacks = [];
for (let i = 1; i < phaseSeq.length; i++) {
  const a = PHASE_ORDER.indexOf(phaseSeq[i - 1].phase), b = PHASE_ORDER.indexOf(phaseSeq[i].phase);
  if (a >= 0 && b >= 0 && b < a) rollbacks.push(`${phaseSeq[i - 1].phase} → ${phaseSeq[i].phase}`);
}
if (rollbacks.length) flag('P2', `${rollbacks.length} retour(s) arrière de phase`,
  rollbacks.join(' ; ') + " — à confronter à la doctrine phases (un rollback peut être volontaire côté host).",
  "// séquence trackHistory[].phase sur les dernières soirées");

const unknownPhase = histChrono.filter(t => !t.phase || t.phase === 'unknown');
if (unknownPhase.length) flag('P2', `${unknownPhase.length}/${histChrono.length} track(s) jouée(s) avec phase 'unknown'/absente`,
  "currentPhase n'était pas résolu au moment du push trackHistory.",
  "// trackHistory[].phase = 'unknown' cross-party");

// ═══════════ ÉTAPE 9 — Évolution 15 min ═══════════
const buckets = new Map();
const bucketOf = (t) => (t && T0 ? Math.floor((t - T0) / (15 * 60 * 1000)) : null);
const addEvt = (t, kind) => {
  const b = bucketOf(t); if (b === null || b < 0) return;
  if (!buckets.has(b)) buckets.set(b, { sug: 0, photo: 0, msg: 0, track: 0, join: 0 });
  buckets.get(b)[kind]++;
};
suggestions.forEach(s => addEvt(ts(s.sentAt), 'sug'));
messages.forEach(m => addEvt(ts(m.sentAt), 'msg'));
photos.forEach(p => addEvt(ts(p.sentAt || p.createdAt), 'photo'));
histChrono.forEach(t => addEvt(ts(t.playedAt), 'track'));
participants.forEach(p => addEvt(ts(p.joinedAt), 'join'));

const bRows = [...buckets.keys()].sort((a, b) => a - b).map(b => {
  const v = buckets.get(b);
  const lbl = `T+${String(Math.floor(b * 15 / 60)).padStart(2, '0')}h${String((b * 15) % 60).padStart(2, '0')}`;
  return [lbl, v.join, v.sug, v.photo, v.msg, v.track];
});

// ═══════════ ÉTAPE 10 — Provider ═══════════
const provCount = new Map();
for (const t of histChrono) { const p = t.provider || t.source || '(absent)'; provCount.set(p, (provCount.get(p) || 0) + 1); }
const hphProv = new Map();
for (const h of hph) { const p = h.provider || '(null)'; hphProv.set(p, (hphProv.get(p) || 0) + 1); }
const sugProv = new Map();
for (const s of suggestions) {
  const p = s.deezerID ? 'deezer' : s.spotifyId ? 'spotify' : s.appleMusicId ? 'apple' : s.trackId ? 'trackId-seul' : '(indéterminé)';
  sugProv.set(p, (sugProv.get(p) || 0) + 1);
}

// ═══════════ ÉTAPE 11 — Stabilité (EventLog) ═══════════
q('Étape 11 — EventLog', `EventLog.find({ partyCode: '${CODE}' }).lean()   // TTL 30 jours`);
let events = [];
let eventsNote = null;
try {
  events = await EventLg.find({ partyCode: CODE }).lean();
  if (!events.length) {
    const ageDays = T0 ? Math.round((Date.now() - T0) / 86400000) : null;
    eventsNote = (ageDays !== null && ageDays > 30)
      ? NA(`EventLog a un TTL de 30 jours et la soirée date de ${ageDays} jours`)
      : NA('aucun EventLog pour cette soirée (logEvent n\'est appelé que sur certains handlers)');
  }
} catch (e) { eventsNote = NA(`lecture EventLog impossible : ${e.message}`); }

const evByType = new Map(), evByDecision = new Map();
for (const e of events) {
  evByType.set(e.eventType, (evByType.get(e.eventType) || 0) + 1);
  evByDecision.set(e.decision || '(absent)', (evByDecision.get(e.decision || '(absent)') || 0) + 1);
}
const rejected = events.filter(e => e.decision === 'rejected');
if (rejected.length) flag('P2', `${rejected.length} événement(s) rejeté(s) côté serveur`,
  [...new Set(rejected.map(e => e.eventType))].join(', ') + ` — sur ${events.length} events tracés.`,
  "EventLog.aggregate([{ $match: { decision: 'rejected' } }, { $group: { _id: '$eventType', n: { $sum: 1 } } }])");

// ═══════════ Incohérences de compteurs dénormalisés ═══════════
if (typeof party.trackCount === 'number' && party.trackCount !== history.length)
  flag('P2', `Compteur trackCount (${party.trackCount}) ≠ trackHistory réel (${history.length})`,
    'Le pre-save qui maintient trackCount ne se déclenche pas sur les écritures atomiques ($push/updateOne).',
    "Party.aggregate([{ $project: { code: 1, trackCount: 1, real: { $size: { $ifNull: ['$trackHistory', []] } } } }, { $match: { $expr: { $ne: ['$trackCount', '$real'] } } }])");
if (typeof party.participantCount === 'number' && party.participantCount !== participants.length)
  flag('P2', `Compteur participantCount (${party.participantCount}) ≠ participants réel (${participants.length})`,
    'Même cause : compteur dénormalisé non maintenu par les updates atomiques.',
    "Party.aggregate([{ $project: { code: 1, participantCount: 1, real: { $size: { $ifNull: ['$participants', []] } } } }, { $match: { $expr: { $ne: ['$participantCount', '$real'] } } }])");
if (typeof party.photoCount === 'number' && party.photoCount !== photos.length)
  flag('P2', `Compteur photoCount (${party.photoCount}) ≠ collection Photo (${photos.length})`,
    'Compteur dénormalisé désynchronisé de la collection Photo.',
    "// comparer party.photoCount vs Photo.countDocuments({ partyCode }) sur toutes les soirées");

// ═══════════ Doctrine 3.9 — élargissement cross-party ═══════════
const global = {};
try {
  global.partiesTotal      = await Party.countDocuments({});
  global.partiesNoHostUser = await Party.countDocuments({ hostUserId: null });
  global.photosNoUploader  = await Photo.countDocuments({ uploaderUserId: null });
  global.photosTotal       = await Photo.countDocuments({});
  global.hphZeroVote       = await HPH.countDocuments({ 'voteScore.feu': 0, 'voteScore.cool': 0, 'voteScore.bof': 0 });
  global.hphTotal          = await HPH.countDocuments({});
  q('Doctrine 3.9 — élargissement', "Party.countDocuments({ hostUserId: null }) / Photo.countDocuments({ uploaderUserId: null }) / HPH.countDocuments({ 'voteScore.feu': 0, 'voteScore.cool': 0, 'voteScore.bof': 0 })");
} catch (e) { global.error = e.message; }

// ═══════════ Note stabilité ═══════════
let note = 10;
for (const a of anomalies) note -= (a.sev === 'P0' ? 3 : a.sev === 'P1' ? 1.5 : 0.5);
note = Math.max(0, Math.min(10, note)).toFixed(1);

// ═══════════ RAPPORT ═══════════
const today = new Date().toISOString().slice(0, 10);
const L = [];
const P = (...x) => { for (const line of x) if (line !== null && line !== undefined) L.push(line); };

P(`# AUDIT SOIRÉE ${CODE} — ${(iso(party.createdAt) || '').slice(0, 10)}`, '',
  `> Généré le ${today} par \`scripts/audit-soiree.mjs\` — **READ-ONLY** (aucune mutation).`,
  '> Doctrine facts only : toute donnée absente est notée `N/A — raison`, jamais devinée.', '');

P('## 📊 Résumé exécutif', '',
  `**Note stabilité : ${note}/10** (10 − 3/P0 − 1,5/P1 − 0,5/P2)`, '',
  `- Soirée \`${CODE}\` — ${iso(T0)} → ${openEnded ? '**non terminée**' : iso(TF)} (${dur(totalMs)})`,
  `- ${participants.length} participants · ${suggestions.length} suggestions · ${totalBoostedBy} boosts · ${photosLive.length} photos vivantes · ${messages.length} messages · ${histChrono.length} titres joués`,
  `- Anomalies : **${anomalies.filter(a => a.sev === 'P0').length} P0**, ${anomalies.filter(a => a.sev === 'P1').length} P1, ${anomalies.filter(a => a.sev === 'P2').length} P2`, '');

P('### Points forts');
const forts = [];
if (hphDelta === 0 && histChrono.length) forts.push(`Persistance lecture intègre : trackHistory (${histChrono.length}) = HPH (${hph.length}), zéro write perdu.`);
if (suggestions.length && withAuthor.length === suggestions.length) forts.push('100% des suggestions ont un authorUserId (Task #43 OK).');
if (suggestions.length && withSuggUser.length === suggestions.length) forts.push('100% des suggestions ont le snapshot suggestedByUser (Task #44 OK).');
if (photos.length && !photosNoOwner.length) forts.push('100% des photos ont un uploaderUserId (ACL #39 OK).');
if (suggestions.length && !incoherent.length) forts.push('boostCount cohérent avec boostedBy sur toutes les suggestions.');
if (party.hostUserId) forts.push(`hostUserId présent sur la Party (${party.hostUserId}).`);
if (photos.length && photoDelta === 0) forts.push(`Photos cohérentes entre embedded (${embPhotos.length}) et collection (${photosLive.length}).`);
P(...(forts.length ? forts.slice(0, 5).map(f => `- ✅ ${f}`) : [`- ${NA('aucun indicateur au vert sur cette soirée')}`]), '');

P('### Points faibles / bugs');
P(...(anomalies.length
  ? anomalies.slice().sort((a, b) => a.sev.localeCompare(b.sev)).slice(0, 5).map(a => `- 🚨 **[${a.sev}]** ${a.title}`)
  : ['- _(aucune anomalie détectée)_']), '');

P('### Reco actions correctives');
const recos = anomalies.filter(a => a.fix).slice(0, 5).map((a, i) => `${i + 1}. **[${a.sev}]** ${a.fix}`);
P(...(recos.length ? recos : ['- _(rien à corriger au vu des données lues)_']), '');

P('', '---', '', '## 0. Identité & fenêtre temporelle', '',
  table(['champ', 'valeur'], [
    ['_id', party._id],
    ['code', party.code],
    ['hostUserId', party.hostUserId || NA('null en base')],
    ['hostProfile.name', (party.hostProfile && (party.hostProfile.name || party.hostProfile.firstName)) || NA('hostProfile absent')],
    ['partyType / mode', `${party.partyType || '—'} / ${party.mode || '—'}`],
    ['lifecycle.status', (party.lifecycle && party.lifecycle.status) || NA('absent')],
    ['lifecycle.startedAt (T0)', iso(party.lifecycle && party.lifecycle.startedAt) || NA('absent, fallback createdAt')],
    ['createdAt', iso(party.createdAt)],
    ['endedAt (Tfinal)', iso(party.endedAt) || NA('soirée non clôturée')],
    ['lifecycle.lastActivityAt', iso(party.lifecycle && party.lifecycle.lastActivityAt) || NA('absent')],
    ['durée totale', dur(totalMs)],
    ['currentPhase (à la lecture)', party.currentPhase || NA('absent')],
    ['phaseStartedAt', iso(party.phaseStartedAt) || NA('null — phase non horodatée')],
    ['streamingProvider', party.streamingProvider || NA('null en base')],
    ['visibility / afterglowVisibility', `${party.visibility || '—'} / ${party.afterglowVisibility || NA('null = hérite de visibility')}`],
    ['isJustPlay / savedToAfterglow', `${!!party.isJustPlay} / ${!!party.savedToAfterglow}`],
    ['isDemoParty', !!party.isDemoParty],
    ['afterglowOpenedAt', NA('champ inexistant dans le schéma Party')],
    ['trackCount (compteur)', `${party.trackCount === undefined ? NA('absent') : party.trackCount} — trackHistory réel : ${history.length}`],
    ['participantCount (compteur)', `${party.participantCount === undefined ? NA('absent') : party.participantCount} — participants réel : ${participants.length}`],
    ['photoCount (compteur)', `${party.photoCount === undefined ? NA('absent') : party.photoCount} — collection Photo : ${photos.length}`],
    ['playedKeys (anti-replay)', (party.playedKeys || []).length],
  ]), '',
  '**Vérification de schéma (clés réellement présentes sur les objets `Mixed`)** — garantit que les compteurs portent sur les bons champs :', '',
  table(['objet', 'clés observées sur le 1er élément'], [
    ['participants[0]', keysOf(participants[0])],
    ['suggestions[0]', keysOf(suggestions[0])],
    ['trackHistory[0]', keysOf(history[0])],
    ['messages[0]', keysOf(messages[0])],
    ['photos[0] (embedded)', keysOf(embPhotos[0])],
  ]), '');

P('## 1. Invités', '',
  `- \`party.participants\` : **${participants.length}** (dont ${participants.filter(p => p.isHost).length} host)`,
  `- \`GuestSession\` (partyCode) : **${guestSessions.length}**`,
  `- Participants sans \`userId\` : ${noUserId.length} · userId non-ObjectId : ${legacyIds.length} · marqués déconnectés : ${orphans.length}`,
  `- Ratio identité forte (ObjectId) : ${pct(participants.filter(p => p.userId && OID_RE.test(String(p.userId))).length, participants.length)}`,
  `- Emails portant plusieurs userId : ${multiId.length}${multiId.length ? ' → ' + multiId.map(([e, i]) => `${e} (${i.size})`).join(', ') : ''}`,
  `- \`pendingGuests\` : ${(party.pendingGuests || []).length} · \`joinRequests\` : ${(party.joinRequests || []).length} · \`preApprovedGuests\` : ${(party.preApprovedGuests || []).length}`, '',
  table(['rôle', 'nom', 'id', 'type id', 'joinedAt', 'état', 'sugg', 'boosts', 'msg'], pRows), '',
  (guestSessions.length !== participants.filter(p => !p.isHost).length)
    ? `> ⚠️ Écart GuestSession (${guestSessions.length}) vs participants non-host (${participants.filter(p => !p.isHost).length}) — les deux sources ne sont pas alimentées par le même chemin de code.`
    : '> GuestSession et participants non-host concordent.', '');

P('## 2. Photos', '',
  `- Collection \`Photo\` (partyCode) : **${photos.length}** — vivantes ${photosLive.length}, supprimées (soft) ${photosDeleted.length}`,
  `- \`party.photos\` (embedded) : **${embPhotos.length}** → delta vs vivantes : ${photoDelta > 0 ? '+' : ''}${photoDelta}`,
  `- Sans \`uploaderUserId\` : ${photosNoOwner.length} (${pct(photosNoOwner.length, photos.length)})`,
  `- Embedded sans champ \`id\` : ${embNoId.length}/${embPhotos.length} (bug #71)`,
  `- Poids cumulé : ${photoKB ? `${(photoKB / 1024).toFixed(1)} Mo` : NA('sizeKB absent ou à 0 sur tous les docs')}`,
  `- Sources d'upload : ${[...new Set(photos.map(p => p.uploadSource || '(absent)'))].join(', ') || NA('aucune photo')}`,
  `- Première / dernière : ${photos.length ? `${iso(photos.map(p => ts(p.sentAt || p.createdAt)).filter(Boolean).sort((a, b) => a - b)[0])} → ${iso(photos.map(p => ts(p.sentAt || p.createdAt)).filter(Boolean).sort((a, b) => b - a)[0])}` : NA('aucune photo')}`, '',
  photosDeleted.length ? table(['photo', 'supprimée le', 'par'], photosDeleted.map(p => [p._id, iso(p.deletedAt), p.deletedBy || NA('deletedBy null')])) : '_(aucune suppression)_', '',
  '**Par uploader**', '',
  table(['uploaderUserId', 'photos'], [...photoByUploader.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])), '');

P('## 3. Messages', '',
  `- Total : **${messages.length}**`,
  `- Sans \`authorUserId\` : ${msgNoAuthor.length} (${pct(msgNoAuthor.length, messages.length)})`,
  `- Longueur moyenne : ${msgLens.length ? Math.round(msgLens.reduce((a, b) => a + b, 0) / msgLens.length) + ' caractères' : NA('aucun message')}`,
  `- Fréquence : ${(messages.length && totalMs) ? (messages.length / (totalMs / 60000)).toFixed(2) + ' msg/min' : NA('aucun message ou durée inconnue')}`,
  `- Modération : ${NA('aucun champ flagged/moderated dans l\'objet message (vérifié dans server.js guest:message)')}`, '',
  table(['auteur', 'messages'], [...msgByAuthor.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])), '');

P('## 4. Votes / Boosts', '',
  `- Boosts (somme \`boostedBy\`) : **${totalBoostedBy}** · somme \`boostCount\` : ${totalBoostCount} · somme \`boostedByUsers\` : ${totalBoostedByUsers}`,
  `- Boosters distincts : **${boostersSet.size}**`,
  `- \`boostedByUsers\` sans photoURL : ${bbuNoPhoto}/${totalBoostedByUsers} · anonymes ("Un invité" ou userId null) : ${bbuAnon}`,
  `- Cohérence boostCount = boostedBy.length : ${incoherent.length ? `❌ ${incoherent.length} écart(s)` : '✅ sur toutes les suggestions'}`,
  `- Répartition REST (Supabase JWT) vs Socket.IO : ${NA('aucun champ ne trace le canal d\'émission du boost')}`,
  `- Horodatage par boost : ${NA('boostedBy ne contient que des identifiants, sans timestamp → boosts non ventilables dans la timeline (§9)')}`, '',
  '**Top boosters**', '',
  table(['userId / guestId', 'boosts donnés'], [...boostsByUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => [k, v])), '',
  `- Votes de piste (\`guestVotes\`) : ${Object.keys(party.guestVotes || {}).length} entrée(s)`,
  `- Votes de genre (\`guestGenreVotes\`) : ${Object.keys(party.guestGenreVotes || {}).length} · \`genreVotes\` agrégés : ${Object.keys(party.genreVotes || {}).length}`,
  `- \`vibeScore\` : ${party.vibeScore === undefined ? NA('absent') : party.vibeScore}`,
  `- Concours déguisement : ${(party.costumeEntries || []).length} participation(s), ouvert = ${party.costumeOpen}`, '');

P('## 5. Suggestions', '',
  `- Total : **${suggestions.length}** (cap schéma : 200)`,
  `- Avec \`authorUserId\` : ${withAuthor.length} (${pct(withAuthor.length, suggestions.length)}) — Task #43`,
  `- Avec \`suggestedBy\` : ${withSuggBy.length} (${pct(withSuggBy.length, suggestions.length)})`,
  `- Avec \`suggestedByUser\` : ${withSuggUser.length} (${pct(withSuggUser.length, suggestions.length)}) — Task #44`,
  `- Jouées : ${playedSug.length} · non jouées : ${notPlayed.length} (${pct(notPlayed.length, suggestions.length)})`,
  `- Latence suggestion → lecture : ${latencies.length ? `médiane ${dur(latencies[Math.floor(latencies.length / 2)])} sur ${latencies.length} track(s)` : NA('aucune suggestion ne porte à la fois sentAt et playedAt')}`, '',
  '**Par statut**', '',
  table(['statut', 'n', '%'], [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, pct(v, suggestions.length)])), '',
  '**Par auteur**', '',
  table(['auteur (authorUserId ?? guestId)', 'suggestions'], [...sugByAuthor.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])), '',
  `> \`isMine\` côté serveur : ${NA('non testable en lecture seule — dépend du triple fallback Task #43 à l\'exécution de la route')}`, '');

P('## 6. Scores', '',
  `- \`participantScores\` : ${Object.keys(scores).length} entrée(s)`, '',
  table(['clé', 'valeur'], Object.entries(scores).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v])), '',
  '**Top 10 suggestions par boosts**', '',
  table(['#', 'titre', 'artiste', 'boostedBy', 'boostCount', 'statut'],
    suggestions.slice().sort((a, b) => ((b.boostedBy || []).length) - ((a.boostedBy || []).length)).slice(0, 10)
      .map((s, i) => [i + 1, s.title, s.artist, (s.boostedBy || []).length, s.boostCount === undefined ? '—' : s.boostCount, s.status || '—'])), '',
  `- Médiane boosts/suggestion : ${suggestions.length ? suggestions.map(s => (s.boostedBy || []).length).sort((a, b) => a - b)[Math.floor(suggestions.length / 2)] : NA('aucune suggestion')} · moyenne : ${suggestions.length ? (totalBoostedBy / suggestions.length).toFixed(2) : NA('aucune suggestion')}`,
  `- Cache RAM vs MongoDB : ${NA('la RAM du relay n\'est pas lisible depuis un script hors-process (Task #7 non vérifiable ici)')}`, '',
  Object.keys(scores).includes('host')
    ? '> La clé `host` dans participantScores est la défense E1 anti-doublon (comportement attendu, cf. audit 9ZNH4U — ne pas « corriger »).' : '', '');

P('## 7. Titres joués', '',
  `- \`trackHistory\` : **${histChrono.length}** (stocké newest-first, cap 500) · \`HostPlaybackHistory\` : **${hph.length}**`,
  `- Delta : ${hphDelta > 0 ? '+' : ''}${hphDelta} ${hphDelta === 0 ? '✅' : '🚨'}`,
  `- Somme brute du champ \`duration\` : ${(() => { const s = histChrono.reduce((a, t) => a + (Number(t.duration) || 0), 0); return s ? `${s} (${NA('unité non garantie par le schéma — ms ou s selon le provider, non convertie volontairement')})` : NA('champ duration absent ou nul sur toutes les tracks'); })()}`,
  `- Titres rejoués : ${repeats.length}`,
  `- HPH \`wasSuggestedByGuest\` : ${hph.filter(h => h.wasSuggestedByGuest).length}/${hph.length} · \`wasHostOverride\` : ${hph.filter(h => h.wasHostOverride).length}`,
  `- HPH avec \`skipReason\` : ${hph.filter(h => h.skipReason).length} (${[...new Set(hph.filter(h => h.skipReason).map(h => h.skipReason))].join(', ') || '—'})`,
  `- HPH \`voteScore\` tout à zéro : ${hphZeroVotes.length}/${hph.length}`,
  `- HPH sans \`trackId\` (hors catalogue) : ${hph.filter(h => !h.trackId).length}/${hph.length}`, '',
  '**Déroulé chronologique**', '',
  table(['#', 'playedAt', 'titre', 'artiste', 'phase', 'source/provider', 'bpm', '🔥/👍/👎', 'suggéré par'],
    histChrono.map((t, i) => [i + 1, (iso(t.playedAt) || '—').slice(11) || '—', t.title, t.artist, t.phase || '—',
      t.provider || t.source || '—', t.bpm || '—',
      `${t.fireCount === undefined ? 0 : t.fireCount}/${t.likeCount === undefined ? 0 : t.likeCount}/${t.mehCount === undefined ? 0 : t.mehCount}`,
      t.suggestedByName || t.suggestedBy || '—'])), '');

P('## 8. Phases & durées', '',
  `- Séquence reconstruite depuis \`trackHistory[].phase\` — ${NA('pas de champ phaseHistory dans le schéma Party')} :`, '',
  table(['phase', 'début', 'tracks'], phaseSeq.map(p => [p.phase, (iso(p.from) || '—').slice(11) || '—', p.n])), '',
  `- Retours arrière de phase : ${rollbacks.length ? rollbacks.join(' ; ') : 'aucun'}`,
  `- Tracks en phase \`unknown\`/absente : ${unknownPhase.length}/${histChrono.length}`,
  `- \`phaseStartedAt\` : ${iso(party.phaseStartedAt) || NA('null')}`,
  `- \`currentPhase\` figé en fin de soirée : ${party.currentPhase || NA('absent')}`,
  `- Cohérence afterglow : ${NA('aucun champ afterglowOpenedAt dans le schéma — non vérifiable')}`, '');

P('## 9. Évolution BDD (buckets 15 min)', '',
  table(['fenêtre', 'arrivées', 'suggestions', 'photos', 'messages', 'tracks'], bRows), '',
  `> Les boosts n'apparaissent pas dans ce tableau : \`boostedBy\` ne stocke aucun horodatage (${NA('boost non datable')}).`, '');

P('## 10. Provider & recherches', '',
  `- \`party.streamingProvider\` : ${party.streamingProvider || NA('null')}`, '',
  '**Par track jouée** (⚠️ le champ `provider` de trackHistory contient en réalité `historySource` — fix B3 assumé dans server.js L5530)', '',
  table(['provider/source', 'tracks'], [...provCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])), '',
  '**Par doc HPH** (vrai provider audio)', '',
  table(['provider', 'docs'], [...hphProv.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])), '',
  '**Par suggestion (déduit des identifiants portés)**', '',
  table(['indice provider', 'suggestions'], [...sugProv.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])), '',
  `- Taux de match des recherches : ${NA('les requêtes de recherche ne sont pas persistées en base')}`,
  `- Logs Render : ${NA('aucun accès réseau sortant depuis l\'environnement d\'exécution de cet audit — à consulter manuellement sur le dashboard Render')}`, '');

P('## 11. Stabilité & bugs', '',
  `- \`EventLog\` pour cette soirée : ${events.length}${eventsNote ? ` — ${eventsNote}` : ''}`, '',
  events.length ? table(['eventType', 'n'], [...evByType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])) : null,
  events.length ? '' : null,
  events.length ? table(['décision', 'n'], [...evByDecision.entries()].map(([k, v]) => [k, v])) : null,
  '',
  `- \`lifecycle.hostConnected\` : ${(party.lifecycle && party.lifecycle.hostConnected) === undefined ? NA('absent') : party.lifecycle.hostConnected} · \`hostDisconnectedAt\` : ${iso(party.lifecycle && party.lifecycle.hostDisconnectedAt) || NA('null')}`,
  `- \`lifecycle.endedBy\` : ${(party.lifecycle && party.lifecycle.endedBy) || NA('absent — soirée non clôturée explicitement')}`,
  `- \`mergedInto\` : ${party.mergedInto || NA('null')}`,
  `- Participants marqués déconnectés en fin de soirée (orphelins Task #22) : ${orphans.length}`,
  `- 500 / 401 / 403, interruptions AVAudioSession, mémoire : ${NA('ces signaux ne vivent que dans les logs Render, hors de portée réseau de cet audit')}`,
  `- Reconnexions par guest : ${NA('aucun compteur de reconnexion persisté — sessionTokens ne versionne pas les reconnexions')}`, '');

P('## 12. Restitution Afterglow', '',
  `- Appel de l'endpoint : ${NA('aucun accès HTTP sortant depuis cet environnement')}`,
  `- Données disponibles en base pour la restitution : ${histChrono.length} tracks, ${photosLive.length} photos vivantes, ${participants.length} participants, ${messages.length} messages.`,
  `- \`afterglowSaved\` : ${party.afterglowSaved} · \`savedToAfterglow\` : ${party.savedToAfterglow} · \`visibility\` : ${party.visibility} · \`afterglowVisibility\` : ${party.afterglowVisibility || NA('null = hérite de visibility')}`,
  (party.isJustPlay && !party.savedToAfterglow)
    ? "- ⚠️ Soirée `isJustPlay` **non** sauvegardée en Afterglow → exclusion attendue de la restitution (comportement V7 voulu, pas un bug)." : null,
  `- Parité host / guest : à tester manuellement (${NA('nécessite deux appels HTTP authentifiés')}).`, '');

P('## 13. Checklist audits habituels', '',
  table(['contrôle', 'résultat'], [
    ['Cross-user data leak (Fix #28 / #18)', NA('routes user-fire-votes / user-last-suggestions testables seulement en HTTP authentifié')],
    ['authorUserId cohérence (Task #43)', `${pct(withAuthor.length, suggestions.length)} des suggestions`],
    ['Cache RAM vs MongoDB (Task #7)', NA('RAM du relay hors-process')],
    ['Enrichissement boostedByUsers photoURL (#29)', totalBoostedByUsers ? `${pct(totalBoostedByUsers - bbuNoPhoto, totalBoostedByUsers)} avec photoURL` : NA('aucun boostedByUsers')],
    ['Enrichissement suggestedByUser (#44)', `${pct(withSuggUser.length, suggestions.length)} des suggestions`],
    ['Photos ACL uploaderUserId (#39)', photos.length ? `${pct(photos.length - photosNoOwner.length, photos.length)} avec uploaderUserId` : NA('aucune photo')],
    ['OG preview tags SSR (#41)', NA('nécessite un GET sur join.ahouai.com — pas de réseau sortant')],
    ['Legacy QR redirect bypass bot (#41)', NA('nécessite un GET avec User-Agent WhatsApp/Facebook')],
    ['Coller le lien guest web (#42)', NA('parseStreamingPaste est du code client, non observable en base')],
    ['Supabase vs legacy auth', `${pct(participants.filter(p => p.userId && OID_RE.test(String(p.userId))).length, participants.length)} des participants en identité forte`],
    ['Visibility strict mode (#10)', `visibility = ${party.visibility}, settings = ${JSON.stringify(party.settings || {})}`],
    ['Multi-userId consolidation (#21)', multiId.length ? `❌ ${multiId.length} email(s) concerné(s)` : '✅ aucun email multi-userId'],
    ['Doctrine 3.10 middleware order', NA('séquence de middleware visible uniquement dans les logs Render')],
  ]), '');

P('## 🚨 Anomalies détectées', '');
if (!anomalies.length) P('_Aucune anomalie détectée sur les données lisibles en base._', '');
else {
  const sorted = anomalies.slice().sort((x, y) => x.sev.localeCompare(y.sev));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    P(`### ${i + 1}. [${a.sev}] ${a.title}`, '', a.detail, '');
    if (a.grep) P('**Élargissement (doctrine 3.9)** :', '', '```js', a.grep, '```', '');
    if (a.fix) P(`**Fix connu** : ${a.fix}`, '');
    P(`**Reproductibilité** : \`node scripts/audit-soiree.mjs ${CODE}\` — anomalie calculée depuis la base, stable tant que la donnée n'est pas corrigée.`, '');
  }
}

P('### Élargissement cross-party exécuté', '',
  global.error ? NA(`élargissement impossible : ${global.error}`) : table(['indicateur global', 'valeur'], [
    ['Parties sans hostUserId', `${global.partiesNoHostUser} / ${global.partiesTotal} (${pct(global.partiesNoHostUser, global.partiesTotal)})`],
    ['Photos sans uploaderUserId', `${global.photosNoUploader} / ${global.photosTotal} (${pct(global.photosNoUploader, global.photosTotal)})`],
    ['HPH avec voteScore tout à zéro', `${global.hphZeroVote} / ${global.hphTotal} (${pct(global.hphZeroVote, global.hphTotal)})`],
  ]), '');

P('## 📎 Annexes', '', '### Requêtes utilisées (reproductibles)', '');
for (const { label, code } of queriesUsed) P(`**${label}**`, '', '```js', code, '```', '');
P('### Sources lues', '',
  '- `models/Party.js`, `models/Photo.js`, `models/HostPlaybackHistory.js`, `models/GuestSession.js`, `models/EventLog.js` — schémas de référence',
  '- `server.js` L5520-5572 (`trackDoc`), L5846 (push liveTrack), L6192 (objet `guest`), L6921 + L7084 (objets `suggestion`), L7630 (objet `msg`), L1360 + L3029 (`boostedByUsers`)',
  '- `routes/party-suggest.js` L56-110 (voie REST des suggestions)', '',
  '### Fenêtres de logs Render consultées', '',
  `- ${NA('aucune — pas de réseau sortant depuis l\'environnement d\'exécution de cet audit')}`, '',
  '---', '', "_Rapport read-only. Aucune PR corrective générée (consigne du protocole d'audit)._");

mkdirSync(AUDIT_DIR, { recursive: true });
const out = join(AUDIT_DIR, `${CODE}-${today.replace(/-/g, '')}.md`);
writeFileSync(out, L.join('\n'), 'utf8');

console.log(`✅ Rapport écrit : audits/${CODE}-${today.replace(/-/g, '')}.md`);
console.log(`   Note stabilité ${note}/10 — ${anomalies.filter(a => a.sev === 'P0').length} P0, ${anomalies.filter(a => a.sev === 'P1').length} P1, ${anomalies.filter(a => a.sev === 'P2').length} P2`);
for (const a of anomalies.slice().sort((x, y) => x.sev.localeCompare(y.sev))) console.log(`   [${a.sev}] ${a.title}`);

await mongoose.disconnect();
