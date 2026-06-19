import fs from 'fs';
import path from 'path';

const outDir = path.join(process.cwd(), 'batches_out');
const files = fs.readdirSync(outDir).filter(f => f.endsWith('.json'));

console.log(`Fichiers trouvés dans batches_out/ : ${files.length}\n`);

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(outDir, file), 'utf8'));
  const arr = data.classifications;
  
  if (!arr) {
    console.log(`${file} : Pas de classifications.`);
    continue;
  }
  
  const genres = {};
  const phases = {};
  let isHardcoreCount = 0;
  
  arr.forEach(t => {
    genres[t.genreBDD] = (genres[t.genreBDD] || 0) + 1;
    phases[t.phase] = (phases[t.phase] || 0) + 1;
    if (t.isHardcore) isHardcoreCount++;
  });
  
  const uniqueGenres = Object.keys(genres).length;
  const uniquePhases = Object.keys(phases).length;
  
  const antiTemplateOK = uniqueGenres >= 3 && uniquePhases >= 2;
  
  console.log(`--- ${file} ---`);
  console.log(`Tracks à updater : ${arr.length}`);
  console.log(`Validation Anti-Template : ${antiTemplateOK ? '✅ REUSSIE' : '❌ REJETEE'} (Genres distincts: ${uniqueGenres}, Phases distinctes: ${uniquePhases})`);
  console.log(`Hardcore détecté : ${isHardcoreCount}`);
  console.log(`Distribution Genres :`, genres);
  console.log(`Distribution Phases :`, phases);
  console.log();
}
