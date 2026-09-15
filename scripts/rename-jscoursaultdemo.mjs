import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ahouai';
const isExecute = process.argv.includes('--execute');
const OLD_HANDLE = 'jscoursaultdemo';
const NEW_HANDLE = 'jscours';

async function checkAllReferences() {
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(MONGO_URI);
  console.log(`Connected. Mode: ${isExecute ? 'EXECUTE (Updating)' : 'DRY RUN (Read-only)'}`);

  const db = mongoose.connection.db;

  const collectionsToCheck = [
    { name: 'users', query: { 'profile.handle': OLD_HANDLE }, update: { $set: { 'profile.handle': NEW_HANDLE } } },
    { name: 'parties', query: { 'hostProfile.handle': OLD_HANDLE }, update: { $set: { 'hostProfile.handle': NEW_HANDLE } } },
    { name: 'hostplaybackhistories', query: { hostHandle: OLD_HANDLE }, update: { $set: { hostHandle: NEW_HANDLE } } },
    { name: 'users', query: { 'friends.handle': OLD_HANDLE }, update: { $set: { 'friends.$[elem].handle': NEW_HANDLE } }, arrayFilters: [{ 'elem.handle': OLD_HANDLE }] }, 
    { name: 'parties', query: { 'participants.handle': OLD_HANDLE }, update: { $set: { 'participants.$[elem].handle': NEW_HANDLE } }, arrayFilters: [{ 'elem.handle': OLD_HANDLE }] }
  ];

  for (const coll of collectionsToCheck) {
    const collection = db.collection(coll.name);
    
    // Check if collection exists
    const colls = await db.listCollections({ name: coll.name }).toArray();
    if (colls.length === 0) continue;

    const count = await collection.countDocuments(coll.query);
    console.log(`- Collection [${coll.name}] matches for "${OLD_HANDLE}": ${count}`);

    if (isExecute && count > 0) {
      const result = await collection.updateMany(
        coll.query, 
        coll.update,
        coll.arrayFilters ? { arrayFilters: coll.arrayFilters } : {}
      );
      console.log(`  -> Updated ${result.modifiedCount} documents in collection ${coll.name}`);
    }
  }

  console.log(`Migration script finished.`);
  process.exit(0);
}

checkAllReferences().catch(err => {
  console.error(err);
  process.exit(1);
});
