import mongoose from 'mongoose';
import Track from './models/Track.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const dupesByHash = await Track.aggregate([
    { $group: { 
      _id: "$fallbackHash", 
      count: { $sum: 1 }, 
      ids: { $push: "$_id" }
    }},
    { $match: { count: { $gt: 1 }, _id: { $ne: null } } }
  ]);
  
  let deleted = 0;
  
  for (const g of dupesByHash) {
    const tracks = await Promise.all(g.ids.map(id => Track.findById(id).lean()));
    // We will keep the one that has the most non-null fields
    
    let bestScore = -1;
    let keepId = null;
    
    for (const t of tracks) {
      let score = 0;
      if (t.bpm > 0) score += 2;
      if (t.energy > 0) score += 2;
      if (t.genre) score += 1;
      if (t.phase) score += 3; // very important
      if (t.isBanger || t.isFiller) score += 2;
      if (t.providers?.deezer?.trackId) score += 2;
      
      if (score > bestScore) {
        bestScore = score;
        keepId = t._id;
      }
    }
    
    // Safety fallback
    if (!keepId) keepId = tracks[0]._id;
    
    const keeper = tracks.find(t => t._id.equals(keepId));
    const toDelete = tracks.filter(t => !t._id.equals(keepId));
    
    // Merge important fields to keeper
    const mergedFields = {};
    for (const d of toDelete) {
      if (!keeper.phase && d.phase) mergedFields.phase = d.phase;
      if (!keeper.isBanger && d.isBanger) mergedFields.isBanger = true;
      if (!keeper.isFiller && d.isFiller) mergedFields.isFiller = true;
      if (!keeper.bpm && d.bpm) mergedFields.bpm = d.bpm;
      if (!keeper.energy && d.energy) mergedFields.energy = d.energy;
    }
    
    if (Object.keys(mergedFields).length > 0) {
      await Track.findByIdAndUpdate(keepId, { $set: mergedFields });
      console.log(`[Merge] Updated keeper ${keeper.title} with`, mergedFields);
    }
    
    // Delete dupes
    for (const d of toDelete) {
      await Track.findByIdAndDelete(d._id);
      console.log(`🗑️ Deleted: "${d.title}" (${d._id})`);
      deleted++;
    }
    console.log(`✅ Kept: "${keeper.title}" (${keeper._id}) [Score: ${bestScore}]`);
    console.log('---');
  }
  
  console.log(`🎉 Finished manual dedup. Removed ${deleted} tracks.`);
  process.exit(0);
}
run().catch(console.error);
