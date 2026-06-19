const fs = require('fs');

const batch = JSON.parse(fs.readFileSync('batch7_input.json', 'utf8'));

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
    if (a.includes("beck") || a.includes("rage against the machine") || a.includes("oasis") || a.includes("red hot chili") || a.includes("green day") || a.includes("the cure") || a.includes("joan jett") || a.includes("wheatus") || a.includes("arctic monkeys") || a.includes("offspring") || a.includes("smash mouth") || a.includes("franz ferdinand") || a.includes("refused") || a.includes("boston") || a.includes("queen") || a.includes("linkin park") || a.includes("the clash") || a.includes("metallica") || a.includes("guns n' roses") || a.includes("alien ant farm") || a.includes("blur") || a.includes("van halen") || a.includes("massive wagons") || a.includes("the police") || a.includes("måneskin") || a.includes("the undertones") || a.includes("the hives") || a.includes("the killers") || a.includes("the cramps") || a.includes("the knack") || a.includes("sex pistols") || a.includes("pixies") || a.includes("queens of the stone age") || a.includes("supergrass") || a.includes("wolfmother") || a.includes("the darkness") || a.includes("kasabian") || a.includes("ac/dc") || a.includes("nirvana") || a.includes("the baseballs")) {
        newGenre = "Rock";
    } else if (a.includes("toto") || a.includes("the beatles") || a.includes("david bowie") || a.includes("europe") || a.includes("gorillaz") || a.includes("louane") || a.includes("eddy de pretto") || a.includes("mika") || a.includes("christophe maé") || a.includes("slimane") || a.includes("iñigo quintero") || a.includes("black eyed peas") || a.includes("the pussycat dolls") || a.includes("medhy_custos")) {
        newGenre = "Pop";
    } else if (a.includes("beastie boys") || a.includes("run-dmc") || a.includes("macklemore") || a.includes("jul") || a.includes("bigflo") || a.includes("werenoi") || a.includes("naza") || a.includes("naps") || a.includes("negrito") || a.includes("snoop dogg") || a.includes("eminem") || a.includes("jay-z") || a.includes("kanye west")) {
        newGenre = "Hip-Hop";
    } else if (a.includes("blondie") || a.includes("carl carlton") || a.includes("grey & hanks") || a.includes("kenny lynch") || a.includes("t.c. curtis") || a.includes("asso") || a.includes("bohannon")) {
        newGenre = "Disco";
    } else if (a.includes("armand van helden") || a.includes("bob sinclar") || a.includes("martin solveig") || a.includes("muttonheads") || a.includes("september") || a.includes("desaparecidos") || a.includes("sky and sand") || a.includes("basto") || a.includes("madhouse")) {
        newGenre = "House";
    } else if (a.includes("david guetta") || a.includes("guru josh") || a.includes("pitbull") || a.includes("radio killer") || a.includes("diala") || a.includes("bingo players") || a.includes("the bloody beetroots")) {
        newGenre = "Electro";
    } else if (a.includes("kassav'")) {
        newGenre = "COCOVARIET";
    } else if (a.includes("beyoncé")) {
        newGenre = "R&B";
    } else if (a.includes("jungeli")) {
        newGenre = "Afro";
    } else if (a.includes("daddy yankee") || a.includes("pan head") || a.includes("fuego")) {
        newGenre = "Reggaeton";
    }

    // Fix compilation names or unknown 
    if (newGenre === "0 " || newGenre === "Unknown") {
        if (a.includes("unknown") || a.includes("0 ")) {
            if (t.includes("the bomb") || t.includes("smell like teen spirit") || t.includes("meltdown") || t.includes("the next episode")) {
                if (t.includes("smell like teen spirit")) newGenre = "Rock";
                else if (t.includes("the next episode")) newGenre = "Hip-Hop";
                else if (t.includes("the bomb")) newGenre = "House";
                else newGenre = "Electro";
            } else {
                newGenre = "House"; // Most of the "0 " genre tracks are deep house tracks
            }
        } else {
            // These artists with "0 " genre are definitely House 
            newGenre = "House"; 
        }
    }
    
    if (t.includes("lose your self")) newGenre = "Hip-Hop";

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
    if (a.includes("queen") || a.includes("nirvana") || a.includes("ac/dc") || a.includes("david guetta") || a.includes("the beatles")) {
        popularity = 10;
        energy = 8;
    }
    if (a.includes("oasis") || a.includes("red hot chili") || a.includes("green day") || a.includes("the clash") || a.includes("the offspring") || a.includes("metallica")) {
        popularity = 9;
        energy = 8;
    }
    if (t.includes("killing in the name") || t.includes("smells like teen spirit")) {
        energy = 9;
        popularity = 9;
    }
    if (a.includes("jul") || a.includes("christophe maé") || a.includes("slimane") || a.includes("bigflo")) {
        popularity = 8; // FR
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

fs.writeFileSync('/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_7.json', JSON.stringify(corrections, null, 2));
