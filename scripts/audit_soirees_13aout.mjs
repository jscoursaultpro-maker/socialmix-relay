// Audit BDD post-soirées test 12-13 août 2026
// Usage : MONGO_URI="mongodb+srv://..." node scripts/audit_soirees_13aout.mjs
// Répond à Jean-Sé : impact BDD, dernière lecture, suggestions, votes

import mongoose from 'mongoose';
import Party from '../models/Party.js';
import Track from '../models/Track.js';

const SINCE = new Date('2026-08-12T00:00:00Z'); // couvre 12 et 13 août

function mask(secret) {
  if (!secret) return '(vide)';
  return secret.slice(0, 4) + '...' + secret.slice(-4);
}

function fmtDate(d) {
  if (!d) return '(nul)';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

async function run() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI || MONGO_URI.includes('********')) {
    console.error('❌ MONGO_URI env variable required');
    console.error('   Usage: MONGO_URI="mongodb+srv://..." node scripts/audit_soirees_13aout.mjs');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  // ═══════════════════════════════════════════════════════════════
  // 1. PARTIES depuis 12/08 00:00 UTC
  // ═══════════════════════════════════════════════════════════════
  const parties = await Party.find({ createdAt: { $gte: SINCE } })
    .sort({ createdAt: -1 })
    .select('code createdAt endedAt currentPhase hostSecret participants suggestions guestVotes photos trackHistory lifecycle')
    .lean();

  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`📊 PARTIES depuis ${SINCE.toISOString().slice(0, 10)} : ${parties.length}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  for (const p of parties) {
    const guests = (p.participants || []).filter(x => !x.isHost).length;
    const suggestions = (p.suggestions || []).length;
    const trackHistory = (p.trackHistory || []).length;
    const photos = (p.photos || []).length;
    const votesPerGuest = Object.keys(p.guestVotes || {}).length;
    const totalVotes = Object.values(p.guestVotes || {})
      .reduce((sum, v) => sum + Object.keys(v || {}).length, 0);
    const status = p.lifecycle?.status || (p.endedAt ? 'ended' : 'live?');

    console.log(`─ ${p.code} ─`);
    console.log(`  createdAt    : ${fmtDate(p.createdAt)}`);
    console.log(`  endedAt      : ${fmtDate(p.endedAt)}`);
    console.log(`  status       : ${status}`);
    console.log(`  currentPhase : ${p.currentPhase}`);
    console.log(`  hostSecret   : ${mask(p.hostSecret)}`);
    console.log(`  guests       : ${guests}`);
    console.log(`  suggestions  : ${suggestions}`);
    console.log(`  trackHistory : ${trackHistory}`);
    console.log(`  photos       : ${photos}`);
    console.log(`  votes        : ${totalVotes} (${votesPerGuest} guests votants)`);
    console.log('');
  }

  if (parties.length === 0) {
    console.log('⚠️  Aucune party créée depuis le 12 août — bug persist ?\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. DERNIÈRE LECTURE DE TITRE
  // ═══════════════════════════════════════════════════════════════
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`🎵 DERNIÈRE LECTURE DE TITRE`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  if (parties.length > 0 && parties[0].trackHistory?.length > 0) {
    const last = parties[0].trackHistory[parties[0].trackHistory.length - 1];
    console.log(`  Party         : ${parties[0].code}`);
    console.log(`  Title         : ${last.title || '(nul)'}`);
    console.log(`  Artist        : ${last.artist || '(nul)'}`);
    console.log(`  Genre         : ${last.genre || '(nul)'}`);
    console.log(`  BPM           : ${last.bpm ?? '(nul)'}`);
    console.log(`  playedAt      : ${fmtDate(last.playedAt)}`);
    console.log(`  requestedBy   : ${last.requestedBy?.guestName || '(host)'}`);
  } else {
    console.log(`  ⚠️  Aucune track dans trackHistory des parties récentes`);
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // 3. SAMPLE SUGGESTIONS
  // ═══════════════════════════════════════════════════════════════
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`💡 SAMPLE SUGGESTIONS (5 dernières, toutes parties confondues)`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  const allSuggestions = parties.flatMap(p =>
    (p.suggestions || []).map(s => ({ ...s, _partyCode: p.code }))
  );
  allSuggestions.sort((a, b) => {
    const ta = new Date(a.timestamp || a.createdAt || 0).getTime();
    const tb = new Date(b.timestamp || b.createdAt || 0).getTime();
    return tb - ta;
  });
  const sample = allSuggestions.slice(0, 5);
  if (sample.length === 0) {
    console.log('  ⚠️  Aucune suggestion en base');
  } else {
    for (const s of sample) {
      console.log(`  [${s._partyCode}] "${s.title || s.trackTitle}" — ${s.artist || s.trackArtist}`);
      console.log(`     by ${s.guestName || '(anon)'} · status: ${s.suggestionStatus || s.status || '(nul)'} · played: ${s.played || false}`);
      console.log(`     boosts: ${s.boostCount || 0} · handled: ${s.isHandled || false}`);
    }
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // 4. SAMPLE VOTES
  // ═══════════════════════════════════════════════════════════════
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`🗳️  SAMPLE VOTES (parties récentes)`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  let voteFound = false;
  for (const p of parties) {
    const gv = p.guestVotes || {};
    for (const [guestId, tracks] of Object.entries(gv)) {
      for (const [trackTitle, vote] of Object.entries(tracks || {})) {
        console.log(`  [${p.code}] guest:${guestId.slice(0, 8)} → "${trackTitle}" = ${vote}`);
        voteFound = true;
      }
    }
  }
  if (!voteFound) {
    console.log('  ⚠️  Aucun vote en base pour parties récentes');
  }
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // 5. IMPACT SUR CATALOGUE TRACK (perfs mises à jour)
  // ═══════════════════════════════════════════════════════════════
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`📈 TRACKS mises à jour depuis ${SINCE.toISOString().slice(0, 10)}`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  const updatedTracks = await Track.find({ updatedAt: { $gte: SINCE } })
    .sort({ updatedAt: -1 })
    .limit(15)
    .select('title artist performance.totalPlays performance.feuRatio updatedAt')
    .lean();

  const totalUpdated = await Track.countDocuments({ updatedAt: { $gte: SINCE } });
  console.log(`  Total tracks touchées : ${totalUpdated}`);
  console.log(`  Sample 15 plus récentes :`);
  for (const t of updatedTracks) {
    const plays = t.performance?.totalPlays ?? 0;
    const feu = t.performance?.feuRatio?.toFixed(2) ?? '0.00';
    console.log(`    ${fmtDate(t.updatedAt).slice(0, 16)} · plays:${plays} feu:${feu} · "${t.title}" — ${t.artist}`);
  }
  console.log('');

  await mongoose.disconnect();
  console.log('✅ Done');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
