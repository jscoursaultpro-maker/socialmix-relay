/**
 * Multi-bot stress test — 20 guests
 * Usage: node multi-bot.mjs [CODE]
 */
import { io } from 'socket.io-client';

const RELAY = 'https://socialmix-relay.onrender.com';
const CODE  = process.argv[2] || '7JW3SM';
const NUM_BOTS = parseInt(process.argv[3], 10) || 20;

const FIRST_NAMES = ['Sophie','Lucas','Marie','Alex','Leo','Emma','Hugo','Chloe','Louis','Lea','Gabriel','Camille','Arthur','Sarah','Jules','Manon','Maël','Clara','Paul','Inès'];
const EMOJIS = ['🌸','🔥','💃','🎸','✨','😎','🚀','🎧','🎵','🍾','🥂','👑','⭐','👏','🙌','💯','✌️','🤩','🥳','🎶'];
const GENRES = ['Pop','Hip-Hop','Latino','House','Rock','Afro','Disco','R&B'];

// Random Deezer IDs (popular tracks)
const POPULAR_DEEZER_IDS = [
  { title: "Uptown Funk", artist: "Mark Ronson", id: 93342836 },
  { title: "Blinding Lights", artist: "The Weeknd", id: 824860862 },
  { title: "I Gotta Feeling", artist: "Black Eyed Peas", id: 5352750 },
  { title: "Danza Kuduro", artist: "Don Omar", id: 10452391 },
  { title: "Shape of You", artist: "Ed Sheeran", id: 139966143 },
  { title: "Levitating", artist: "Dua Lipa", id: 1109218742 },
  { title: "Despacito", artist: "Luis Fonsi", id: 140306123 },
  { title: "Alors on danse", artist: "Stromae", id: 4802871 },
  { title: "Wake Me Up", artist: "Avicii", id: 68339103 },
  { title: "Crazy In Love", artist: "Beyonce", id: 1251347 },
];

const BOTS = Array.from({ length: NUM_BOTS }).map((_, i) => ({
  name: `${FIRST_NAMES[i % FIRST_NAMES.length]} ${EMOJIS[i % EMOJIS.length]} ${i}`,
  emoji: EMOJIS[i % EMOJIS.length],
  suggestions: [
    POPULAR_DEEZER_IDS[i % POPULAR_DEEZER_IDS.length],
    POPULAR_DEEZER_IDS[(i+3) % POPULAR_DEEZER_IDS.length]
  ]
}));

function spawnBot(bot, delayMs) {
  setTimeout(() => {
    const socket = io(RELAY, { transports: ['websocket'], reconnection: false });
    let joined = false;
    let suggIndex = 0;

    socket.on('connect', () => {
      console.log(`🤖 [${bot.name}] Connected`);
      socket.emit('guest:join', {
        partyCode: CODE,
        name: bot.name,
        emoji: bot.emoji,
        userId: 'bot_' + bot.name.replace(/\W/g,'') + '_' + Date.now(),
      });
    });

    socket.on('party:state', (state) => {
      if (joined) return;
      joined = true;
      const ct = state.currentTrack;
      console.log(`🎵 [${bot.name}] Joined. Current: ${ct?.title || '(none)'}`);
      
      // Randomly vote for a genre
      setTimeout(() => {
        const randomGenre = GENRES[Math.floor(Math.random() * GENRES.length)];
        socket.emit('guest:genreVote', {
          genre: randomGenre,
          guestName: bot.name,
          guestId: 'bot_' + bot.name.replace(/\W/g,'')
        });
      }, 5000);

      sendNextSuggestion();
      randomReactions();
    });

    function randomReactions() {
      setInterval(() => {
        // 30% chance to send a fire/like vote
        if (Math.random() < 0.3) {
          socket.emit('guest:vote', {
            type: Math.random() > 0.5 ? 'fire' : 'like',
            guestId: 'bot_' + bot.name.replace(/\W/g,''),
            guestName: bot.name,
            trackId: 'current',
            trackTitle: 'current'
          });
          console.log(`🔥 [${bot.name}] sent a vote`);
        }
      }, 45000);
    }

    function sendNextSuggestion() {
      if (suggIndex >= bot.suggestions.length) return;
      const sugg = bot.suggestions[suggIndex++];
      console.log(`📤 [${bot.name}] Suggesting: "${sugg.title}" — ${sugg.artist}`);
      socket.emit('guest:suggest', {
        title: sugg.title,
        artist: sugg.artist,
        deezerID: sugg.id,
        query: `${sugg.artist} ${sugg.title}`,
        partyCode: CODE,
        guestName: bot.name,
        duration: 200,
        timestamp: new Date().toISOString(),
      });
      // Send next suggestion after 2-4 minutes
      setTimeout(sendNextSuggestion, 120000 + Math.random() * 120000);
    }

    socket.on('suggestion:status', (data) => {
      if(data.guestName === bot.name) {
        console.log(`✅ [${bot.name}] Suggestion ACK: "${data.title}" → ${data.status} — ${data.message}`);
      }
    });

    socket.on('disconnect', () => console.log(`🔌 [${bot.name}] Disconnected`));
    socket.on('connect_error', (e) => console.error(`❌ [${bot.name}] Error: ${e.message}`));

    // Auto-exit after 15 minutes
    setTimeout(() => { socket.disconnect(); }, 15 * 60 * 1000);
  }, delayMs);
}

console.log(`\n🎉 Launching ${BOTS.length} bots on party ${CODE} for 15 minutes...\n`);
BOTS.forEach((bot, i) => spawnBot(bot, i * 1500));  // stagger by 1.5s each
