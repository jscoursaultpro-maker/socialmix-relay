const mongoose = require('mongoose');

const phasesOrder = ['arrival', 'ambiance', 'takeoff', 'groove', 'party', 'closing'];

async function run() {
  await mongoose.connect('mongodb+srv://jscoursaultpro_db_user:mylena22PRO@cluster0.drictlo.mongodb.net/socialmix?retryWrites=true&w=majority&appName=Cluster0');
  const Track = mongoose.model('Track', new mongoose.Schema({}, { strict: false }));

  const filterGroup1 = { source: "batch_workflow", classifiedBy: "claude-sonnet-4-6-batch" };
  const filterGroup2 = { isLabeled: true, source: { $ne: "batch_workflow" } };
  const filterGroup3 = { isLabeled: true };

  async function getStats(filter, groupName) {
    const tracks = await Track.find(filter, { phase: 1, energy: 1, bpm: 1 }).lean();
    console.log(`\n## ${groupName} (${tracks.length} tracks)`);
    console.log(`| Phase | Nb | Energy moy | BPM moy | E1-2 | E3-4 | E5-6 | E7-8 | E9-10 |`);
    console.log(`|-------|----|----|---|------|------|------|------|-------|`);

    const stats = {};
    for (const p of phasesOrder) {
      stats[p] = { count: 0, energySum: 0, energyCount: 0, bpmSum: 0, bpmCount: 0, e12: 0, e34: 0, e56: 0, e78: 0, e910: 0 };
    }
    
    for (const t of tracks) {
      let p = t.phase;
      if (p === 'arrivée') p = 'arrival';
      if (p === 'peak') p = 'party'; 
      if (!p || !phasesOrder.includes(p)) {
        if (p === 'peak') p = 'party'; else continue; 
      }
      
      stats[p].count++;
      
      const e = parseFloat(t.energy) || 0;
      if (e > 0) {
        stats[p].energySum += e;
        stats[p].energyCount++;
        
        if (e >= 1 && e < 3) stats[p].e12++;
        else if (e >= 3 && e < 5) stats[p].e34++;
        else if (e >= 5 && e < 7) stats[p].e56++;
        else if (e >= 7 && e < 9) stats[p].e78++;
        else if (e >= 9 && e <= 10) stats[p].e910++;
      }
      
      const b = parseFloat(t.bpm) || 0;
      if (b > 0) {
        stats[p].bpmSum += b;
        stats[p].bpmCount++;
      }
    }

    for (const p of phasesOrder) {
      const s = stats[p];
      const eAvg = s.energyCount > 0 ? (s.energySum / s.energyCount).toFixed(1) : '0.0';
      const bAvg = s.bpmCount > 0 ? Math.round(s.bpmSum / s.bpmCount) : 0;
      
      console.log(`| ${p.padEnd(8)} | ${s.count} | ${eAvg} | ${bAvg} | ${s.e12} | ${s.e34} | ${s.e56} | ${s.e78} | ${s.e910} |`);
    }
  }

  await getStats(filterGroup1, 'GROUPE 1 — IN');
  await getStats(filterGroup2, 'GROUPE 2 — BACKLOG');
  await getStats(filterGroup3, 'GROUPE 3 — TOTAL');

  process.exit();
}

run().catch(console.error);
