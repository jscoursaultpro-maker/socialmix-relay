import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env from relay-server directory
const envPath = path.join(__dirname, '..', '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n')
    .filter(l => l.match(/^[A-Z]/) && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.substring(0, i).trim(), l.substring(i+1).replace(/^"|"$/g, '').trim()]; })
);

const MONGO_URI = process.env.MONGO_URI || env.MONGO_URI || env.MONGODB_URI;

const DRY_RUN = process.env.LIVE !== '1';

// --- LISTS IMPORTED FROM scan_toxic.mjs ---
const TOXIC_TITLE_KEYWORDS = [
    'karaoke', 'slowed', 'sped up', 'speed up',
    'meditation', 'sleep music', 'rain sounds', 'white noise',
    'relaxation', 'study music', 'lofi', 'lo-fi', 'lo fi',
    'type beat', 'type beats', '(instrumental)', 'instrumental version',
    'gym music', 'workout music', 'fitness music',
    'orchestral version', 'piano version', 'acoustic version',
    'unplugged', 'tabata', 'as made famous by',
    'backing track', 'originally performed',
    '8-bit', '16-bit', 'emulation',
    'epic version', 'parody', 'nonstop party',
    'malle ist', 'griechischer wein', 'moskau',
    '(cover)', 'abba cover', 'dj remix)',
    'veridis quo', "romanthony's unplugged",
    'chill session', 'chill hour', 'chill vibes',
    'deep house workout', 'deep house fitness',
    'tropical house vibes', 'ocean beach chill',
];

const TOXIC_ARTIST_KEYWORDS = [
    'lounge club', 'ibiza lounge', 'chill out zone', 'chill lounge',
    'ambient sounds', 'meditation', 'sleep sounds', 'nature sounds',
    'white noise', 'relaxation', 'spa music',
    'fitness music', 'workout music', 'gym music',
    'type beats', 'king beats', 'perreo mx',
    'deep house classics', 'chill deep house',
    'house music classics', 'best of house',
    'tabata songs', 'the backing tracks', 'believers in a dream',
    'yarondopiano',
    '8-bit arcade', 'arcade player', 'vox freaks', 'mixologia',
    'party tyme', 'covers club', 'pop & rock covers',
    'queen machine', 'abbacadabra', 'mat ryxx',
    'deutscher schlager', 'almklausi', 'dj linuxxx',
    'brazillian party djs', "90's club house",
    'party machine', 'dj kosse',
];

const NON_LATIN_REGEX = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFFEF\u4E00-\u9FFF\uAC00-\uD7AF\u0600-\u06FF\u0400-\u04FF]/;

const GENERIC_ARTISTS = [
    'various artists', 'compilation', 'soundtrack',
    'club mix', 'dj mix', 'party mix', 'mega mix',
];

// --- LISTS IMPORTED FROM audit_base_150.mjs ---
const BLACKLISTED_ARTISTS = new Set([
  'fitness music', 'workout music', 'gym music', 'deep house workout',
]);

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

function isToxic(track) {
  const titleLower = (track.title || '').toLowerCase();
  const artistLower = (track.artist || '').toLowerCase();

  // 1. Title keywords
  for (const kw of TOXIC_TITLE_KEYWORDS) {
    const kwRegex = new RegExp('\\b' + escapeRegex(kw) + '\\b', 'i');
    if (kwRegex.test(titleLower)) {
      return { toxic: true, reason: 'title_keyword' };
    }
  }

  // 2. Artist keywords
  for (const kw of TOXIC_ARTIST_KEYWORDS) {
    const kwRegex = new RegExp('\\b' + escapeRegex(kw) + '\\b', 'i');
    if (kwRegex.test(artistLower)) {
      return { toxic: true, reason: 'artist_keyword' };
    }
  }
  for (const kw of GENERIC_ARTISTS) {
    const kwRegex = new RegExp('\\b' + escapeRegex(kw) + '\\b', 'i');
    if (kwRegex.test(artistLower)) {
      return { toxic: true, reason: 'generic_artist' };
    }
  }

  // 3. Blacklisted artists
  if (BLACKLISTED_ARTISTS.has(artistLower)) {
    return { toxic: true, reason: 'blacklisted_artist' };
  }

  // 4. Non-Latin chars
  if (NON_LATIN_REGEX.test(track.title) || NON_LATIN_REGEX.test(track.artist)) {
    return { toxic: true, reason: 'non_latin_chars' };
  }

  return { toxic: false };
}

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    const Track = mongoose.model('Track', new mongoose.Schema({}, { strict: false }));

    console.log(`\\n=============================================`);
    console.log(`  FLAG TOXIC AS UNSUGGESTABLE - ${DRY_RUN ? 'DRY RUN' : 'LIVE MODE'}`);
    console.log(`=============================================\\n`);

    const tracks = await Track.find({ suggestable: { $ne: false } }, { _id: 1, title: 1, artist: 1 }).lean();
    console.log(`Total tracks scanned: ${tracks.length}`);

    const counts = {
      title_keyword: 0,
      artist_keyword: 0,
      generic_artist: 0,
      blacklisted_artist: 0,
      non_latin_chars: 0
    };

    const samples = {
      title_keyword: [],
      artist_keyword: [],
      generic_artist: [],
      blacklisted_artist: [],
      non_latin_chars: []
    };

    let totalSuspects = 0;

    for (const t of tracks) {
      const res = isToxic(t);
      if (res.toxic) {
        counts[res.reason]++;
        totalSuspects++;
        if (samples[res.reason].length < 20) {
          samples[res.reason].push({ id: t._id, title: t.title, artist: t.artist });
        }
        
        if (!DRY_RUN) {
          await Track.updateOne({ _id: t._id }, { $set: { suggestable: false } });
        }
      }
    }

    console.log(`\\nTotal suspectes trouvées : ${totalSuspects}\\n`);
    
    for (const [reason, count] of Object.entries(counts)) {
      console.log(`\\n--- Categorie: ${reason} (${count} tracks) ---`);
      console.log(JSON.stringify(samples[reason], null, 2));
    }

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
})();
