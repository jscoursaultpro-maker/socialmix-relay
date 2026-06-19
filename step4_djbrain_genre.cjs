const fs = require('fs');

const path = '../SocialMixApp/SocialMixApp/Engine/DJBrain.swift';
let content = fs.readFileSync(path, 'utf8');

const targetFunc = `    func parseCuratedGenre(_ genre: String) -> String {
        switch genre.trimmingCharacters(in: .whitespaces) {
        case "House", "Electro", "Dance": return "House"
        case "Urban", "Hip-Hop", "Rap", "R&B": return "Urban"
        case "Pop", "Variété", "Variety", "Chanson", "Pop/Rock": return "Pop"
        case "Disco", "Funk", "Soul", "Groove": return "Disco"
        case "Rock", "Metal", "Punk", "Indie": return "Rock"
        case "Latin", "Reggaeton", "Salsa": return "Latin"
        case "Caliente", "Afro", "Dancehall": return "Caliente"
        case "Legends", "80s", "90s", "Retro": return "Legends"
        case "Other", "0 ", "0", "":  return ""  // Unknown
        default: return "" // Unknown
        }
    }`;

const newFunc = `    func parseCuratedGenre(_ genre: String) -> String {
        switch genre.trimmingCharacters(in: .whitespaces) {
        case "House", "Electro", "Dance": return "House"
        case "Urban", "Hip-Hop", "Rap", "R&B": return "Urban"
        case "Pop", "Variété", "Variety", "Chanson", "Pop/Rock": return "Pop"
        case "Disco", "Funk", "Soul", "Groove": return "Disco"
        case "Rock", "Metal", "Punk", "Indie": return "Rock"
        case "Latin", "Reggaeton", "Salsa": return "Latin"
        case "Caliente", "Afro", "Dancehall": return "Caliente"
        case "Legends", "80s", "90s", "Retro": return "Legends"
        case "Other", "0 ", "0", "", "Unknown":  return "Pop"  // ★ P4 FIX: Fallback Pop
        default: return "Pop" // ★ P4 FIX
        }
    }`;

if (content.includes(targetFunc)) {
    content = content.replace(targetFunc, newFunc);
    fs.writeFileSync(path, content, 'utf8');
    console.log("DJBrain parseCuratedGenre patched successfully.");
} else {
    console.log("Could not find the target string in DJBrain.swift");
}

