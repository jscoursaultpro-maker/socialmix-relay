/**
 * Test bot — simule un guest qui rejoint la soirée et suggère un titre.
 * Usage: node test-bot.mjs 7JW3SM
 */
import { io } from 'socket.io-client';

const RELAY = 'https://socialmix-relay.onrender.com';
const CODE  = process.argv[2] || '7JW3SM';
const BOT_NAME  = 'TestBot 🤖';
const BOT_EMOJI = '🤖';

// Track to suggest — something easy to find on Deezer
const SUGGESTION = {
  title:    'Thriller',
  artist:   'Michael Jackson',
  deezerID: 58392768,
  query:    'Michael Jackson Thriller',
  guestName: BOT_NAME,
};

console.log(`\n🤖 Bot connecting to party ${CODE} at ${RELAY}...\n`);

const socket = io(RELAY, {
  transports: ['websocket'],
  reconnection: false,
});

let joined = false;

socket.on('connect', () => {
  console.log(`✅ Connected (sid: ${socket.id})`);

  // Join as guest
  socket.emit('guest:join', {
    partyCode: CODE,
    name: BOT_NAME,
    emoji: BOT_EMOJI,
    userId: 'bot_test_' + Date.now(),
  });
});

socket.on('party:state', (state) => {
  if (joined) return;
  joined = true;

  const current = state.currentTrack;
  console.log(`🎵 Party joined! Current track: ${current?.title || '(none)'} — ${current?.artist || ''}`);
  console.log(`👥 Participants: ${state.participants?.length || 0}`);
  console.log(`\n📤 Sending suggestion: "${SUGGESTION.title}" — ${SUGGESTION.artist}`);

  socket.emit('guest:suggest', {
    ...SUGGESTION,
    partyCode: CODE,
    coverURL: null,
    duration: 358,
    timestamp: new Date().toISOString(),
  });
});

socket.on('suggestion:status', (data) => {
  console.log(`\n✅ Suggestion acknowledged: "${data.title}" → status: ${data.status}`);
  console.log(`   Message: ${data.message}`);
  console.log(`\n⏳ Waiting for track:update with attribution...`);
  console.log(`   (Press the NEXT button in the app to queue the suggestion, or wait for auto-accept)\n`);
});

socket.on('track:update', (data) => {
  console.log(`\n🎵 track:update received:`);
  console.log(`   Title:   ${data.title} — ${data.artist}`);
  console.log(`   Source:  ${data.requestedBy?.source || '?'}`);
  console.log(`   By:      ${data.requestedBy?.guestName || 'DJ Brain'}`);

  if (data.requestedBy?.source === 'suggestion' && data.requestedBy?.guestName === BOT_NAME) {
    console.log(`\n🎉 PASS ✅ Attribution correcte: "Proposé par ${BOT_NAME}"`);
  } else if (data.requestedBy?.source === 'djbrain') {
    console.log(`   → DJ Brain auto-pick (pas la suggestion bot — normal si pas encore acceptée)`);
  } else {
    console.log(`   → Attribution: ${JSON.stringify(data.requestedBy)}`);
  }
});

socket.on('party:wrongCode', (e) => {
  console.error(`❌ Wrong party code: ${e.message}`);
  process.exit(1);
});

socket.on('disconnect', () => {
  console.log('\n🔌 Disconnected from relay.');
});

socket.on('connect_error', (err) => {
  console.error(`❌ Connection error: ${err.message}`);
});

// Auto-exit after 3 minutes
setTimeout(() => {
  console.log('\n⏰ Timeout — exiting bot.');
  socket.disconnect();
  process.exit(0);
}, 3 * 60 * 1000);
