const fs = require('fs');

let js = fs.readFileSync('server.js', 'utf8');

js = js.replace(
  "let prompt = `Tu es un DJ professionnel expert qui aide à classer des tracks pour l'app SocialMix",
  "let prompt = `[INSTRUCTION POUR CHATGPT : Lis l'intégralité de ce message (qui peut t'apparaître sous forme de fichier texte joint si le texte est long). Classe les ${targets.length} tracks de la liste à la fin du document en suivant strictement les règles ci-dessous. Tu dois me renvoyer DIRECTEMENT et UNIQUEMENT le JSON Array complet des ${targets.length} objets.]\n\nTu es un DJ professionnel expert qui aide à classer des tracks pour l'app SocialMix"
);

fs.writeFileSync('server.js', js);
console.log('patched prompt intro');
