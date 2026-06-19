const fs = require('fs');
let js = fs.readFileSync('server.js', 'utf8');

js = js.replace(
`    // Validation anti-template (ChatGPT baclage)
    if (arr.length > 0) {
      const counts = {};
      let maxCount = 0;
      for (const t of arr) {
        const key = \`\${t.genreBDD}|\${t.phase}|\${t.energy}|\${t.era}|\${t.bpm}\`;
        counts[key] = (counts[key] || 0) + 1;
        if (counts[key] > maxCount) maxCount = counts[key];
      }
      if (maxCount > arr.length * 0.5) {
        return res.status(400).json({ error: "⚠️ Template répétitif détecté. ChatGPT semble avoir bâclé. Vérifie l'IA utilisée (recommandé : Claude 3.5 Sonnet) ou réduis le batch size." });
      }
    }`,
`    // Patch défensif : Anti-Template (Détection stricte ChatGPT mode fichier)
    if (arr.length >= 20) {
      const uniqueGenres = new Set(arr.map(t => t.genreBDD));
      const uniquePhases = new Set(arr.map(t => t.phase));
      const uniqueEras = new Set(arr.map(t => t.era));
      const uniqueBpms = new Set(arr.map(t => t.bpm));
      const uniqueEnergies = new Set(arr.map(t => t.energy));

      const onesCount = [uniqueGenres, uniquePhases, uniqueEras, uniqueBpms, uniqueEnergies]
        .filter(s => s.size <= 1).length;

      if (onesCount === 5) {
        return res.status(400).json({
          error: "Template fabriqué détecté",
          message: "Les " + arr.length + " tracks ont exactement les mêmes valeurs. C'est un comportement de GPT-4o mode 'fichier'. Utilise Claude Opus 4.8 (claude.ai) et demande une réponse JSON directement dans le chat.",
          diversity: { genres: uniqueGenres.size, phases: uniquePhases.size, eras: uniqueEras.size }
        });
      }
    }`
);

fs.writeFileSync('server.js', js);
console.log('patched anti-template');
