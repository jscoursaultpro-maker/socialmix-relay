import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

const DB_URI = process.env.MONGODB_URI;

// Utilisation : node bulk-downgrade-suspects.mjs <fichier_json_avec_ids>
// Le fichier JSON doit contenir un tableau d'objets : [{ "_id": "...", "reason": "..." }, ...]

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
      console.error("Veuillez fournir un fichier JSON contenant les pistes à downgrader.");
      console.error("Exemple: node bulk-downgrade-suspects.mjs suspects.json");
      process.exit(1);
  }

  const filePath = path.resolve(args[0]);
  if (!fs.existsSync(filePath)) {
      console.error(`Fichier introuvable: ${filePath}`);
      process.exit(1);
  }

  const suspects = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  await mongoose.connect(DB_URI);
  const db = mongoose.connection.db;

  console.log(`Traitement de ${suspects.length} pistes pour downgrade vers 'partielle'...`);

  let successCount = 0;
  for (const s of suspects) {
      const query = s._id ? { _id: new mongoose.Types.ObjectId(s._id) } : { isrc: s.isrc };
      const track = await db.collection('tracks').findOne(query);
      
      if (!track) {
          console.warn(`⚠️ Piste non trouvée: ${JSON.stringify(query)}`);
          continue;
      }

      if (track.qualityLevel === 'partielle') {
          console.log(`⏩ Déjà partielle: "${track.title}" - ${track.artist}`);
          continue;
      }

      const oldQuality = track.qualityLevel;
      const result = await db.collection('tracks').updateOne(query, {
          $set: { 
              qualityLevel: 'partielle',
              qualityDowngradedFrom: oldQuality,
              qualityDowngradeReason: s.reason || 'Audit VAR Claude'
          }
      });

      if (result.modifiedCount > 0) {
          console.log(`✅ Downgrade OK [${oldQuality} -> partielle] : "${track.title}" - ${track.artist} (${s.reason || 'Audit VAR Claude'})`);
          successCount++;
      }
  }

  console.log(`\n🎉 Terminé ! ${successCount} pistes downgradées.`);
  await mongoose.disconnect();
}

main().catch(console.error);
