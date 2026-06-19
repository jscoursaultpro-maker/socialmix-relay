const { io } = require("socket.io-client");

// Configuration
const SERVER_URL = process.env.SERVER_URL || "https://socialmix-relay.onrender.com";
const PARTY_CODE = process.argv[2];
const NUM_GUESTS = 50;
const DURATION_MINUTES = 10;

if (!PARTY_CODE) {
  console.error("❌ Erreur : Tu dois spécifier le code de la partie (PIN).");
  console.error("💡 Usage: node loadTest50Guests.js <PARTY_CODE>");
  process.exit(1);
}

console.log(`🚀 Starting load test on ${SERVER_URL} for party ${PARTY_CODE}`);
console.log(`👥 Target: ${NUM_GUESTS} guests, Duration: ${DURATION_MINUTES} minutes`);

// Statistics
let connectionErrors = 0;
let messagesSent = 0;
let voteLatencies = []; // Array of milliseconds
let lostVotes = 0;

const clients = [];

// Helper to calculate percentiles
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[index];
}

// Function to simulate a single guest
function createGuest(index) {
  const socket = io(SERVER_URL, {
    transports: ["websocket"],
    reconnection: true,
  });

  const guestId = `load_guest_${index}_${Date.now()}`;
  const guestName = `Guest ${index}`;

  // Pending votes to measure latency
  const pendingVotes = new Map(); // voteId -> startTime

  socket.on("connect", () => {
    socket.emit("guest:join", {
      partyCode: PARTY_CODE,
      guestName,
      guestId,
      avatarId: "😎",
    });
  });

  socket.on("connect_error", (err) => {
    connectionErrors++;
  });

  // Calculate latency on guest:voted broadcast
  socket.on("guest:voted", (data) => {
    if (data.guestId === guestId && data.testVoteId) {
      const startTime = pendingVotes.get(data.testVoteId);
      if (startTime) {
        const latency = Date.now() - startTime;
        voteLatencies.push(latency);
        pendingVotes.delete(data.testVoteId);
      }
    }
  });

  // Action loops
  let voteInterval, chatInterval, suggestInterval;

  // Wait a bit before starting actions to stagger them (100ms between each guest start)
  setTimeout(() => {
    // 1. Vote every 30-60 seconds
    voteInterval = setInterval(() => {
      const voteType = ["fire", "like", "meh"][Math.floor(Math.random() * 3)];
      const testVoteId = `${guestId}_${Date.now()}`;
      
      pendingVotes.set(testVoteId, Date.now());
      
      socket.emit("guest:vote", {
        guestId,
        guestName,
        type: voteType,
        trackId: "current", 
        trackTitle: "Load Test Track",
        testVoteId // Custom field added just for tracing the roundtrip
      });
      messagesSent++;

      // Prune lost votes (timeout after 10 seconds)
      setTimeout(() => {
        if (pendingVotes.has(testVoteId)) {
          lostVotes++;
          pendingVotes.delete(testVoteId);
        }
      }, 10000);

    }, Math.floor(Math.random() * 30000) + 30000);

    // 2. Text message every 2-3 minutes
    chatInterval = setInterval(() => {
      socket.emit("guest:message", { // or guest:chat if it's called differently, wait let's check
        guestId,
        guestName,
        message: `Hello from ${guestName}!`,
      });
      messagesSent++;
    }, Math.floor(Math.random() * 60000) + 120000);

    // 3. Suggestion every 5 minutes
    suggestInterval = setInterval(() => {
      socket.emit("guest:suggest", {
        guestId,
        guestName,
        trackId: `track_${Math.floor(Math.random() * 1000000)}`,
        title: "Test Suggestion",
        artist: "Load Test Band"
      });
      messagesSent++;
    }, 300000);

  }, index * 100);

  clients.push({ socket, intervals: [voteInterval, chatInterval, suggestInterval] });
}

// Start creating guests
for (let i = 1; i <= NUM_GUESTS; i++) {
  createGuest(i);
}

// Progress reporting during test
const progressInterval = setInterval(() => {
  console.log(`[Progress] Active connections: ${clients.filter(c => c.socket.connected).length} / ${NUM_GUESTS} | Messages Sent: ${messagesSent} | Lost Votes: ${lostVotes}`);
}, 60000);

// Setup shutdown & report
setTimeout(() => {
  clearInterval(progressInterval);
  console.log("\n🏁 --- LOAD TEST COMPLETE ---");
  
  // Aggregate stats
  const p50 = percentile(voteLatencies, 50);
  const p95 = percentile(voteLatencies, 95);
  const p99 = percentile(voteLatencies, 99);
  
  console.log(`\n📊 === RÉSULTATS DU STRESS TEST ===`);
  console.log(`- Durée totale          : ${DURATION_MINUTES} minutes`);
  console.log(`- Invités simulés       : ${NUM_GUESTS}`);
  console.log(`- Messages émis (total) : ${messagesSent}`);
  console.log(`- Erreurs de connexion  : ${connectionErrors}`);
  console.log(`- Pertes de votes (R/T) : ${lostVotes}`);
  console.log(`- Latence votes (R/T)   : p50 = ${p50} ms | p95 = ${p95} ms | p99 = ${p99} ms`);
  console.log(`====================================\n`);
  
  console.log("🧹 Nettoyage des connexions...");
  clients.forEach(c => {
    c.intervals.forEach(i => clearInterval(i));
    c.socket.disconnect();
  });
  
  process.exit(0);
}, DURATION_MINUTES * 60 * 1000);
