const fs = require('fs');
const path = require('path');

// 1. Load Data
const seedPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Resources/editorial_seed.json');
const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const djBrainPath = path.join(__dirname, '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift');
const djBrainContent = fs.readFileSync(djBrainPath, 'utf8');

const normalize = (s) => (s||'').toLowerCase().trim();
function normalizedKey(title, artist) {
  return (title || '').toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim() + "_" + 
    (artist || '').toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const uniqueTracks = new Map();

// Parse DJBrain
const regex = /CuratedTrack\(deezerID:\s*(-?\d+),\s*genre:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*artist:\s*"([^"]+)"\)/g;
let match;
while ((match = regex.exec(djBrainContent)) !== null) {
  const t = {
    id: `curated_${match[1]}`,
    title: match[3],
    artist: match[4],
    currentGenre: match[2],
    energy: 5, // Default if unknown
    popularity: 5, // Default if unknown
    source: 'djbrain'
  };
  uniqueTracks.set(normalizedKey(t.title, t.artist), t);
}

// Merge seed data
seedData.tracks.forEach(t => {
  const mapped = {
    id: `seed_${t.providers?.deezer?.trackId || t.fallbackHash}`,
    title: t.title,
    artist: t.artist,
    currentGenre: t.genre,
    energy: t.energy !== undefined ? t.energy : 5,
    popularity: t.popularity !== undefined ? t.popularity : 5,
    source: 'seed'
  };
  // Will override DJBrain entries if they exist, which is fine since seed has better energy/pop
  uniqueTracks.set(normalizedKey(t.title, t.artist), mapped);
});

const allTracks = Array.from(uniqueTracks.values());

const toPurge = [];
const stats = {
  total: allTracks.length,
  purged: 0,
  kept: 0,
  breakdown: {
    "Exclusion 1 (Classique/Cinéma)": 0,
    "Exclusion 2 (Ballades intimes)": 0,
    "Exclusion 3 (Metadata cassée)": 0,
    "Exclusion 4 (Deep House obscur)": 0,
    "Exclusion 5 (Karaoke résidus)": 0,
    "Exclusion 6 (Obscur+mort)": 0
  }
};

// Evaluators
for (const track of allTracks) {
  const tTitle = normalize(track.title);
  const tArtist = normalize(track.artist);
  
  let reason = null;
  let breakdownKey = null;

  // EXCLUSION 5: Karaoke
  if (!reason && (tTitle.includes("karaoke") || tTitle.includes("originally performed by") || tTitle.includes("in the style of") || tTitle.includes("made famous by") || tTitle.includes("instrumental version") || tTitle.includes("backing track"))) {
    reason = "Exclusion 5 — Version karaoke/cover";
    breakdownKey = "Exclusion 5 (Karaoke résidus)";
  }

  // EXCLUSION 1: Classique / Cinema / Jazz lent
  const ex1Artists = ["einaudi", "max richter", "yann tiersen", "hans zimmer", "debussy", "morricone", "chet baker", "norah jones", "ennio morricone"];
  if (!reason && ex1Artists.some(a => tArtist.includes(a))) {
    // Exceptions
    if (tTitle.includes("le bon, la brute")) {
       reason = "Exclusion 1 — Cinema (Morricone)";
       breakdownKey = "Exclusion 1 (Classique/Cinéma)";
    } else {
       reason = "Exclusion 1 — Classique / Cinema / Jazz ambient";
       breakdownKey = "Exclusion 1 (Classique/Cinéma)";
    }
  }

  // EXCLUSION 2: Ballades intimes
  const ex2Targets = [
    {a: "brel", t: "ne me quitte pas"},
    {a: "brel", t: "quand on n'a que l'amour"},
    {a: "trenet", t: "la mer"},
    {a: "trenet", t: "que reste-t-il"},
    {a: "pravi", t: "voilà"},
    {a: "marvin gaye", t: "sexual healing"},
    {a: "boyz ii men", t: "end of the road"},
    {a: "boyz ii men", t: "i'll make love to you"}
  ];
  if (!reason && ex2Targets.some(tgt => tArtist.includes(tgt.a) && tTitle.includes(tgt.t))) {
    reason = "Exclusion 2 — Ballade intime sans usage soirée";
    breakdownKey = "Exclusion 2 (Ballades intimes)";
  }

  // EXCLUSION 3: Metadata cassée
  if (!reason && (tArtist === "unknown" || tArtist === "unknown artist" || tArtist === "unknown_artist")) {
    if (tTitle.match(/^[0-9]+[\s\-_]/) || tTitle.includes(".mp3") || tTitle.includes("track ") || tTitle.includes("ghost") || tTitle.includes("showdown")) {
      reason = "Exclusion 3 — Metadata cryptique / Unknown";
      breakdownKey = "Exclusion 3 (Metadata cassée)";
    }
  }

  // EXCLUSION 4: Compilation Deep House Obscure
  const ex4Artists = ["da funk heroes", "weekend player", "disposal beats", "empty rollers", "solomatics", "phatt lenny", "retro groover", "crafted sounds"];
  if (!reason && ex4Artists.some(a => tArtist.includes(a))) {
    reason = "Exclusion 4 — Deep House Obscur (compilation filler)";
    breakdownKey = "Exclusion 4 (Deep House obscur)";
  }
  // Artist starting with digits followed by capitalized letter
  if (!reason && track.artist.match(/^\d+[A-Z][a-z]/)) {
     reason = "Exclusion 4 — Deep House Obscur (compilation filler by format)";
     breakdownKey = "Exclusion 4 (Deep House obscur)";
  }

  // EXCLUSION 6: Obscur + Mort
  if (!reason && track.popularity <= 3 && track.energy <= 5) {
    reason = "Exclusion 6 — Track obscure (pop <= 3) et lente (energy <= 5)";
    breakdownKey = "Exclusion 6 (Obscur+mort)";
  }

  if (reason) {
    toPurge.push({
      id: track.id,
      title: track.title,
      artist: track.artist,
      currentGenre: track.currentGenre,
      newGenre: "PURGE",
      energy: track.energy,
      popularity: track.popularity,
      exclusionReason: reason
    });
    stats.breakdown[breakdownKey]++;
    stats.purged++;
  } else {
    stats.kept++;
  }
}

// 5. Output JSON
const outPath = '/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/tracks_to_purge.json';
fs.writeFileSync(outPath, JSON.stringify(toPurge, null, 2), 'utf8');

console.log('--- RÉCAP FINAL ---');
console.log(`Total tracks dans catalogue actuel : ${stats.total}`);
console.log(`Total tracks identifiées pour purge : ${stats.purged}`);
console.log(`Total tracks conservées : ${stats.kept}`);
console.log('Breakdown par catégorie :');
for (const [k, v] of Object.entries(stats.breakdown)) {
  console.log(`  - ${k} : ${v}`);
}

