import { MongoClient } from 'mongodb';

async function run() {
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const db = client.db(process.env.MONGODB_URI.split('/').pop().split('?')[0]);
        
        const tracksColl = db.collection('tracks');
        
        // Find all tracks where energy is a double (type 1) or has a fractional part
        const tracks = await tracksColl.find({}).toArray();
        let fixedCount = 0;
        
        for (const t of tracks) {
            if (typeof t.energy === 'number' && !Number.isInteger(t.energy)) {
                const rounded = Math.round(t.energy);
                console.log(`Fixing track "${t.title}": energy ${t.energy} -> ${rounded}`);
                await tracksColl.updateOne(
                    { _id: t._id },
                    { $set: { energy: rounded } }
                );
                fixedCount++;
            }
        }
        
        console.log(`Fixed ${fixedCount} tracks with float energy.`);
    } finally {
        await client.close();
    }
}

run().catch(console.error);
