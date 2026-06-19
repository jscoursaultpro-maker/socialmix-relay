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
    const fullSearch = t + " " + a;

    // Mapping genres
    if (fullSearch.includes("kyo") || fullSearch.includes("maëlle") || fullSearch.includes("zaho de sagazan") || fullSearch.includes("calogero") || fullSearch.includes("vilain cœur") || fullSearch.includes("nuit incolore") || fullSearch.includes("molière") || fullSearch.includes("stéphane") || fullSearch.includes("stromae") || fullSearch.includes("justin timberlake") || fullSearch.includes("sophie ellis-bextor") || fullSearch.includes("will.i.am") || fullSearch.includes("will.i.am")) {
        newGenre = "Pop";
    } else if (fullSearch.includes("yaro") || fullSearch.includes("franglish") || fullSearch.includes("notorious b.i.g.") || fullSearch.includes("dr. dre") || fullSearch.includes("dr dre") || fullSearch.includes("macklemore")) {
        newGenre = "Hip-Hop";
    } else if (fullSearch.includes("måneskin") || fullSearch.includes("korn") || fullSearch.includes("arctic monkeys") || fullSearch.includes("queen") || fullSearch.includes("ac/dc") || fullSearch.includes("indochine")) {
        newGenre = "Rock";
    } else if (fullSearch.includes("black legend") || fullSearch.includes("duck sauce") || fullSearch.includes("tristan garner") || fullSearch.includes("john beltran") || fullSearch.includes("pig&dan") || fullSearch.includes("&me") || fullSearch.includes("blond:ish") || fullSearch.includes("bob sinclar") || fullSearch.includes("armand van helden") || fullSearch.includes("watermät") || fullSearch.includes("bakermat") || fullSearch.includes("calvin harris") || fullSearch.includes("yann muller") || fullSearch.includes("justice") || fullSearch.includes("sandro silva")) {
        newGenre = "House";
    } else if (fullSearch.includes("david guetta") || fullSearch.includes("enur") || fullSearch.includes("mr.oizo") || fullSearch.includes("mr. oizo") || fullSearch.includes("daft punk") || fullSearch.includes("desire") || fullSearch.includes("pitbull")) {
        newGenre = "Electro";
    } else if (fullSearch.includes("ricchi e poveri") || fullSearch.includes("pointer sisters")) {
        newGenre = "Disco";
    } else if (fullSearch.includes("daddy yankee") || fullSearch.includes("rosalía") || fullSearch.includes("bad bunny")) {
        newGenre = "Reggaeton";
    } else if (fullSearch.includes("beyoncé") || fullSearch.includes("k-maro")) {
        newGenre = "R&B";
    } else if (fullSearch.includes("goldman") || fullSearch.includes("larusso")) {
        newGenre = "COCOVARIET";
    } else if (fullSearch.includes("maître gims") || fullSearch.includes("gims")) {
        newGenre = "Afro";
        if (t.includes("est-ce que tu m'aimes")) newGenre = "Hip-Hop";
    }

    if (newGenre === "0 " || newGenre === "Unknown" || newGenre === "Techno" || newGenre === "Chill/Lounge" || newGenre === "Other") {
        newGenre = "House"; // compilation tracks
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
    if (fullSearch.includes("notorious") || fullSearch.includes("dr. dre") || fullSearch.includes("måneskin") || fullSearch.includes("david guetta") || fullSearch.includes("daft punk") || fullSearch.includes("stromae")) {
        popularity = 9;
    }
    if (t.includes("crazy in love") || t.includes("flat beat")) {
        popularity = 10;
        energy = 8;
    }
    if (fullSearch.includes("indochine") || fullSearch.includes("goldman")) {
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
