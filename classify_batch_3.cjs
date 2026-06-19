const fs = require('fs');

const batch = JSON.parse(fs.readFileSync('batch3_input.json', 'utf8'));

const corrections = [];

for (const track of batch) {
    let newGenre = track.currentGenre;
    let confidence = "high";
    let reasoning = "";

    const t = track.title.toLowerCase();
    const a = track.artist.toLowerCase();

    // COCOVARIET
    if (a.includes("gainsbourg") || a.includes("slimane") || a.includes("stromae") || a.includes("vilain cœur") || a.includes("zaho de sagazan")) {
        newGenre = "COCOVARIET";
        reasoning = "";
    }

    // Pop
    if (a.includes("spice girls") || a.includes("the weeknd") || a.includes("troye sivan") || a.includes("billie eilish") || a.includes("lewis capaldi") || a.includes("rihanna") || (t.includes("cooler than me"))) {
        newGenre = "Pop";
        reasoning = "";
    }

    // Electro
    if (a.includes("david guetta") || a.includes("will.i.am") || a.includes("dj snake") || a.includes("teddybears") || a.includes("enrique iglesias") || t.includes("i know you want me")) {
        newGenre = "Electro";
        reasoning = "";
        if (a.includes("dj snake") && t.includes("loco contigo")) {
            newGenre = "Reggaeton";
        }
    }

    // Disco
    if (a.includes("sophie ellis-bextor") || a.includes("patrick hernandez") || a.includes("boney m") || a.includes("imagination") || a.includes("rod stewart") || a.includes("sylvester") || a.includes("chic") || a.includes("village people") || a.includes("indeep") || a.includes("anita ward") || a.includes("diana ross") || a.includes("kc & the sunshine") || a.includes("abba") || a.includes("the weather girls") || a.includes("kool & the gang") || a.includes("the trammps") || a.includes("donna summer") || a.includes("sister sledge") || a.includes("manu dibango") || a.includes("phyllis hyman") || a.includes("barry white") || a.includes("jamiroquai") || a.includes("gloria gaynor") || a.includes("vicki sue robinson") || a.includes("marvin gaye") || a.includes("van mccoy") || a.includes("teena marie") || a.includes("candi staton") || a.includes("amii stewart") || a.includes("thelma houston") || a.includes("lipps inc") || a.includes("carl douglas") || a.includes("the supremes") || a.includes("commodores") || a.includes("cheryl lynn") || a.includes("michael zager") || a.includes("taste of honey") || a.includes("isley brothers") || a.includes("boys town gang") || a.includes("bee gees")) {
        newGenre = "Disco";
        reasoning = "";
    }
    if (a.includes("michael jackson") && t.includes("don't stop 'til you get enough")) {
        newGenre = "Disco";
    } else if (a.includes("michael jackson")) {
        newGenre = "Pop";
    }

    // R&B
    if (a.includes("aretha franklin") || a.includes("beyoncé") || a.includes("k-maro") || a.includes("mary j. blige") || a.includes("lauryn hill") || a.includes("usher")) {
        newGenre = "R&B";
        reasoning = "";
    }

    // Afro
    if (a.includes("aya nakamura") || a.includes("tayc")) {
        newGenre = "Afro";
        reasoning = "";
    }

    // Latin
    if (a.includes("shakira")) {
        newGenre = "Latin";
        reasoning = "";
    }

    // Reggaeton
    if (a.includes("daddy yankee") || a.includes("bad bunny") || a.includes("j balvin") || a.includes("rosalía") || a.includes("sean paul")) {
        newGenre = "Reggaeton";
        reasoning = "";
    }
    if (a.includes("major lazer") && t.includes("que calor")) {
        newGenre = "Reggaeton";
    }

    // Rock
    if (a.includes("ac/dc") || a.includes("foo fighters") || a.includes("imagine dragons") || a.includes("kings of leon") || a.includes("måneskin") || a.includes("muse") || a.includes("nirvana") || a.includes("queen") || a.includes("red hot chili") || a.includes("tame impala") || a.includes("the baseballs") || a.includes("the killers") || a.includes("the white stripes") || a.includes("yungblud") || t.includes("brick by boring brick") || t.includes("korn-blind")) {
        newGenre = "Rock";
        reasoning = "";
    }

    // House (Keep the bottom list as House)
    const houseArtists = ["amor", "hugel", "jonas blue", "metaboy", "amani amara", "adam port", "francis mercier", "camelphat", "bees & honey", "topic", "skyla tylaa", "massuma", "palm monkey", "arodes", "twopilots", "juno (de)", "klymvx", "les castizos", "africanism", "dalexo", "david mackay", "grossomoddo", "hmwme", "booba", "hotlap", "russi"];
    if (houseArtists.some(ha => a.includes(ha)) && newGenre !== "Hip-Hop") {
        // Booba is House if it's the Seychelles Remix
        if (a.includes("booba") && t.includes("seychelles remix")) {
            newGenre = "House";
        } else if (a.includes("booba")) {
            newGenre = "Hip-Hop";
        } else {
            newGenre = "House";
        }
        reasoning = "";
    }

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

fs.writeFileSync('/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_3.json', JSON.stringify(corrections, null, 2));
