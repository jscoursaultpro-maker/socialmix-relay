const fs = require('fs');

const batch = JSON.parse(fs.readFileSync('batch2_input.json', 'utf8'));

const corrections = [];

for (const track of batch) {
    let newGenre = track.currentGenre;
    let confidence = "high";
    let reasoning = "";

    const t = track.title.toLowerCase();
    const a = track.artist.toLowerCase();

    // Electro / House
    if (a.includes("avicii") || a.includes("calvin harris") || a.includes("ofenbach") || a.includes("david guetta") || a.includes("gala") || a.includes("justice") || a.includes("martin garrix") || a.includes("pitbull") || a.includes("syzz") || a.includes("dj antoine") || a.includes("lmfao") || a.includes("black eyed peas")) {
        newGenre = "Electro";
        reasoning = "Mainstream Electro/EDM per rules";
        if (a.includes("black eyed peas") && t.includes("mamacita")) { newGenre = "Reggaeton"; }
        if (a.includes("black eyed peas") && t.includes("ritmo")) { newGenre = "Reggaeton"; }
    }
    
    if (a.includes("stardust") || a.includes("daft punk")) {
        if (t.includes("get lucky")) newGenre = "Disco";
        else newGenre = "Electro";
    }

    if (a.includes("armand van helden") || a.includes("bakermat") || a.includes("crystal waters") || a.includes("fred again") || a.includes("jamie jones") || a.includes("ltj xperience") || a.includes("lykke li") || a.includes("martin solveig") || a.includes("mousse t") || a.includes("oliver $") || a.includes("the bucketheads") || a.includes("the prince karma") || a.includes("watermät") || a.includes("zhu") || a.includes("majestic")) {
        newGenre = "House";
    }

    // Hip-Hop
    if (a.includes("47ter") || a.includes("bigflo") || a.includes("cut killer") || a.includes("djadja") || a.includes("dr. dre") || a.includes("drake") || a.includes("eminem") || a.includes("fatman scoop") || a.includes("favé") || a.includes("franglish") || a.includes("hamza") || a.includes("house of pain") || a.includes("ice spice") || a.includes("jay-z") || a.includes("josman") || a.includes("jul") || a.includes("kaaris") || a.includes("keblack") || a.includes("kris kross") || a.includes("luidji") || a.includes("lynda") || a.includes("macklemore") || a.includes("maes") || a.includes("metro boomin") || a.includes("naps") || a.includes("naza") || a.includes("negrito") || a.includes("notorious") || a.includes("offset") || a.includes("rk") || a.includes("sdm") || a.includes("sensey") || a.includes("soolking") || a.includes("were vana") || a.includes("werenoi") || a.includes("yaro") || a.includes("ziak") || a.includes("niska") || a.includes("doja cat") || a.includes("flo rida") || a.includes("gims")) {
        newGenre = "Hip-Hop";
    }

    // Reggaeton
    if (a.includes("daddy yankee") || a.includes("karol g") || a.includes("becky g") || a.includes("farruko") || a.includes("fuego") || a.includes("gente de zona") || a.includes("mc fioti") || a.includes("luis fonsi") || a.includes("anitta")) {
        newGenre = "Reggaeton";
    }

    // Latin
    if (a.includes("celia cruz") || a.includes("kali uchis") || a.includes("santi sanz") || a.includes("shakira") || a.includes("michel telo")) {
        newGenre = "Latin";
    }

    // Afro
    if (a.includes("aya nakamura") || a.includes("ayra starr") || a.includes("jungeli") || a.includes("lartiste") || a.includes("kassav")) {
        newGenre = "Afro";
    }

    // Pop
    if (a.includes("beyoncé")) { newGenre = "R&B"; }
    if (a.includes("bruno mars") || a.includes("camila cabello") || a.includes("david kushner") || a.includes("iñigo quintero") || a.includes("justin timberlake") || a.includes("justin wellington") || a.includes("loreen") || a.includes("madonna") || a.includes("mae stephens") || a.includes("michael jackson") || a.includes("mika") || a.includes("olivia rodrigo") || a.includes("omi") || a.includes("onerepublic") || a.includes("selena gomez")) {
        newGenre = "Pop";
    }

    // COCOVARIET
    if (a.includes("ahma valentine") || a.includes("angèle") || a.includes("calogero") || a.includes("christophe maé") || a.includes("eddy de pretto") || a.includes("jeck") || a.includes("jovan") || a.includes("larusso") || a.includes("louane") || a.includes("maëlle") || a.includes("ridsa") || a.includes("santa")) {
        newGenre = "COCOVARIET";
    }

    // Rock
    if (a.includes("ac/dc")) { newGenre = "Rock"; }

    // Fallbacks
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

fs.writeFileSync('/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_2.json', JSON.stringify(corrections, null, 2));
