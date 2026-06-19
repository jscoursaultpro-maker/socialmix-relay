const fs = require('fs');

const path = '../SocialMixApp/SocialMixApp/fr.lproj/Localizable.strings';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/"session\.mode\.apero" = "🥂 Apéro";/, '"session.mode.apero" = "🥂 Warm-up";');
content = content.replace(/"session\.mode\.cool" = "🎵 Cool";/, '"session.mode.cool" = "🎵 Vibe";');
content = content.replace(/"session\.mode\.dance" = "🔥 Dance";/, '"session.mode.dance" = "🔥 Peak";');

fs.writeFileSync(path, content, 'utf8');

