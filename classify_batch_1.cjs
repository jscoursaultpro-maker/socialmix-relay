const fs = require('fs');

const batch = JSON.parse(fs.readFileSync('batch1_input.json', 'utf8'));

const corrections = [];

for (const track of batch) {
    let newGenre = track.currentGenre;
    let confidence = "high";
    let reasoning = "";

    const t = track.title.toLowerCase();
    const a = track.artist.toLowerCase();

    // Café del Mar / Chill -> House
    if (track.currentGenre === "Chill" || a.includes("cafe") || t.includes("cafe del mar")) {
        newGenre = "House";
        reasoning = "Chillout/Lounge mapped to House";
    }

    if (a.includes("andrea terrano") || a.includes("betejaymadeit") || a.includes("ethiopian chyld") || a.includes("roque") || a.includes("young ginger")) {
        newGenre = "House";
        if (a.includes("young ginger")) newGenre = "Afro";
    }

    if (a.includes("jahyanai") || a.includes("rema") || a.includes("vacra") || a.includes("medhy")) {
        newGenre = "Afro";
    }

    if (a.includes("eurythmics")) { newGenre = "Pop"; }
    
    if (a.includes("joseph kamel") || a.includes("kyo") || a.includes("mentissa") || a.includes("molière") || a.includes("nuit incolore") || a.includes("pierre de maere") || a.includes("stéphane") || a.includes("vianney")) {
        newGenre = "COCOVARIET";
    }
    
    if (a.includes("marina kaye")) { newGenre = "Pop"; reasoning = "French artist but sings in English mainstream Pop"; }
    if (a.includes("abba")) { newGenre = "Disco"; }
    if (a.includes("ricchi e poveri")) { newGenre = "Pop"; reasoning = "Italian pop mapped to Pop"; }

    if (a.includes("daft punk")) {
        if (t.includes("get lucky")) newGenre = "Disco";
        else newGenre = "Electro";
        reasoning = "Daft Punk is Electro (except Get Lucky = Disco)";
    }

    if (a.includes("&me") || a.includes("adam port") || a.includes("ahmed spins") || a.includes("arodes") || a.includes("bicep") || a.includes("blond:ish") || a.includes("bob sinclar") || a.includes("david guetta") || a.includes("demon") || a.includes("denis horvat") || a.includes("dylan linde") || a.includes("enur") || a.includes("eric prydz") || a.includes("fedde le grand") || a.includes("francis mercier") || a.includes("joezi") || a.includes("madhouse") || a.includes("marasi") || a.includes("marten lou") || a.includes("martin solveig") || a.includes("maxi meraki") || a.includes("mili") || a.includes("monkey safari") || a.includes("mont rouge") || a.includes("mooglie") || a.includes("moojo") || a.includes("nico morano") || a.includes("notre dame") || a.includes("pablo fierro") || a.includes("paul johnson") || a.includes("raffa guido") || a.includes("rampa") || a.includes("rebrn") || a.includes("rüfüs du sol") || a.includes("soulroots") || a.includes("swedish house mafia") || a.includes("trinix") || a.includes("trouble men") || a.includes("ugo banchi") || a.includes("yann muller") || a.includes("zac")) {
        newGenre = "House";
        if (a.includes("david guetta") && (t.includes("hey mama") || t.includes("paris") || t.includes("where them"))) newGenre = "Electro";
    }

    if (a.includes("alan braxe") || a.includes("avicii") || a.includes("bang la decks") || a.includes("basto") || a.includes("calvin harris") || a.includes("fake blood") || a.includes("hardwell") || a.includes("jamy nox") || a.includes("marnik") || a.includes("moderat") || a.includes("mr.oizo") || a.includes("ofenbach") || a.includes("oskar med k") || a.includes("rex the dog") || a.includes("sound of legend") || a.includes("sex") || t.includes("epic") || t.includes("infinity 2008") || t.includes("lonely heart") || t.includes("cry for you") || t.includes("make your own kind") || t.includes("ibiza") || t.includes("get up") || a.includes("will.i.am") || a.includes("diala")) {
        newGenre = "Electro";
    }

    if (a.includes("adele")) { newGenre = "House"; reasoning = "House remix"; }
    if (a.includes("desire")) { newGenre = "Pop"; }
    if (a.includes("jain")) { newGenre = "Pop"; }
    if (a.includes("kenya grace")) { newGenre = "Pop"; }
    if (a.includes("major lazer")) { newGenre = "Electro"; }
    if (a.includes("picture this")) { newGenre = "Pop"; }
    if (t.includes("when i grow up")) { newGenre = "Pop"; reasoning = "Pussycat dolls = Pop"; }

    if (newGenre === track.currentGenre && track.currentGenre === "Chill") newGenre = "House"; // Fallback
    if (!["Electro", "House", "Pop", "Disco", "Hip-Hop", "Latin", "Afro", "Reggaeton", "R&B", "Rock", "COCOVARIET", "Unknown"].includes(newGenre)) {
        newGenre = "Unknown";
        confidence = "low";
    }

    corrections.push({
        id: track.id,
        title: track.title,
        artist: track.artist,
        currentGenre: track.currentGenre,
        newGenre: newGenre,
        confidence: confidence,
        reasoning: reasoning
    });
}

fs.writeFileSync('genre_corrections_batch_1.json', JSON.stringify(corrections, null, 2));
