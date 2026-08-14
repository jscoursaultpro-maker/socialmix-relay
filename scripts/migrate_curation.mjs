import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("Erreur : MONGODB_URI ou MONGO_URI manquant.");
  process.exit(1);
}

const apply = process.argv.includes('--apply');

async function migrate() {
  console.log(`Connexion à MongoDB...`);
  await mongoose.connect(uri);
  console.log(`✅ Connecté.`);

  // On importe le modèle existant s'il existe, sinon on le crée
  const Track = mongoose.models.Track || mongoose.model('Track', new mongoose.Schema({}, { strict: false }));

  console.log(`Démarrage de la migration de curation ${apply ? '(MODE APPLY)' : '(MODE DRY-RUN)'}...`);

  const tracks = await Track.find({}).lean();
  
  let toIn = 0;
  let toFiller = 0;
  let toBacklog = 0;

  for (const track of tracks) {
    let newCuration = 'backlog';
    
    if (track.isBanger === true) {
      newCuration = 'in';
      toIn++;
    } else if (track.isFiller === true) {
      newCuration = 'filler';
      toFiller++;
    } else {
      toBacklog++;
    }

    if (apply) {
      await Track.updateOne({ _id: track._id }, { $set: { curation: newCuration } });
    }
  }

  console.log(`\n=== RAPPORT DE MIGRATION ===`);
  console.log(`Total scanné : ${tracks.length}`);
  console.log(`Mappé vers 'in' : ${toIn}`);
  console.log(`Mappé vers 'filler' : ${toFiller}`);
  console.log(`Mappé vers 'backlog' : ${toBacklog}`);
  console.log(`Status : ${apply ? 'APPLIED (Données modifiées)' : 'DRY-RUN (Aucune donnée modifiée, relancer avec --apply)'}`);

  process.exit(0);
}

migrate().catch(err => {
  console.error("Erreur fatale :", err);
  process.exit(1);
});
