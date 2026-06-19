const fs = require('fs');

const batch = JSON.parse(fs.readFileSync('batch5_input.json', 'utf8'));

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
    if (a.includes("frank ocean") || a.includes("the weeknd") || a.includes("beyoncé") || a.includes("alicia keys") || a.includes("miguel") || a.includes("jorja smith") || a.includes("daniel caesar") || a.includes("khalid") || a.includes("sza") || a.includes("blackstreet") || a.includes("destiny's child") || a.includes("angie stone")) {
        newGenre = "R&B";
    } else if (a.includes("burna boy") || a.includes("wizkid") || a.includes("black coffee") || a.includes("tems") || a.includes("ckay") || a.includes("davido") || a.includes("angelique kidjo")) {
        newGenre = "Afro";
    } else if (a.includes("bad bunny") || a.includes("daddy yankee") || a.includes("dj snake") || a.includes("rosalía") || a.includes("karol g") || a.includes("rauw alejandro") || a.includes("nicky jam") || a.includes("sean paul") || a.includes("don omar") || a.includes("maluma")) {
        newGenre = "Reggaeton";
    } else if (a.includes("aventura") || a.includes("shakira") || a.includes("gusttavo lima") || a.includes("lucenzo") || a.includes("c. tangana") || a.includes("diana king")) {
        newGenre = "Latin";
    } else if (a.includes("depeche mode") || a.includes("new order") || a.includes("a-ha") || a.includes("tears for fears") || a.includes("the cure") || a.includes("duran duran") || a.includes("pet shop boys") || a.includes("no doubt") || a.includes("all saints") || a.includes("fine young cannibals") || a.includes("kim carnes") || a.includes("gotye") || a.includes("lily allen") || a.includes("coldplay") || a.includes("bruno mars") || a.includes("pharrell williams") || a.includes("bonnie tyler") || a.includes("robbie williams")) {
        newGenre = "Pop";
    } else if (a.includes("fatboy slim") || a.includes("the prodigy") || a.includes("the chemical brothers") || a.includes("cassius")) {
        newGenre = "Electro";
    } else if (a.includes("jamiroquai") || a.includes("geri halliwell") || a.includes("discogalactix")) {
        newGenre = "Disco";
    } else if (a.includes("oasis") || a.includes("bb brunes") || a.includes("telephone") || a.includes("guns n' roses")) {
        newGenre = "Rock";
    } else if (a.includes("claude françois") || a.includes("daniel balavoine") || a.includes("la petite culotte") || a.includes("patrick bruel") || a.includes("dalida") || a.includes("romain ughetto")) {
        newGenre = "COCOVARIET";
    } else if (a.includes("miles davis") || a.includes("norah jones") || a.includes("robert glasper") || a.includes("kamasi washington") || a.includes("chet baker") || a.includes("cannonball adderley") || a.includes("tom misch")) {
        newGenre = "Pop";
        reasoning = "Jazz/Chill mapped to Pop";
    } else if (a.includes("ludovico einaudi") || a.includes("max richter") || a.includes("yann tiersen") || a.includes("hans zimmer") || a.includes("musique triste")) {
        newGenre = "Unknown";
        reasoning = "Classique mapped to Unknown";
    } else if (a.includes("deorro") || a.includes("daft punk") || a.includes("c2c") || a.includes("martin garrix") || a.includes("david guetta") || a.includes("black eyed peas") || a.includes("bingo players") || a.includes("showtek") || a.includes("aronchupa") || a.includes("jaden bojsen") || a.includes("ph electro") || a.includes("avicii") || a.includes("alexandra stan") || a.includes("cristian marchi") || a.includes("adam beyer") || a.includes("agoria") || a.includes("sapientdream") || a.includes("youngr")) {
        newGenre = "Electro";
    } else if (a.includes("eric prydz") || a.includes("kid cudi") || a.includes("bakermat") || a.includes("fedde le grand") || a.includes("endor") || a.includes("laurent wolf") || a.includes("cheat codes") || a.includes("mr. belt & wezol") || a.includes("meduza") || a.includes("mesto") || a.includes("martin solveig") || a.includes("felipe allenn") || a.includes("instahit crew") || a.includes("helmut fritz") || a.includes("elderbrook") || a.includes("ikerfoxx") || a.includes("tr3nacria") || a.includes("marten lou") || a.includes("dj jarell") || a.includes("adriatique") || a.includes("jamie xx") || a.includes("verb") || a.includes("dj hermes") || a.includes("benedetto") || a.includes("yann muller")) {
        newGenre = "House";
    } else if (a.includes("lil nas x") || a.includes("tiakola") || a.includes("gazo") || a.includes("doechii") || a.includes("rima") || a.includes("snoop dogg") || a.includes("public enemy") || a.includes("the isley brothers") || a.includes("soprano") || a.includes("dj khaled") || a.includes("joé dwet filé")) {
        newGenre = "Hip-Hop";
        if (a.includes("joé dwet filé")) newGenre = "Afro";
    }
    
    if (a.includes("dj snake") && t.includes("taki taki")) newGenre = "Reggaeton";

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

    // Specific overrides based on tracks/artists
    if (a.includes("david guetta") || a.includes("martin garrix") || a.includes("avicii") || a.includes("daft punk") || a.includes("black eyed peas")) {
        popularity = 9;
        energy = 8;
    }
    if (t.includes("animals") || t.includes("levels") || t.includes("we will rock you") || t.includes("don't stop me now")) {
        energy = 9;
    }
    if (a.includes("shakira") || a.includes("bad bunny") || a.includes("daddy yankee")) {
        popularity = 9;
    }
    if (t.includes("despacito") || t.includes("ymca") || t.includes("september") || t.includes("get lucky") || t.includes("bohemian rhapsody")) {
        popularity = 10;
    }
    if (a.includes("the weeknd") || a.includes("beyoncé")) {
        popularity = 9;
    }
    if (t.includes("wonderwall") || t.includes("smells like teen spirit")) {
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

fs.writeFileSync('/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_5.json', JSON.stringify(corrections, null, 2));
