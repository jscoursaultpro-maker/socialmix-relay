const { MongoClient } = require('mongodb');
const uri = "mongodb+srv://jscoursaultpro_db_user:mylena22PRO@cluster0.drictlo.mongodb.net/socialmix?retryWrites=true&w=majority&appName=Cluster0";
async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('socialmix');
    const tracks = await db.collection('tracks').find({ title: /Missing You/i, artist: /Alhambra/i }).toArray();
    console.log("Found tracks:", tracks);
    const result = await db.collection('tracks').deleteMany({ title: /Missing You/i, artist: /Alhambra/i });
    console.log("Deleted:", result.deletedCount);
  } finally {
    await client.close();
  }
}
run().catch(console.dir);
