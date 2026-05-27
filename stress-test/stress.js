/**
 * SocialMix Relay Server — Stress Test Harness
 *
 * Usage: see stress-test/README.md
 *
 * Protocol-faithful: all event names and payloads taken directly from server.js.
 * Every simulated guest reproduces the exact lifecycle of a real web guest.
 */

import { io } from 'socket.io-client';
import { writeFileSync, mkdirSync } from 'fs';
import { performance } from 'perf_hooks';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config (CLI env vars) ───────────────────────────────────────────
const TARGET_URL     = process.env.TARGET_URL     || 'http://localhost:3069';
const SCENARIO       = process.env.SCENARIO       || 'SINGLE_PARTY';
const NUM_GUESTS     = parseInt(process.env.NUM_GUESTS || '50');
const NUM_PARTIES    = parseInt(process.env.NUM_PARTIES || '5');
const GUESTS_PER_PARTY = parseInt(process.env.GUESTS_PER_PARTY || '20');
const DURATION_SEC   = parseInt(process.env.DURATION_SEC || '60');
const RAMP_SEC       = parseInt(process.env.RAMP_SEC || '30');

// ─── Genres / titles / artists (plausible test data) ─────────────────
const GENRES   = ['House', 'Electro', 'Pop', 'Hip-Hop', 'Disco', 'R&B'];
const TITLES   = ['Blinding Lights', 'Levitating', 'One Dance', 'Starboy', 'Shape of You', 'As It Was', 'Easy On Me', 'Heat Waves', 'Montero', 'good 4 u'];
const ARTISTS  = ['The Weeknd', 'Dua Lipa', 'Drake', 'Beyoncé', 'Ed Sheeran', 'Harry Styles', 'Adele', 'Glass Animals', 'Lil Nas X', 'Olivia Rodrigo'];
const EMOJIS   = ['🎉', '🔥', '🎵', '🎤', '💃', '🕺', '🎶', '⚡', '🌟', '🎸'];
const MESSAGES = ['Trop bien ce son !', 'On adore !', 'Encore !', 'DJ t\'assures', 'Vibes 🔥', 'Mets du son', 'Amazing !', 'On kiffe', 'Top !', 'Banger !'];
const VOTE_TYPES = ['fire', 'like', 'meh'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Metrics Collector ───────────────────────────────────────────────
const metrics = {
  latencies: [],          // RTT samples in ms
  votesEmitted: 0,
  votesReceived: 0,       // via guest:voted broadcast
  messagesSent: 0,
  messagesReceived: 0,
  suggestionsSent: 0,
  photosSent: 0,
  connectionsAttempted: 0,
  connectionsSucceeded: 0,
  disconnectsUnexpected: 0,
  reconnectsTotal: 0,
  reconnectsSucceeded: 0,
  reconnectsByClient: {},   // guestId → count
  partyCrossLeaks: 0,       // inter-party leaks
  errors: [],
  ramSamples: [],           // { ts, rssBytes }
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
function createGuest(partyCode, guestIndex, partyIndex = 0) {
  const guestId   = randomUUID();
  const guestName = `Guest${partyIndex}_${guestIndex}`;
  const guestEmoji = pick(EMOJIS);

  let socket      = null;
  let sessionToken = null;
  let connected   = false;
  let activityTimer = null;
  let ownPartyCode = partyCode;

  const state = {
    guestId, guestName, guestEmoji,
    joinTime: null, disconnects: 0, reconnects: 0,
    votesEmitted: 0, votesReceived: 0,
    messagesReceived: 0,
  };

  // ── Latency probe ──────────────────────────────────────────────────
  function probeLatency() {
    if (!connected || !socket) return;
    const t0 = performance.now();
    socket.once('votes:update', () => {
      recordLatency(performance.now() - t0);
    });
    // Emit a genre vote as the probe trigger (real action, real broadcast)
    socket.emit('guest:genreVote', {
      guestId, guestName,
      genre: pick(GENRES),
    });
  }

  // ── Activity loop ─────────────────────────────────────────────────
  function scheduleNextActivity() {
    if (activityTimer) return;
    const delay = rand(8000, 20000); // 8-20s between actions
    activityTimer = setTimeout(() => {
      activityTimer = null;
      if (!connected || !socket) return scheduleNextActivity();

      const roll = Math.random();

      if (roll < 0.40) {
        // Vote (most frequent)
        const voteType = pick(VOTE_TYPES);
        const trackTitle = pick(TITLES);
        const t0 = performance.now();
        metrics.votesEmitted++;
        state.votesEmitted++;
        socket.emit('guest:vote', {
          guestId, guestName,
          type: voteType,
          trackId: trackTitle,
          trackTitle,
          trackArtist: pick(ARTISTS),
        });
        // Measure RTT: listen for the broadcast echo
        socket.once('guest:voted', () => {
          recordLatency(performance.now() - t0);
          metrics.votesReceived++;
          state.votesReceived++;
        });

      } else if (roll < 0.65) {
        // Genre vote / probe
        probeLatency();

      } else if (roll < 0.78) {
        // Message
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

      } else if (roll < 0.90) {
        // Suggestion (~12%)
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
        socket.once('suggestion:status', () => {
          recordLatency(performance.now() - t0);
        });

      } else {
        // Photo via Cloudinary URL (never send base64 in stress test)
        metrics.photosSent++;
        socket.emit('guest:photo', {
          guestId, guestName,
          dataURL: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          caption: 'Stress test photo',
        });
      }

      scheduleNextActivity();
    }, delay);
  }

  // ── Socket setup ──────────────────────────────────────────────────
  function buildSocket() {
    metrics.connectionsAttempted++;
    const s = io(TARGET_URL, {
      transports: ['websocket'],
      reconnection: false,        // Manual reconnection — we control it
      timeout: 10000,
    });

    s.on('connect', () => {
      connected = true;
      metrics.connectionsSucceeded++;
      state.joinTime = Date.now();

      // ── Step 1: join party
      s.emit('guest:join', {
        partyCode: ownPartyCode,
        name: guestName,
        guestName,
        emoji: guestEmoji,
        guestEmoji,
        guestId,
      });
    });

    // ── Step 2: receive party state + session token
    s.on('party:state', (partyState) => {
      // MULTI_PARTY cross-party isolation check
      if (partyState.code && partyState.code !== ownPartyCode) {
        metrics.partyCrossLeaks++;
        metrics.errors.push(`CROSS_LEAK: ${guestName} in ${ownPartyCode} got state for ${partyState.code}`);
      }
      scheduleNextActivity();
    });

    s.on('session:token', (data) => {
      sessionToken = data.sessionToken;
    });

    s.on('guest:voted', () => {
      // counted per-listener above; global counter for reconciliation
    });

    s.on('party:wrongCode', (data) => {
      metrics.errors.push(`WRONG_CODE: ${guestName} → ${ownPartyCode}: ${data.message}`);
    });

    s.on('party:ended', () => {
      connected = false;
      cleanup();
    });

    s.on('disconnect', (reason) => {
      connected = false;
      state.disconnects++;
      if (reason !== 'io client disconnect') {
        metrics.disconnectsUnexpected++;
      }
    });

    s.on('connect_error', (err) => {
      metrics.errors.push(`CONNECT_ERROR: ${guestName}: ${err.message}`);
    });

    return s;
  }

  function cleanup() {
    if (activityTimer) { clearTimeout(activityTimer); activityTimer = null; }
  }

  // ── Public API ───────────────────────────────────────────────────
  function connect() {
    socket = buildSocket();
  }

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
    socket = io(TARGET_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 10000,
    });

    const t0 = performance.now();

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Reconnect timeout for ${guestName}`));
      }, 10000);

      socket.on('connect', () => {
        // Try resume first (if we have a session token)
        if (sessionToken) {
          socket.emit('guest:resume', { partyCode: ownPartyCode, sessionToken }, (ack) => {
            clearTimeout(timeout);
            if (ack?.ok) {
              connected = true;
              metrics.connectionsSucceeded++;
              metrics.reconnectsSucceeded++;
              recordLatency(performance.now() - t0);
              scheduleNextActivity();
              resolve();
            } else {
              // Fallback to full join
              socket.emit('guest:join', {
                partyCode: ownPartyCode, name: guestName,
                guestName, emoji: guestEmoji, guestEmoji, guestId,
              });
            }
          });
        } else {
          // No session token — full join
          socket.emit('guest:join', {
            partyCode: ownPartyCode, name: guestName,
            guestName, emoji: guestEmoji, guestEmoji, guestId,
          });
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

      socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        metrics.errors.push(`RECONNECT_ERROR: ${guestName}: ${err.message}`);
        reject(err);
      });
    }).catch(err => {
      metrics.errors.push(`RECONNECT_FAILED: ${guestName}: ${err.message}`);
    });
  }

  return { connect, disconnect, reconnect, state, get connected() { return connected; } };
}

// ─── Host simulator (creates and holds the party) ────────────────────
function createHost(partyCode) {
  const hostSecret = randomUUID();
  let socket = null;

  function start() {
    socket = io(TARGET_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 10000,
    });
    socket.on('connect', () => {
      socket.emit('host:startParty', {
        code: partyCode,
        hostSecret,
        profile: { name: `Host_${partyCode}`, emoji: '🎧' },
      });
      // Periodically emit a track update (for guests to vote on)
      setInterval(() => {
        if (!socket.connected) return;
        socket.emit('host:trackUpdate', {
          title: pick(TITLES),
          artist: pick(ARTISTS),
          genre: pick(GENRES),
          bpm: rand(100, 140),
          hostSecret,
        });
      }, 15000);
    });
  }

  function stop() {
    if (socket?.connected) {
      socket.emit('host:endParty', { hostSecret });
      socket.disconnect();
    }
  }

  return { start, stop, get connected() { return socket?.connected || false; } };
}

// ─── Scenario: SINGLE_PARTY ──────────────────────────────────────────
async function scenarioSingleParty() {
  console.log(`\n🎯 SCENARIO: SINGLE_PARTY | Target: ${NUM_GUESTS} guests | Ramp: ${RAMP_SEC}s | Duration: ${DURATION_SEC}s`);
  const CODE = 'STRESS01';
  const host = createHost(CODE);
  host.start();
  await sleep(1500); // Let server create the party

  const guests = [];
  const rampInterval = (RAMP_SEC * 1000) / NUM_GUESTS;

  // Progressive ramp
  for (let i = 0; i < NUM_GUESTS; i++) {
    const g = createGuest(CODE, i);
    guests.push(g);
    g.connect();
    await sleep(rampInterval);
    if (i % 10 === 9) {
      process.stdout.write(`  ↑ ${i + 1}/${NUM_GUESTS} guests connected\n`);
    }
  }

  console.log(`  ✅ All ${NUM_GUESTS} guests ramped. Running for ${DURATION_SEC}s...`);

  // Sample RAM every 5s
  const ramTimer = setInterval(() => {
    metrics.ramSamples.push({ ts: Date.now(), rssBytes: process.memoryUsage().rss });
  }, 5000);

  await sleep(DURATION_SEC * 1000);
  clearInterval(ramTimer);

  // Teardown
  for (const g of guests) await g.disconnect();
  host.stop();
  await sleep(500);
}

// ─── Scenario: MULTI_PARTY ───────────────────────────────────────────
async function scenarioMultiParty() {
  console.log(`\n🎯 SCENARIO: MULTI_PARTY | ${NUM_PARTIES} parties × ${GUESTS_PER_PARTY} guests`);

  const parties = [];
  for (let p = 0; p < NUM_PARTIES; p++) {
    const code = `STRMP${String(p + 1).padStart(2, '0')}`;
    const host = createHost(code);
    host.start();
    parties.push({ code, host, guests: [] });
  }
  await sleep(2000);

  // Populate all parties in parallel
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

  // Teardown
  for (const party of parties) {
    for (const g of party.guests) await g.disconnect();
    party.host.stop();
  }
  await sleep(500);
}

// ─── Scenario: RECONNECT_STORM ───────────────────────────────────────
async function scenarioReconnectStorm() {
  const TOTAL = NUM_GUESTS || 80;
  const DISCONNECT_PCT = 0.70;
  console.log(`\n🎯 SCENARIO: RECONNECT_STORM | ${TOTAL} guests | Disconnect ${DISCONNECT_PCT * 100}% simultaneously`);

  const CODE = 'STRCNX';
  const host = createHost(CODE);
  host.start();
  await sleep(1500);

  const guests = [];
  for (let i = 0; i < TOTAL; i++) {
    const g = createGuest(CODE, i);
    guests.push(g);
    g.connect();
    await sleep(100);
  }

  await sleep(5000); // Let everyone settle
  console.log(`  ✅ ${TOTAL} guests connected. Starting storm...`);

  const stormCount = Math.floor(TOTAL * DISCONNECT_PCT);
  const toDisconnect = guests.slice(0, stormCount);
  const stormStart = performance.now();

  // Disconnect all at once (WiFi cut simulation)
  await Promise.all(toDisconnect.map(g => g.disconnect()));
  console.log(`  ⚡ ${stormCount} guests disconnected simultaneously`);

  // Reconnect all within 5s
  await Promise.all(toDisconnect.map(async (g, i) => {
    await sleep(rand(0, 4000)); // Random within 4s
    await g.reconnect();
  }));

  const stormDuration = (performance.now() - stormStart) / 1000;
  console.log(`  🔄 Storm duration: ${stormDuration.toFixed(1)}s`);

  // Check state integrity
  const recoveredCount = toDisconnect.filter(g => g.connected).length;
  console.log(`  ✅ Recovered: ${recoveredCount}/${stormCount} (${((recoveredCount / stormCount) * 100).toFixed(1)}%)`);

  await sleep(5000);
  for (const g of guests) await g.disconnect();
  host.stop();
}

// ─── Scenario: SOAK ──────────────────────────────────────────────────
async function scenarioSoak() {
  const TOTAL = NUM_GUESTS || 50;
  console.log(`\n🎯 SCENARIO: SOAK | ${TOTAL} guests | ${DURATION_SEC}s sustained load`);

  const CODE = 'STRSOAK';
  const host = createHost(CODE);
  host.start();
  await sleep(1500);

  const guests = [];
  for (let i = 0; i < TOTAL; i++) {
    const g = createGuest(CODE, i);
    guests.push(g);
    g.connect();
    await sleep(200);
  }

  console.log(`  ✅ ${TOTAL} guests online. Soaking for ${DURATION_SEC}s...`);

  // Sample RAM + event loop every 5s
  const ramTimer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    metrics.ramSamples.push({ ts: Date.now(), rssBytes: rss });
    const elapsedMin = ((Date.now() - metrics.startTime) / 60000).toFixed(1);
    process.stdout.write(`  📊 [${elapsedMin}min] RAM: ${(rss / 1024 / 1024).toFixed(1)} MB | Latency p95: ${formatMs(percentile(metrics.latencies, 95))} | Votes: ${metrics.votesEmitted}\n`);
  }, 5000);

  await sleep(DURATION_SEC * 1000);
  clearInterval(ramTimer);

  for (const g of guests) await g.disconnect();
  host.stop();
  await sleep(500);
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

  // ── PASS/FAIL criteria ───────────────────────────────────────────
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
      name: 'Peak RAM < 400 MB',
      pass: peakRamMB < 400,
      value: `${peakRamMB.toFixed(1)} MB`,
    },
    {
      name: 'No cross-party leaks (MULTI_PARTY)',
      pass: metrics.partyCrossLeaks === 0,
      value: `${metrics.partyCrossLeaks} leaks`,
    },
    {
      name: 'No unexpected disconnects',
      pass: metrics.disconnectsUnexpected === 0,
      value: `${metrics.disconnectsUnexpected}`,
    },
    {
      name: 'No unhandled errors',
      pass: metrics.errors.length === 0,
      value: `${metrics.errors.length} errors`,
    },
    {
      name: 'Reconnect success rate 100% (RECONNECT_STORM)',
      pass: metrics.reconnectsTotal === 0 || metrics.reconnectsSucceeded === metrics.reconnectsTotal,
      value: metrics.reconnectsTotal > 0 ? `${reconnectSuccessRate}%` : 'N/A',
    },
  ];

  const allPass = checks.every(c => c.pass);

  const report = {
    scenario: SCENARIO,
    targetUrl: TARGET_URL,
    config: { NUM_GUESTS, NUM_PARTIES, GUESTS_PER_PARTY, DURATION_SEC, RAMP_SEC },
    durationSec,
    latency: { samples: lat.length, p50, p95, p99, max: pMax },
    votes: { emitted: metrics.votesEmitted, received: metrics.votesReceived },
    messages: { sent: metrics.messagesSent, received: metrics.messagesReceived },
    suggestions: { sent: metrics.suggestionsSent },
    photos: { sent: metrics.photosSent },
    connections: { attempted: metrics.connectionsAttempted, succeeded: metrics.connectionsSucceeded },
    reconnects: { total: metrics.reconnectsTotal, succeeded: metrics.reconnectsSucceeded, maxPerClient: maxReconnectsPerClient },
    ram: {
      peakMB: peakRamMB.toFixed(1),
      samples: metrics.ramSamples.length,
      saturated400MB: peakRamMB >= 400,
    },
    crossPartyLeaks: metrics.partyCrossLeaks,
    unexpectedDisconnects: metrics.disconnectsUnexpected,
    errors: metrics.errors,
    checks,
    verdict: allPass ? 'PASS ✅' : 'FAIL ❌',
  };

  // Console output
  console.log('\n' + '═'.repeat(60));
  console.log(`  STRESS TEST REPORT — ${SCENARIO}`);
  console.log('═'.repeat(60));
  console.log(`  Duration:       ${durationSec.toFixed(1)}s`);
  console.log(`  Latency p50:    ${formatMs(p50)}`);
  console.log(`  Latency p95:    ${formatMs(p95)}`);
  console.log(`  Latency p99:    ${formatMs(p99)}`);
  console.log(`  Latency max:    ${formatMs(pMax)}`);
  console.log(`  Votes emitted:  ${metrics.votesEmitted}`);
  console.log(`  Votes received: ${metrics.votesReceived}`);
  console.log(`  Messages sent:  ${metrics.messagesSent}`);
  console.log(`  Suggestions:    ${metrics.suggestionsSent}`);
  console.log(`  Photos:         ${metrics.photosSent}`);
  console.log(`  Connections:    ${metrics.connectionsSucceeded}/${metrics.connectionsAttempted}`);
  console.log(`  Reconnects:     ${metrics.reconnectsSucceeded}/${metrics.reconnectsTotal} (max/client: ${maxReconnectsPerClient})`);
  console.log(`  Peak RAM:       ${peakRamMB.toFixed(1)} MB`);
  console.log(`  Cross leaks:    ${metrics.partyCrossLeaks}`);
  console.log(`  Unexp. disco:   ${metrics.disconnectsUnexpected}`);
  console.log(`  Errors:         ${metrics.errors.length}`);
  if (metrics.errors.length > 0) {
    metrics.errors.slice(0, 5).forEach(e => console.log(`    • ${e}`));
    if (metrics.errors.length > 5) console.log(`    ... and ${metrics.errors.length - 5} more`);
  }
  console.log('\n  CHECKS:');
  checks.forEach(c => {
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}: ${c.value}`);
  });
  console.log('\n' + '═'.repeat(60));
  console.log(`  VERDICT: ${report.verdict}`);
  console.log('═'.repeat(60) + '\n');

  // Write JSON report
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
  console.log(`   Scenario: ${SCENARIO}`);
  console.log(`   Node.js:  ${process.version}\n`);

  // Unhandled rejection guard (counts as error, doesn't crash harness)
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
      default:
        console.error(`Unknown scenario: ${SCENARIO}`);
        console.error('Available: SINGLE_PARTY, MULTI_PARTY, RECONNECT_STORM, SOAK');
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
