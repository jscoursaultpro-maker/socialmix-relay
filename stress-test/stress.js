/**
 * SocialMix Relay Server — Stress Test Harness
 *
 * Usage: see stress-test/README.md
 *
 * Protocol-faithful: all event names and payloads taken directly from server.js.
 * Every simulated guest reproduces the exact lifecycle of a real web guest.
 *
 * Scenarios:
 *   SINGLE_PARTY    — progressive ramp, one synthetic party
 *   MULTI_PARTY     — N parties concurrent, cross-party isolation check
 *   RECONNECT_STORM — 70% simultaneous disconnect + reconnect
 *   SOAK            — sustained load for leak detection
 *   HOST_UNDER_FIRE — join a REAL existing party (set PARTY_CODE)
 */

import { io } from 'socket.io-client';
import { writeFileSync, mkdirSync } from 'fs';
import { performance } from 'perf_hooks';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config (CLI env vars) ───────────────────────────────────────────
const TARGET_URL       = process.env.TARGET_URL       || 'http://localhost:3069';
const SCENARIO         = process.env.SCENARIO         || 'SINGLE_PARTY';
const PARTY_CODE       = process.env.PARTY_CODE       || '';   // HOST_UNDER_FIRE: real party code
const NUM_GUESTS       = parseInt(process.env.NUM_GUESTS       || '50');
const NUM_PARTIES      = parseInt(process.env.NUM_PARTIES      || '5');
const GUESTS_PER_PARTY = parseInt(process.env.GUESTS_PER_PARTY || '20');
const DURATION_SEC     = parseInt(process.env.DURATION_SEC     || '60');
const RAMP_SEC         = parseInt(process.env.RAMP_SEC         || '30');

// ─── Realistic test data ─────────────────────────────────────────────
const GENRES   = ['House', 'Electro', 'Pop', 'Hip-Hop', 'Disco', 'R&B', 'Latin', 'Afro'];
const TITLES   = ['Blinding Lights', 'Levitating', 'One Dance', 'Starboy', 'Shape of You',
                   'As It Was', 'Easy On Me', 'Heat Waves', 'Montero', 'good 4 u',
                   'Flowers', 'Unholy', 'Anti-Hero', 'About Damn Time', 'Break My Soul'];
const ARTISTS  = ['The Weeknd', 'Dua Lipa', 'Drake', 'Beyoncé', 'Ed Sheeran',
                   'Harry Styles', 'Adele', 'Glass Animals', 'Lil Nas X', 'Olivia Rodrigo',
                   'Miley Cyrus', 'Sam Smith', 'Taylor Swift', 'Lizzo', 'David Guetta'];
const EMOJIS   = ['🎉', '🔥', '🎵', '🎤', '💃', '🕺', '🎶', '⚡', '🌟', '🎸', '🫶', '😎'];
const MESSAGES = ['Trop bien ce son !', 'On adore !', 'Encore !', 'DJ t\'assures 🔥',
                   'Vibes au max', 'Mets du son !', 'Amazing !', 'On kiffe grave', 'Top !',
                   'Banger absolu 🔥', 'C\'est ma chanson 😭', 'La salle est en feu !'];
const COSTUME_EMOJIS = ['🦁', '🧛', '🧜', '🦊', '🐼', '🦄', '👻', '🤖', '🧚', '🐙'];
// Cloudinary demo URLs (vary them so the server's dedup hash doesn't block them)
const CLOUDINARY_PHOTOS = [
  'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  'https://res.cloudinary.com/demo/image/upload/cld-sample.jpg',
  'https://res.cloudinary.com/demo/image/upload/cld-sample-2.jpg',
  'https://res.cloudinary.com/demo/image/upload/cld-sample-3.jpg',
  'https://res.cloudinary.com/demo/image/upload/cld-sample-4.jpg',
];
const VOTE_TYPES = ['fire', 'like', 'meh'];

const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Metrics Collector ───────────────────────────────────────────────
const metrics = {
  latencies: [],
  votesEmitted: 0,
  votesReceived: 0,
  genreVotesSent: 0,
  costumeVotesSent: 0,
  sosBangerSent: 0,
  messagesSent: 0,
  messagesReceived: 0,
  suggestionsSent: 0,
  photosSent: 0,
  connectionsAttempted: 0,
  connectionsSucceeded: 0,
  disconnectsUnexpected: 0,
  reconnectsTotal: 0,
  reconnectsSucceeded: 0,
  reconnectsByClient: {},
  partyCrossLeaks: 0,
  errors: [],
  ramSamples: [],
  startTime: null,
  endTime: null,
};

function recordLatency(ms) { metrics.latencies.push(ms); }

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
function formatMs(ms) { return ms.toFixed(1) + 'ms'; }

// ─── Guest Factory ───────────────────────────────────────────────────
function createGuest(partyCode, guestIndex, partyIndex = 0, opts = {}) {
  const guestId    = randomUUID();
  const guestName  = opts.namePrefix
    ? `${opts.namePrefix}${guestIndex}`
    : `Guest${partyIndex}_${guestIndex}`;
  const guestEmoji  = pick(EMOJIS);
  const costumeEmoji = pick(COSTUME_EMOJIS);

  let socket       = null;
  let sessionToken = null;
  let connected    = false;
  let activityTimer = null;
  let ownPartyCode = partyCode;
  // Each guest has a stable "costume ID" for the contest
  let costumeId    = null;

  const state = {
    guestId, guestName, guestEmoji,
    joinTime: null, disconnects: 0, reconnects: 0,
    votesEmitted: 0, votesReceived: 0, messagesReceived: 0,
  };

  // ── Latency probe via genre vote ──────────────────────────────────
  function probeLatency() {
    if (!connected || !socket) return;
    const t0 = performance.now();
    socket.once('votes:update', () => recordLatency(performance.now() - t0));
    metrics.genreVotesSent++;
    socket.emit('guest:genreVote', { guestId, guestName, genre: pick(GENRES) });
  }

  // ── Full realistic activity loop ──────────────────────────────────
  function scheduleNextActivity() {
    if (activityTimer) return;
    const delay = rand(6000, 18000); // 6-18s between actions
    activityTimer = setTimeout(() => {
      activityTimer = null;
      if (!connected || !socket) return scheduleNextActivity();

      const roll = Math.random();

      if (roll < 0.30) {
        // ── Track vote (fire/like/meh) — most frequent ──
        const voteType    = pick(VOTE_TYPES);
        const trackTitle  = pick(TITLES);
        const trackArtist = pick(ARTISTS);
        const t0 = performance.now();
        metrics.votesEmitted++;
        state.votesEmitted++;
        socket.emit('guest:vote', {
          guestId, guestName,
          type: voteType,
          trackId: trackTitle,
          trackTitle,
          trackArtist,
          isrc: `ISRC${rand(100000, 999999)}`,
        });
        socket.once('guest:voted', () => {
          recordLatency(performance.now() - t0);
          metrics.votesReceived++;
          state.votesReceived++;
        });

      } else if (roll < 0.48) {
        // ── Genre vote (feeds DJ Brain) ──
        probeLatency();

      } else if (roll < 0.60) {
        // ── Chat message ──
        metrics.messagesSent++;
        const t0 = performance.now();
        socket.emit('guest:message', {
          guestId, guestName,
          message: pick(MESSAGES),
          guestEmoji,
        });
        socket.once('guest:message', () => {
          recordLatency(performance.now() - t0);
          metrics.messagesReceived++;
          state.messagesReceived++;
        });

      } else if (roll < 0.72) {
        // ── Suggestion (feeds DJ Brain) ──
        metrics.suggestionsSent++;
        const title = pick(TITLES);
        const t0 = performance.now();
        socket.emit('guest:suggest', {
          guestId, guestName,
          title,
          artist: pick(ARTISTS),
          deezerID: rand(100000, 999999),
          coverURL: '',
          duration: rand(180, 240),
          query: `${pick(ARTISTS)} ${title}`,
        });
        socket.once('suggestion:status', () => recordLatency(performance.now() - t0));

      } else if (roll < 0.81) {
        // ── Photo via Cloudinary URL (no base64 in stress test) ──
        metrics.photosSent++;
        socket.emit('guest:photo', {
          guestId, guestName,
          dataURL: pick(CLOUDINARY_PHOTOS),
          caption: `📸 Ambiance ${pick(['🔥', '🎉', '💃', '🕺'])}`,
        });

      } else if (roll < 0.89) {
        // ── Costume contest — enter OR vote ──
        if (!costumeId) {
          // First time: enter the contest
          costumeId = guestId;
          metrics.costumeVotesSent++;
          socket.emit('costume:enter', {
            guestId,
            guestName,
            emoji: costumeEmoji,
            photo: null,
          });
        } else {
          // Vote for someone else (or ourselves — server handles idempotent case)
          metrics.costumeVotesSent++;
          socket.emit('costume:vote', {
            voterId: guestId,
            targetId: guestId,  // simplified: vote for self (server deduplicates)
          });
        }

      } else if (roll < 0.95) {
        // ── Mission complete (earns points) ──
        const missions = ['dance', 'photo', 'suggestion_accepted', 'first_vote'];
        socket.emit('mission:complete', {
          guestId,
          participantId: guestId,
          name: guestName,
          mission: pick(missions),
          points: rand(10, 50),
        });

      } else {
        // ── SOS Banger — high-urgency suggestion (~5%) ──
        metrics.sosBangerSent++;
        const title = pick(TITLES);
        socket.emit('guest:suggest', {
          guestId, guestName,
          title,
          artist: pick(ARTISTS),
          deezerID: rand(100000, 999999),
          coverURL: '',
          duration: rand(180, 240),
          query: `${pick(ARTISTS)} ${title}`,
          sosBanger: true,      // SOS flag (forwarded as-is in suggestion payload)
          urgency: 'SOS',
        });
        metrics.suggestionsSent++;
        console.log(`  🚨 SOS BANGER: ${guestName} → "${title}"`);
      }

      scheduleNextActivity();
    }, delay);
  }

  // ── Socket lifecycle ──────────────────────────────────────────────
  function buildSocket() {
    metrics.connectionsAttempted++;
    const s = io(TARGET_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 10000,
    });

    s.on('connect', () => {
      connected = true;
      metrics.connectionsSucceeded++;
      state.joinTime = Date.now();
      s.emit('guest:join', {
        partyCode: ownPartyCode, name: guestName,
        guestName, emoji: guestEmoji, guestEmoji, guestId,
      });
    });

    s.on('party:state', (partyState) => {
      if (partyState.code && partyState.code !== ownPartyCode) {
        metrics.partyCrossLeaks++;
        metrics.errors.push(`CROSS_LEAK: ${guestName} in ${ownPartyCode} got state for ${partyState.code}`);
      }
      scheduleNextActivity();
    });

    s.on('session:token', (data) => { sessionToken = data.sessionToken; });

    s.on('party:wrongCode', (data) => {
      metrics.errors.push(`WRONG_CODE: ${guestName} → ${ownPartyCode}: ${data.message}`);
    });

    s.on('party:ended', () => { connected = false; cleanup(); });

    s.on('disconnect', (reason) => {
      connected = false;
      state.disconnects++;
      if (reason !== 'io client disconnect') metrics.disconnectsUnexpected++;
    });

    s.on('connect_error', (err) => {
      metrics.errors.push(`CONNECT_ERROR: ${guestName}: ${err.message}`);
    });

    return s;
  }

  function cleanup() {
    if (activityTimer) { clearTimeout(activityTimer); activityTimer = null; }
  }

  // ── Public API ────────────────────────────────────────────────────
  function connect() { socket = buildSocket(); }

  async function disconnect() {
    cleanup();
    if (socket && connected) {
      socket.emit('guest:left', { id: guestId, name: guestName });
      socket.disconnect();
    }
    connected = false;
  }

  async function reconnect() {
    metrics.reconnectsTotal++;
    state.reconnects++;
    metrics.reconnectsByClient[guestId] = (metrics.reconnectsByClient[guestId] || 0) + 1;
    cleanup();
    if (socket) { socket.removeAllListeners(); socket.disconnect(); }
    await sleep(rand(200, 1500));
    metrics.connectionsAttempted++;
    socket = io(TARGET_URL, { transports: ['websocket'], reconnection: false, timeout: 10000 });
    const t0 = performance.now();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Reconnect timeout for ${guestName}`)), 10000);

      socket.on('connect', () => {
        if (sessionToken) {
          socket.emit('guest:resume', { partyCode: ownPartyCode, sessionToken }, (ack) => {
            if (ack?.ok) {
              clearTimeout(timeout);
              connected = true;
              metrics.connectionsSucceeded++;
              metrics.reconnectsSucceeded++;
              recordLatency(performance.now() - t0);
              scheduleNextActivity();
              resolve();
            } else {
              socket.emit('guest:join', { partyCode: ownPartyCode, name: guestName, guestName, emoji: guestEmoji, guestEmoji, guestId });
            }
          });
        } else {
          socket.emit('guest:join', { partyCode: ownPartyCode, name: guestName, guestName, emoji: guestEmoji, guestEmoji, guestId });
        }
      });

      socket.on('party:state', () => {
        if (!connected) {
          clearTimeout(timeout);
          connected = true;
          metrics.connectionsSucceeded++;
          metrics.reconnectsSucceeded++;
          recordLatency(performance.now() - t0);
          scheduleNextActivity();
          resolve();
        }
      });

      socket.on('session:token', (data) => { sessionToken = data.sessionToken; });
      socket.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });
    }).catch(err => {
      metrics.errors.push(`RECONNECT_FAILED: ${guestName}: ${err.message}`);
    });
  }

  return { connect, disconnect, reconnect, state, get connected() { return connected; } };
}

// ─── Host simulator ──────────────────────────────────────────────────
function createHost(partyCode) {
  const hostSecret = randomUUID();
  let socket = null;
  let trackTimer = null;

  function start() {
    socket = io(TARGET_URL, { transports: ['websocket'], reconnection: false, timeout: 10000 });
    socket.on('connect', () => {
      socket.emit('host:startParty', {
        code: partyCode, hostSecret,
        profile: { name: `Host_${partyCode}`, emoji: '🎧' },
      });
      // Periodic track updates so guests have tracks to vote on
      trackTimer = setInterval(() => {
        if (!socket.connected) return;
        socket.emit('host:trackUpdate', {
          title: pick(['Blinding Lights', 'One Dance', 'Starboy', 'Levitating', 'As It Was']),
          artist: pick(['The Weeknd', 'Drake', 'Dua Lipa', 'Harry Styles']),
          genre: pick(GENRES),
          bpm: rand(100, 140),
          hostSecret,
        });
      }, 15000);
    });
  }

  function stop() {
    if (trackTimer) { clearInterval(trackTimer); trackTimer = null; }
    if (socket?.connected) {
      socket.emit('host:endParty', { hostSecret });
      socket.disconnect();
    }
  }

  return { start, stop, get connected() { return socket?.connected || false; } };
}

// ════════════════════════════════════════════════════════════
// SCENARIO: SINGLE_PARTY
// ════════════════════════════════════════════════════════════
async function scenarioSingleParty() {
  console.log(`\n🎯 SINGLE_PARTY | ${NUM_GUESTS} guests | ramp ${RAMP_SEC}s | sustain ${DURATION_SEC}s`);
  const CODE = 'STRESS01';
  const host = createHost(CODE);
  host.start();
  await sleep(1500);

  const guests = [];
  const rampInterval = (RAMP_SEC * 1000) / NUM_GUESTS;
  for (let i = 0; i < NUM_GUESTS; i++) {
    const g = createGuest(CODE, i);
    guests.push(g);
    g.connect();
    await sleep(rampInterval);
    if (i % 10 === 9) process.stdout.write(`  ↑ ${i + 1}/${NUM_GUESTS} ramped\n`);
  }

  console.log(`  ✅ All ${NUM_GUESTS} guests online. Sustaining ${DURATION_SEC}s...`);
  const ramTimer = setInterval(() => metrics.ramSamples.push({ ts: Date.now(), rssBytes: process.memoryUsage().rss }), 5000);
  await sleep(DURATION_SEC * 1000);
  clearInterval(ramTimer);
  for (const g of guests) await g.disconnect();
  host.stop();
  await sleep(500);
}

// ════════════════════════════════════════════════════════════
// SCENARIO: MULTI_PARTY
// ════════════════════════════════════════════════════════════
async function scenarioMultiParty() {
  console.log(`\n🎯 MULTI_PARTY | ${NUM_PARTIES} parties × ${GUESTS_PER_PARTY} guests`);
  const parties = [];
  for (let p = 0; p < NUM_PARTIES; p++) {
    const code = `STRMP${String(p + 1).padStart(2, '0')}`;
    const host = createHost(code);
    host.start();
    parties.push({ code, host, guests: [] });
  }
  await sleep(2000);
  for (const party of parties) {
    for (let i = 0; i < GUESTS_PER_PARTY; i++) {
      const g = createGuest(party.code, i, parties.indexOf(party));
      party.guests.push(g);
      g.connect();
      await sleep(50);
    }
  }
  console.log(`  ✅ ${NUM_PARTIES} parties populated. Running ${DURATION_SEC}s...`);
  await sleep(DURATION_SEC * 1000);
  for (const party of parties) {
    for (const g of party.guests) await g.disconnect();
    party.host.stop();
  }
  await sleep(500);
}

// ════════════════════════════════════════════════════════════
// SCENARIO: RECONNECT_STORM
// ════════════════════════════════════════════════════════════
async function scenarioReconnectStorm() {
  const TOTAL = NUM_GUESTS || 80;
  const DISCONNECT_PCT = 0.70;
  console.log(`\n🎯 RECONNECT_STORM | ${TOTAL} guests | disconnect ${DISCONNECT_PCT * 100}% simultaneously`);

  const CODE = 'STRCNX';
  const host = createHost(CODE);
  host.start();
  await sleep(1500);

  const guests = [];
  for (let i = 0; i < TOTAL; i++) {
    guests.push(createGuest(CODE, i));
    guests[guests.length - 1].connect();
    await sleep(100);
  }
  await sleep(5000);
  console.log(`  ✅ ${TOTAL} guests settled. Starting storm...`);

  const stormCount = Math.floor(TOTAL * DISCONNECT_PCT);
  const toDisconnect = guests.slice(0, stormCount);
  const stormStart = performance.now();

  await Promise.all(toDisconnect.map(g => g.disconnect()));
  console.log(`  ⚡ ${stormCount} guests disconnected simultaneously`);

  await Promise.all(toDisconnect.map(async (g) => {
    await sleep(rand(0, 4000));
    await g.reconnect();
  }));

  const stormDuration = (performance.now() - stormStart) / 1000;
  const recoveredCount = toDisconnect.filter(g => g.connected).length;
  console.log(`  🔄 Storm: ${stormDuration.toFixed(1)}s | Recovered: ${recoveredCount}/${stormCount}`);

  await sleep(5000);
  for (const g of guests) await g.disconnect();
  host.stop();
}

// ════════════════════════════════════════════════════════════
// SCENARIO: SOAK
// ════════════════════════════════════════════════════════════
async function scenarioSoak() {
  const TOTAL = NUM_GUESTS || 50;
  console.log(`\n🎯 SOAK | ${TOTAL} guests | ${DURATION_SEC}s`);

  const CODE = 'STRSOAK';
  const host = createHost(CODE);
  host.start();
  await sleep(1500);

  const guests = [];
  for (let i = 0; i < TOTAL; i++) {
    guests.push(createGuest(CODE, i));
    guests[guests.length - 1].connect();
    await sleep(200);
  }
  console.log(`  ✅ ${TOTAL} guests online. Soaking ${DURATION_SEC}s...`);

  const ramTimer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    metrics.ramSamples.push({ ts: Date.now(), rssBytes: rss });
    const elapsed = ((Date.now() - metrics.startTime) / 60000).toFixed(1);
    process.stdout.write(
      `  📊 [${elapsed}min] RAM: ${(rss / 1024 / 1024).toFixed(1)} MB` +
      ` | p95: ${formatMs(percentile(metrics.latencies, 95))}` +
      ` | votes: ${metrics.votesEmitted} genre: ${metrics.genreVotesSent}` +
      ` | SOS: ${metrics.sosBangerSent}\n`
    );
  }, 5000);

  await sleep(DURATION_SEC * 1000);
  clearInterval(ramTimer);
  for (const g of guests) await g.disconnect();
  host.stop();
  await sleep(500);
}

// ════════════════════════════════════════════════════════════
// SCENARIO: HOST_UNDER_FIRE  ★ NEW ★
// Join a REAL existing party hosted on a real iPhone.
// Requires PARTY_CODE env var (the 4-8 char code shown in the app).
// ════════════════════════════════════════════════════════════
async function scenarioHostUnderFire() {
  if (!PARTY_CODE) {
    console.error('\n❌ HOST_UNDER_FIRE requires PARTY_CODE to be set.');
    console.error('   Example: PARTY_CODE=TEUF2025 SCENARIO=HOST_UNDER_FIRE node stress-test/stress.js\n');
    process.exit(1);
  }
  const TOTAL = NUM_GUESTS;
  console.log(`\n🎯 HOST_UNDER_FIRE | Joining real party: ${PARTY_CODE}`);
  console.log(`   Target: ${TARGET_URL}`);
  console.log(`   Guests: ${TOTAL} (ramp ${RAMP_SEC}s) | Sustain: ${DURATION_SEC}s`);
  console.log(`   Every event type will fire: votes, genre votes, messages,`);
  console.log(`   suggestions, SOS bangers, photos (Cloudinary), costume votes`);
  console.log(`\n   ⚠️  WATCH THE HOST APP — it should remain responsive throughout.\n`);

  // Verify the party exists before ramping
  try {
    const res = await fetch(`${TARGET_URL}/api/status`);
    const status = await res.json();
    const found = status.codes?.includes(PARTY_CODE.toUpperCase());
    if (!found) {
      console.error(`\n❌ Party "${PARTY_CODE}" not found on server. Active parties: [${(status.codes || []).join(', ')}]`);
      console.error('   Make sure the host has started the party from the app first.\n');
      process.exit(1);
    }
    console.log(`  ✅ Party ${PARTY_CODE} confirmed on server (${status.totalParticipants} participants already)\n`);
  } catch (err) {
    console.warn(`  ⚠️  Could not verify party existence: ${err.message}`);
    console.warn('   Proceeding anyway — guests will get party:wrongCode if not found.\n');
  }

  const guests = [];
  const rampInterval = TOTAL > 1 ? (RAMP_SEC * 1000) / TOTAL : 500;

  console.log(`  🔧 Ramping ${TOTAL} simulated guests into ${PARTY_CODE}...`);
  for (let i = 0; i < TOTAL; i++) {
    const g = createGuest(PARTY_CODE.toUpperCase(), i, 0, { namePrefix: `Stress_` });
    guests.push(g);
    g.connect();
    await sleep(rampInterval);
    if (i % 5 === 4 || i === TOTAL - 1) {
      const connected = guests.filter(g => g.connected).length;
      process.stdout.write(`  ↑ ${i + 1}/${TOTAL} started | ${connected} connected\n`);
    }
  }

  await sleep(2000); // Let final guests get party:state
  const connectedCount = guests.filter(g => g.connected).length;
  console.log(`\n  ✅ ${connectedCount}/${TOTAL} guests connected to real party ${PARTY_CODE}.`);
  console.log(`  ⏱️  Sustaining ${DURATION_SEC}s of activity...\n`);

  // Rich progress reporting
  const ramTimer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    metrics.ramSamples.push({ ts: Date.now(), rssBytes: rss });
    const elapsed = ((Date.now() - metrics.startTime) / 60000).toFixed(1);
    const live = guests.filter(g => g.connected).length;
    process.stdout.write(
      `  📊 [${elapsed}min] connected: ${live}/${TOTAL}` +
      ` | votes: ${metrics.votesEmitted}` +
      ` | genre: ${metrics.genreVotesSent}` +
      ` | msg: ${metrics.messagesSent}` +
      ` | suggest: ${metrics.suggestionsSent}` +
      ` | SOS: ${metrics.sosBangerSent}` +
      ` | costume: ${metrics.costumeVotesSent}` +
      ` | photo: ${metrics.photosSent}` +
      ` | p95: ${formatMs(percentile(metrics.latencies, 95))}` +
      ` | RAM(harness): ${(rss / 1024 / 1024).toFixed(1)} MB\n`
    );
  }, 5000);

  await sleep(DURATION_SEC * 1000);
  clearInterval(ramTimer);

  console.log(`\n  🏁 Sustained load complete. Disconnecting all simulated guests...`);
  for (const g of guests) await g.disconnect();
  await sleep(500);

  console.log(`  ✅ All simulated guests disconnected. Real party ${PARTY_CODE} should still be alive.`);
  console.log(`     Check the host iPhone: are the leaderboard and participant count correct?\n`);
}

// ─── Final Report ────────────────────────────────────────────────────
function generateReport() {
  metrics.endTime = Date.now();
  const durationSec = (metrics.endTime - metrics.startTime) / 1000;

  const lat = metrics.latencies;
  const p50  = percentile(lat, 50);
  const p95  = percentile(lat, 95);
  const p99  = percentile(lat, 99);
  const pMax = lat.length ? Math.max(...lat) : 0;

  const peakRam = metrics.ramSamples.length
    ? Math.max(...metrics.ramSamples.map(s => s.rssBytes))
    : process.memoryUsage().rss;
  const peakRamMB = peakRam / 1024 / 1024;

  const maxReconnectsPerClient = Object.values(metrics.reconnectsByClient).length
    ? Math.max(...Object.values(metrics.reconnectsByClient))
    : 0;

  const reconnectSuccessRate = metrics.reconnectsTotal > 0
    ? (metrics.reconnectsSucceeded / metrics.reconnectsTotal * 100).toFixed(1)
    : 'N/A';

  // HOST_UNDER_FIRE: relax "no unexpected disconnects" — the real server may close stale sockets
  const isHostUnderFire = SCENARIO === 'HOST_UNDER_FIRE';

  const checks = [
    {
      name: 'Latency p95 < 500ms',
      pass: p95 < 500 || lat.length === 0,
      value: lat.length ? formatMs(p95) : 'no samples',
    },
    {
      name: 'Latency p99 < 1000ms',
      pass: p99 < 1000 || lat.length === 0,
      value: lat.length ? formatMs(p99) : 'no samples',
    },
    {
      name: 'Peak RAM < 400 MB (harness process)',
      pass: peakRamMB < 400,
      value: `${peakRamMB.toFixed(1)} MB`,
    },
    {
      name: 'No cross-party leaks',
      pass: metrics.partyCrossLeaks === 0,
      value: `${metrics.partyCrossLeaks} leaks`,
    },
    {
      name: isHostUnderFire ? 'Unexpected disconnects (info only)' : 'No unexpected disconnects',
      pass: isHostUnderFire || metrics.disconnectsUnexpected === 0,
      value: `${metrics.disconnectsUnexpected}`,
    },
    {
      name: 'No fatal errors',
      pass: metrics.errors.filter(e => e.startsWith('FATAL') || e.startsWith('UNHANDLED')).length === 0,
      value: `${metrics.errors.length} total errors`,
    },
    {
      name: 'Reconnect success rate 100%',
      pass: metrics.reconnectsTotal === 0 || metrics.reconnectsSucceeded === metrics.reconnectsTotal,
      value: metrics.reconnectsTotal > 0 ? `${reconnectSuccessRate}%` : 'N/A',
    },
  ];

  const allPass = checks.every(c => c.pass);

  const report = {
    scenario: SCENARIO,
    partyCode: PARTY_CODE || null,
    targetUrl: TARGET_URL,
    config: { NUM_GUESTS, NUM_PARTIES, GUESTS_PER_PARTY, DURATION_SEC, RAMP_SEC },
    durationSec,
    latency: { samples: lat.length, p50, p95, p99, max: pMax },
    votes: { emitted: metrics.votesEmitted, received: metrics.votesReceived },
    genreVotes: metrics.genreVotesSent,
    costumeVotes: metrics.costumeVotesSent,
    sosBangers: metrics.sosBangerSent,
    messages: { sent: metrics.messagesSent, received: metrics.messagesReceived },
    suggestions: { sent: metrics.suggestionsSent },
    photos: { sent: metrics.photosSent },
    connections: { attempted: metrics.connectionsAttempted, succeeded: metrics.connectionsSucceeded },
    reconnects: { total: metrics.reconnectsTotal, succeeded: metrics.reconnectsSucceeded, maxPerClient: maxReconnectsPerClient },
    ram: { peakMB: peakRamMB.toFixed(1), samples: metrics.ramSamples.length, saturated400MB: peakRamMB >= 400 },
    crossPartyLeaks: metrics.partyCrossLeaks,
    unexpectedDisconnects: metrics.disconnectsUnexpected,
    errors: metrics.errors,
    checks,
    verdict: allPass ? 'PASS ✅' : 'FAIL ❌',
  };

  console.log('\n' + '═'.repeat(62));
  console.log(`  STRESS TEST REPORT — ${SCENARIO}${PARTY_CODE ? ` (party: ${PARTY_CODE})` : ''}`);
  console.log('═'.repeat(62));
  console.log(`  Duration:         ${durationSec.toFixed(1)}s`);
  console.log(`  Latency p50:      ${formatMs(p50)}`);
  console.log(`  Latency p95:      ${formatMs(p95)}`);
  console.log(`  Latency p99:      ${formatMs(p99)}`);
  console.log(`  Latency max:      ${formatMs(pMax)}`);
  console.log(`  Track votes:      ${metrics.votesEmitted} sent / ${metrics.votesReceived} reflected`);
  console.log(`  Genre votes:      ${metrics.genreVotesSent}`);
  console.log(`  Costume votes:    ${metrics.costumeVotesSent}`);
  console.log(`  SOS Bangers:      ${metrics.sosBangerSent}`);
  console.log(`  Messages:         ${metrics.messagesSent} sent`);
  console.log(`  Suggestions:      ${metrics.suggestionsSent}`);
  console.log(`  Photos (CDN):     ${metrics.photosSent}`);
  console.log(`  Connections:      ${metrics.connectionsSucceeded}/${metrics.connectionsAttempted}`);
  console.log(`  Reconnects:       ${metrics.reconnectsSucceeded}/${metrics.reconnectsTotal} (max/client: ${maxReconnectsPerClient})`);
  console.log(`  Peak RAM:         ${peakRamMB.toFixed(1)} MB (harness process)`);
  console.log(`  Cross leaks:      ${metrics.partyCrossLeaks}`);
  console.log(`  Unexp. disco:     ${metrics.disconnectsUnexpected}`);
  console.log(`  Errors:           ${metrics.errors.length}`);
  if (metrics.errors.length > 0) {
    metrics.errors.slice(0, 8).forEach(e => console.log(`    • ${e}`));
    if (metrics.errors.length > 8) console.log(`    ... and ${metrics.errors.length - 8} more`);
  }
  console.log('\n  CHECKS:');
  checks.forEach(c => console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}: ${c.value}`));
  console.log('\n' + '═'.repeat(62));
  console.log(`  VERDICT: ${report.verdict}`);
  console.log('═'.repeat(62) + '\n');

  try {
    const outDir = join(__dirname, 'results');
    mkdirSync(outDir, { recursive: true });
    const filename = join(outDir, `report_${SCENARIO}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(`  📄 Report saved: ${filename}\n`);
  } catch (e) {
    console.error('  ⚠️  Could not write report:', e.message);
  }

  return allPass;
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔧 SocialMix Relay Stress Test');
  console.log(`   Target:   ${TARGET_URL}`);
  console.log(`   Scenario: ${SCENARIO}${PARTY_CODE ? ` (PARTY_CODE=${PARTY_CODE})` : ''}`);
  console.log(`   Node.js:  ${process.version}\n`);

  process.on('unhandledRejection', (err) => {
    metrics.errors.push(`UNHANDLED_REJECTION: ${err?.message || err}`);
  });

  metrics.startTime = Date.now();

  try {
    switch (SCENARIO) {
      case 'SINGLE_PARTY':    await scenarioSingleParty();   break;
      case 'MULTI_PARTY':     await scenarioMultiParty();    break;
      case 'RECONNECT_STORM': await scenarioReconnectStorm(); break;
      case 'SOAK':            await scenarioSoak();           break;
      case 'HOST_UNDER_FIRE': await scenarioHostUnderFire();  break;
      default:
        console.error(`Unknown scenario: ${SCENARIO}`);
        console.error('Available: SINGLE_PARTY, MULTI_PARTY, RECONNECT_STORM, SOAK, HOST_UNDER_FIRE');
        process.exit(1);
    }
  } catch (err) {
    metrics.errors.push(`FATAL: ${err.message}`);
    console.error('Fatal error:', err);
  }

  const passed = generateReport();
  process.exit(passed ? 0 : 1);
}

main();
