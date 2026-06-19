const fs = require('fs');
let js = fs.readFileSync('server.js', 'utf8');

js = js.replace(
  "if (body.danceability !== undefined) t.danceability = Math.min(1, Math.max(0, Number(body.danceability)));",
  `if (body.danceability !== undefined) t.danceability = Math.min(1, Math.max(0, Number(body.danceability)));
    if (body.uiCategoryPrimary !== undefined) t.uiCategoryPrimary = body.uiCategoryPrimary;
    if (body.uiCategoriesSecondary !== undefined) t.uiCategoriesSecondary = body.uiCategoriesSecondary;
    if (body.phaseAlternate !== undefined) t.phaseAlternate = body.phaseAlternate;
    if (body.era !== undefined) t.era = body.era;
    if (body.mood !== undefined) t.mood = body.mood;
    if (body.language !== undefined) t.language = body.language;
    if (body.isBanger !== undefined) t.isBanger = Boolean(body.isBanger);
    if (body.isSingalong !== undefined) t.isSingalong = Boolean(body.isSingalong);
    if (body.isEmotional !== undefined) t.isEmotional = Boolean(body.isEmotional);
    if (body.isCaliente !== undefined) t.isCaliente = Boolean(body.isCaliente);
    if (body.isHardcore !== undefined) t.isHardcore = Boolean(body.isHardcore);`
);

fs.writeFileSync('server.js', js);
console.log('patched save route');
