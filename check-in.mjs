import mongoose from 'mongoose';
import fs from 'fs';
import Track from './models/Track.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const md = fs.readFileSync('../SIMULATION_7H_CURRENT.md', 'utf8');
  
  const lines = md.split('\n').filter(l => l.startsWith('|') && !l.includes('Time | Genre') && !l.includes('---|---'));
  
  let inCount = 0;
  let totalCount = lines.length;
  
  for (const line of lines) {
    // format: | 0:00 | Pop | 0 | 3 | ✅ | Heart of Gold - Neil Young |
    const parts = line.split('|');
    if (parts.length < 7) continue;
    let rawTitle = parts[6].trim();
    // Splitting by ' - ' to get title and artist
    const titleParts = rawTitle.split(' - ');
    const searchTitle = titleParts[0].trim();
    
    // Find track in DB by exact title (since it came from DB)
    // Could have duplicates but we just check if any match is a banger
    const t = await Track.findOne({ title: searchTitle }).lean();
    if (t && t.isBanger) {
      inCount++;
    }
  }
  
  console.log(`Sur les ${totalCount} chansons jouées, il y a eu ${inCount} titres "IN" (Bangers).`);
  process.exit(0);
}
run().catch(console.error);
