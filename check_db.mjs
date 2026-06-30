import { MongoClient } from 'mongodb';

async function run() {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.MONGODB_URI.split('/').pop().split('?')[0]);
    
    console.log("=== DB COUNTS ===");
    const inCount = await db.collection('tracks').countDocuments({ isBanger: true, qualityLevel: { $in: ['platine', 'complete'] } });
    const fillerCount = await db.collection('tracks').countDocuments({ isFiller: true, qualityLevel: { $in: ['platine', 'complete'] } });
    const backlogCount = await db.collection('tracks').countDocuments({ isBanger: { $ne: true }, isFiller: { $ne: true }, qualityLevel: { $in: ['platine', 'complete'] } });
    
    console.log(`IN (isBanger): ${inCount}`);
    console.log(`Backlog (ni l'un ni l'autre): ${backlogCount}`);
    console.log(`Filler (isFiller): ${fillerCount}`);
    
    console.log("\n=== SPECIFIC TRACKS ===");
    const track1 = await db.collection('tracks').findOne({title: /forever young/i, artist: /murph/i}, {projection: {qualityLevel:1, isBanger:1}});
    console.log("Forever Young (murph):", track1);
    
    const track2 = await db.collection('tracks').findOne({title: /september/i, artist: /deepend/i}, {projection: {qualityLevel:1, isBanger:1}});
    console.log("September (deepend):", track2);
    
    console.log("\n=== PHASE COUNTS ===");
    console.log("party:", await db.collection('tracks').countDocuments({phase: "party"}));
    console.log("peak:", await db.collection('tracks').countDocuments({phase: "peak"}));
    console.log("peaktime:", await db.collection('tracks').countDocuments({phase: "peaktime"}));
    console.log("isBlocked (acapella/other):", await db.collection('tracks').countDocuments({isBlocked: true}));
    
    process.exit(0);
}
run().catch(console.error);
