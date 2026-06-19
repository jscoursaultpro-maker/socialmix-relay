const fs = require('fs');

const batch = JSON.parse(fs.readFileSync('batch6_input.json', 'utf8'));

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
    if (a.includes("beyoncé")) {
        // BREAK MY SOUL & CUFF IT are House/Dance
        if (t.includes("break my soul") || t.includes("cuff it")) newGenre = "House";
        else newGenre = "R&B";
    } else if (a.includes("bad bunny") || a.includes("rosalía") || a.includes("shakira") || a.includes("maluma") || a.includes("rauw alejandro") || a.includes("reik") || a.includes("farruko")) {
        newGenre = "Reggaeton";
        if (a.includes("shakira") || a.includes("reik")) newGenre = "Latin";
    } else if (a.includes("camila cabello") || a.includes("jain") || a.includes("tom gregory") || a.includes("p!nk") || a.includes("theodort") || a.includes("julien doré") || a.includes("ana mena") || a.includes("britney spears") || a.includes("blackpink") || a.includes("ariana grande") || a.includes("christophe maé") || a.includes("zara larsson") || a.includes("zaho") || a.includes("alex warren") || a.includes("charlotte cardin") || a.includes("taylor swift") || a.includes("katseye") || a.includes("djo") || a.includes("adèle castillon") || a.includes("jeck") || a.includes("oria")) {
        newGenre = "Pop";
    } else if (a.includes("kygo") || a.includes("marshmello") || a.includes("calvin harris") || a.includes("alok") || a.includes("paul kalkbrenner") || a.includes("hard lights") || a.includes("gabry ponte") || a.includes("jaxomy") || a.includes("trinix") || a.includes("bleu soleil") || a.includes("justin bieber") || a.includes("bebe rexha")) {
        newGenre = "Electro";
    } else if (a.includes("bon entendeur") || a.includes("purple disco machine") || a.includes("raye") || a.includes("regard") || a.includes("hugel") || a.includes("riton") || a.includes("lost frequencies") || a.includes("marnik") || a.includes("anotr")) {
        newGenre = "House";
    } else if (a.includes("oxlade") || a.includes("aya nakamura") || a.includes("tayc") || a.includes("joé dwet filé")) {
        newGenre = "Afro";
    } else if (a.includes("alonzo") || a.includes("sexion d'assaut") || a.includes("the weeknd") || a.includes("orelsan") || a.includes("jul") || a.includes("zola") || a.includes("gims") || a.includes("plk") || a.includes("genezio") || a.includes("hamza") || a.includes("gambi") || a.includes("booba") || a.includes("franglish") || a.includes("disiz") || a.includes("soolking") || a.includes("guy2bezbar") || a.includes("theodora") || a.includes("rambo goyard") || a.includes("temper city") || a.includes("r2") || a.includes("nono la grinta") || a.includes("rk") || a.includes("triangle des bermudes") || a.includes("ven1") || a.includes("kulturr") || a.includes("zeg p") || a.includes("mauvais djo") || a.includes("la rvfleuze") || a.includes("djaksparo") || a.includes("rnboi") || a.includes("iss")) {
        newGenre = "Hip-Hop";
    } else if (a.includes("michael jackson") || a.includes("jamelia") || a.includes("tame impala")) {
        if (a.includes("michael jackson") && t.includes("billie jean")) newGenre = "Disco";
        else if (a.includes("michael jackson") && t.includes("human nature")) newGenre = "R&B";
        else newGenre = "Pop";
        
        if (a.includes("tame impala")) newGenre = "Rock";
    } else if (a.includes("indochine") || a.includes("the rolling stones") || a.includes("the cure") || a.includes("panic! at the disco") || a.includes("kenny loggins")) {
        newGenre = "Rock";
    } else if (a.includes("joe dassin") || a.includes("mylène farmer")) {
        newGenre = "COCOVARIET";
    } else if (a.includes("bruno mars")) {
        newGenre = "R&B";
    }
    
    if (a.includes("jain") && t.includes("makeba")) {
        newGenre = "Pop";
        popularity = 8;
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
    if (a.includes("calvin harris") || a.includes("michael jackson") || a.includes("bad bunny") || a.includes("beyoncé")) {
        popularity = 9;
    }
    if (a.includes("jul") || a.includes("gims") || a.includes("aya nakamura")) {
        popularity = 8; // In France
    }
    if (t.includes("billie jean")) {
        popularity = 10;
        energy = 8;
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

fs.writeFileSync('/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_6.json', JSON.stringify(corrections, null, 2));
