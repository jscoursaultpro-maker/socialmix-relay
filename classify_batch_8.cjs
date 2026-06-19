const fs = require('fs');

const batch = JSON.parse(fs.readFileSync('batch8_input.json', 'utf8'));

const corrections = [];

for (const track of batch) {
    let newGenre = track.currentGenre;
    let confidence = "high";
    let reasoning = "";
    
    let energy = 6;
    let popularity = 5;

    const t = track.title.toLowerCase();
    const a = track.artist.toLowerCase();

    // Mapping genres
    if (a.includes("kyo") || a.includes("maëlle") || a.includes("zaho de sagazan") || a.includes("calogero") || a.includes("vilain cœur") || a.includes("nuit incolore") || a.includes("molière") || a.includes("stéphane") || a.includes("stromae") || a.includes("justin timberlake") || a.includes("sophie ellis-bextor") || a.includes("will.i.am")) {
        newGenre = "Pop";
    } else if (a.includes("yaro") || a.includes("franglish") || a.includes("notorious b.i.g.") || a.includes("dr. dre") || a.includes("macklemore")) {
        newGenre = "Hip-Hop";
    } else if (a.includes("måneskin") || a.includes("korn") || a.includes("arctic monkeys") || a.includes("queen") || a.includes("ac/dc") || a.includes("indochine")) {
        newGenre = "Rock";
    } else if (a.includes("black legend") || a.includes("duck sauce") || a.includes("tristan garner") || a.includes("john beltran") || a.includes("pig&dan") || a.includes("&me") || a.includes("blond:ish") || a.includes("bob sinclar") || a.includes("armand van helden") || a.includes("watermät") || a.includes("bakermat") || a.includes("calvin harris") || a.includes("yann muller") || a.includes("justice")) {
        newGenre = "House";
    } else if (a.includes("david guetta") || a.includes("enur") || a.includes("mr.oizo") || a.includes("daft punk") || a.includes("sandro silva") || a.includes("desire") || a.includes("pitbull")) {
        newGenre = "Electro";
    } else if (a.includes("ricchi e poveri") || a.includes("pointer sisters")) {
        newGenre = "Disco";
    } else if (a.includes("daddy yankee") || a.includes("rosalía") || a.includes("bad bunny")) {
        newGenre = "Reggaeton";
    } else if (a.includes("beyoncé") || a.includes("k-maro")) {
        newGenre = "R&B";
    } else if (a.includes("goldman") || a.includes("larusso")) {
        newGenre = "COCOVARIET";
    } else if (a.includes("maître gims") || a.includes("gims")) {
        newGenre = "Afro";
        if (t.includes("est-ce que tu m'aimes")) newGenre = "Hip-Hop";
    }

    if (newGenre === "0 " || newGenre === "Unknown" || newGenre === "Techno" || newGenre === "Chill/Lounge" || newGenre === "Other") {
        newGenre = "House";
    }

    if (!["Electro", "House", "Pop", "Disco", "Hip-Hop", "Latin", "Afro", "Reggaeton", "R&B", "Rock", "COCOVARIET", "Unknown"].includes(newGenre)) {
        newGenre = "Unknown";
        confidence = "low";
    }

    // Energy logic
    if (newGenre === "Unknown" && reasoning.includes("Classique")) energy = 2;
    else if (reasoning.includes("Jazz/Chill")) energy = 3;
    else if (newGenre === "R&B") energy = 5;
    else if (newGenre === "Pop" || newGenre === "COCOVARIET") energy = 6;
    else if (newGenre === "Hip-Hop" || newGenre === "Latin" || newGenre === "Afro" || newGenre === "Reggaeton") energy = 7;
    else if (newGenre === "House" || newGenre === "Disco") energy = 7;
    else if (newGenre === "Electro" || newGenre === "Rock") energy = 8;

    // Popularity logic
    if (newGenre === "House" || newGenre === "Electro") popularity = 5;
    else if (newGenre === "Pop" || newGenre === "Hip-Hop" || newGenre === "COCOVARIET" || newGenre === "R&B") popularity = 7;
    else if (newGenre === "Disco" || newGenre === "Rock") popularity = 8;
    else if (newGenre === "Unknown") popularity = 2;
    else popularity = 6;

    // Specific overrides
    if (a.includes("notorious") || a.includes("dr. dre") || a.includes("måneskin") || a.includes("david guetta") || a.includes("daft punk") || a.includes("stromae")) {
        popularity = 9;
    }
    if (t.includes("crazy in love") || t.includes("flat beat")) {
        popularity = 10;
        energy = 8;
    }
    if (a.includes("indochine") || a.includes("goldman")) {
        popularity = 9;
    }
    if (t.includes("sapés comme jamais")) {
        popularity = 10;
    }

    corrections.push({
        id: track.id,
        title: track.title,
        artist: track.artist,
        currentGenre: track.currentGenre,
        newGenre: newGenre,
        energy: energy,
        popularity: popularity,
        confidence: confidence,
        reasoning: reasoning
    });
}

fs.writeFileSync('/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_8.json', JSON.stringify(corrections, null, 2));
