const fs = require('fs');

const batch = JSON.parse(fs.readFileSync('batch4_input.json', 'utf8'));

const corrections = [];

for (const track of batch) {
    let newGenre = track.currentGenre;
    let confidence = "high";
    let reasoning = "";

    const t = track.title.toLowerCase();
    const a = track.artist.toLowerCase();

    // COCOVARIET
    if (a.includes("céline dion") || a.includes("50 tubes au top") || a.includes("magic system") || a.includes("images") || a.includes("gilbert montagné") || a.includes("claude françois") || a.includes("louise attaque") || a.includes("telephone") || a.includes("mylène farmer") || a.includes("france gall") || a.includes("la petite culotte") || a.includes("yanns") || a.includes("star academy")) {
        newGenre = "COCOVARIET";
        reasoning = "";
    }

    // Pop
    if (a.includes("dua lipa") || a.includes("harry styles") || a.includes("billie eilish") || a.includes("lizzo") || a.includes("miley cyrus") || a.includes("lady gaga") || a.includes("sza") || a.includes("ed sheeran") || a.includes("rihanna") || a.includes("carly rae jepsen") || a.includes("sia") || a.includes("katy perry") || a.includes("gwen stefani") || a.includes("estelle") || a.includes("tove lo") || a.includes("myles smith")) {
        newGenre = "Pop";
        reasoning = "";
    }

    // Rock
    if (a.includes("måneskin")) {
        newGenre = "Rock";
        reasoning = "";
    }

    // Hip-Hop
    if (a.includes("kendrick lamar") || a.includes("travis scott") || a.includes("drake") || a.includes("kanye west") || a.includes("jay z") || a.includes("post malone") || a.includes("cardi b") || a.includes("tyler, the creator") || a.includes("a$ap rocky") || a.includes("migos") || a.includes("21 savage") || a.includes("lil nas x") || a.includes("2pac") || a.includes("bigflo")) {
        newGenre = "Hip-Hop";
        reasoning = "";
    }

    // Electro
    if (a.includes("carl cox") || a.includes("adriatique") || a.includes("camelphat") || a.includes("fisher") || a.includes("meduza") || a.includes("peggy gou") || a.includes("black eyed peas") || a.includes("dynoro") || a.includes("gabry ponte") || a.includes("matway") || a.includes("david guetta")) {
        newGenre = "Electro";
        reasoning = "";
    }

    // House
    if (a.includes("regard") || a.includes("deco") || a.includes("moblack") || a.includes("vanco") || a.includes("dalexo") || a.includes("tinie") || a.includes("monolink") || a.includes("choujaa") || a.includes("palm brothers") || a.includes("dennis cartier") || a.includes("ontonic") || a.includes("andrea oliva") || a.includes("tom enzy") || a.includes("lazy otter") || a.includes("eriice") || a.includes("dj lewis") || a.includes("with u") || a.includes("sinego") || a.includes("moguai") || a.includes("russi") || a.includes("merzzy") || a.includes("edward maya") || a.includes("maz") || a.includes("themba") || a.includes("french fuse") || a.includes("joezi") || a.includes("dallien") || a.includes("mestiza") || a.includes("luch") || a.includes("francis mercier") || a.includes("rbør") || a.includes("andhim") || a.includes("adassiya") || a.includes("jonas dufrasne") || a.includes("anton khabbaz") || a.includes("ginton") || a.includes("palm monkey") || a.includes("arodes") || a.includes("faul & wad") || a.includes("xinobi") || a.includes("edmundo silva") || a.includes("dj zinhle") || a.includes("liva k") || a.includes("monkey safari") || a.includes("ajna") || a.includes("nomadique") || a.includes("hafex") || a.includes("johnny esco") || a.includes("maxi meraki") || a.includes("glowal") || a.includes("ameme") || a.includes("danidane") || a.includes("kilimanjaro") || a.includes("2nomads") || a.includes("afrodisiak") || a.includes("aden lou") || a.includes("jerry ropero") || a.includes("d4nyo") || a.includes("samuel prince") || a.includes("natty rico") || a.includes("hugel") || a.includes("mont rouge") || a.includes("&me") || a.includes("kungs") || a.includes("foreal people") || a.includes("robosonic") || a.includes("damian lazarus") || a.includes("jimi jules") || a.includes("javi colors") || a.includes("michael gray") || a.includes("tinlicker") || a.includes("redondo") || a.includes("sigala") || a.includes("nightcrawlers") || a.includes("purple disco machine") || a.includes("amor") || a.includes("jonas blue") || a.includes("metaboy") || a.includes("amani amara") || a.includes("adam port") || a.includes("camelphat") || a.includes("bees & honey") || a.includes("topic") || a.includes("skyla tylaa") || a.includes("massuma") || a.includes("twopilots") || a.includes("juno") || a.includes("klymvx") || a.includes("les castizos") || a.includes("africanism") || a.includes("david mackay") || a.includes("grossomoddo") || a.includes("hmwme") || a.includes("booba") || a.includes("hotlap")) {
        newGenre = "House";
        reasoning = "";
        if (a.includes("booba") && !t.includes("seychelles remix")) newGenre = "Hip-Hop";
        if (a.includes("camelphat")) newGenre = "Electro";
        if (a.includes("oliver tree")) { newGenre = "House"; reasoning = "Marten Lou remix"; }
    }
    
    if (a.includes("oliver tree")) {
        newGenre = "House";
        reasoning = "Marten Lou remix";
    }

    // Disco
    if (a.includes("breakbot") || a.includes("kc & the sunshine") || a.includes("jamiroquai") || a.includes("parcels") || a.includes("oliver cheatham") || a.includes("doobie brothers")) {
        newGenre = "Disco";
        reasoning = "";
    }

    // Afro
    if (a.includes("omah lay")) {
        newGenre = "Afro";
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

fs.writeFileSync('/Users/Jean-Sebastien/.gemini/antigravity-ide/brain/71810c77-ecfc-4bfa-964f-df75df6ff72f/genre_corrections_batch_4.json', JSON.stringify(corrections, null, 2));
