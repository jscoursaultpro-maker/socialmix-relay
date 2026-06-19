const fs = require("fs");
let content = fs.readFileSync("server.js", "utf8");

const old1 = `    const firstReviewedToday = await Track.findOne({ lastReviewedAt: { $gte: startOfDay } }).sort({ lastReviewedAt: 1 }).lean();
    let speedPerMin = 0;
    const sessionClassified = await Track.countDocuments({ lastReviewedAt: { $gte: startOfDay } });
    if (firstReviewedToday && sessionClassified > 0) {
      const minSinceStart = Math.max(1, Math.round((new Date() - firstReviewedToday.lastReviewedAt) / 60000));
      // Just a naive speed over the whole day.
      // If it's a new burst, it might be off, but it gives a rough idea
      speedPerMin = Math.round(sessionClassified / minSinceStart);
    }
    
    // Fallback to a better naive speed if speed is 0 but we have todayComplete
    if (speedPerMin === 0 && globalSessionStats.todayComplete > 0) {
      speedPerMin = 2; // Arbitrary fallback to avoid division by zero later
    }
    
    const remaining = (byQuality.vide || 0) + (byQuality.partielle || 0);
    const etaMinutes = speedPerMin > 0 ? Math.round(remaining / speedPerMin) : 0;

    res.json({
      total,
      byQuality,
      today: {
        complete: globalSessionStats.todayComplete,
        platine: globalSessionStats.todayPlatine
      },`;

const new1 = `    const firstReviewedToday = await Track.findOne({ lastReviewedAt: { $gte: startOfDay } }).sort({ lastReviewedAt: 1 }).lean();
    let speedPerMin = 0;
    const sessionClassified = await Track.countDocuments({ lastReviewedAt: { $gte: startOfDay } });
    
    const todayComplete = await Track.countDocuments({ lastReviewedAt: { $gte: startOfDay }, qualityLevel: 'complete' });
    const todayPlatine = await Track.countDocuments({ lastReviewedAt: { $gte: startOfDay }, qualityLevel: 'platine' });
    
    if (firstReviewedToday && sessionClassified > 0) {
      const minSinceStart = Math.max(1, Math.round((new Date() - firstReviewedToday.lastReviewedAt) / 60000));
      speedPerMin = Math.round(sessionClassified / minSinceStart);
    }
    
    if (speedPerMin === 0 && (todayComplete + todayPlatine) > 0) {
      speedPerMin = 2;
    }
    
    const remaining = (byQuality.vide || 0) + (byQuality.partielle || 0);
    const etaMinutes = speedPerMin > 0 ? Math.round(remaining / speedPerMin) : 0;

    res.json({
      total,
      byQuality,
      today: {
        complete: todayComplete,
        platine: todayPlatine
      },`;

content = content.replace(old1, new1);
fs.writeFileSync("server.js", content);
console.log("Patched stats successfully.");
