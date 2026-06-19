import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Track from '../models/Track.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IOS_RESOURCES_DIR = path.join(__dirname, '../../SocialMixApp/SocialMixApp/Resources');
const BACKUPS_DIR = path.join(__dirname, '../backups');

const EDITORIAL_PATH = path.join(IOS_RESOURCES_DIR, 'editorial_seed.json');
const METADATA_PATH = path.join(IOS_RESOURCES_DIR, 'track_metadata.json');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

// Parse --rollback YYYY-MM-DD_HH-MM
const rollbackIndex = args.indexOf('--rollback');
const rollbackTarget = rollbackIndex !== -1 ? args[rollbackIndex + 1] : null;

async function run() {
  if (rollbackTarget) {
    return performRollback(rollbackTarget);
  }

  await mongoose.connect(process.env.MONGO_URI);
  
  // 1. EXPORT from MongoDB — only Platine + Complète
  console.log('[Sync] ⏳ Fetching tracks from MongoDB (Platine + Complète only)...');
  const allTracks = await Track.find({
    qualityLevel: { $in: ['platine', 'complete'] }
  }).lean();
  
  // Filter out tracks without deezerID
  const exportTracks = allTracks.filter(t => {
    const did = t.providers?.deezer?.trackId || t.deezerID;
    return did && did > 0;
  });
  
  console.log(`[Sync] 📊 Tracks fetched: ${exportTracks.length} (Platine + Complète with deezerID)`);

  // 2. VALIDATION
  if (exportTracks.length === 0) {
    console.error('[Sync] ❌ ABORT: No tracks to export.');
    process.exit(1);
  }
  
  const deezerIds = new Set();
  const uniqueTracks = [];
  for (const t of exportTracks) {
    const did = t.providers?.deezer?.trackId || t.deezerID;
    if (!t.title || !t.artist || !did) {
      console.error(`[Sync] ❌ ABORT: Track missing title, artist, or deezerID: ${JSON.stringify(t)}`);
      process.exit(1);
    }
    if (deezerIds.has(did)) {
      console.warn(`[Sync] ⚠️ WARNING: Duplicate deezerID found (${did}) for track ${t.title}. Skipping duplicate.`);
      continue;
    }
    deezerIds.add(did);
    uniqueTracks.push(t);
  }
  
  console.log(`[Sync] ✅ Validation passed. Deduplicated count: ${uniqueTracks.length}`);
  
  // Formatting tracks for JSON
  const formattedTracks = uniqueTracks.map(t => {
    // Keep exact mirroring, just ensure _id is removed or stringified
    const { _id, __v, ...rest } = t;
    
    // ★ Promote gptSuggestion UI categories to top level if missing
    // Some tracks have uiCategoryPrimary only in gptSuggestion (not yet promoted in MongoDB)
    if (!rest.uiCategoryPrimary && rest.gptSuggestion?.uiCategoryPrimary) {
      rest.uiCategoryPrimary = rest.gptSuggestion.uiCategoryPrimary;
    }
    if ((!rest.uiCategoriesSecondary || rest.uiCategoriesSecondary.length === 0) 
        && rest.gptSuggestion?.uiCategoriesSecondary?.length > 0) {
      rest.uiCategoriesSecondary = rest.gptSuggestion.uiCategoriesSecondary;
    }
    
    return rest;
  });
  
  const jsonExport = {
    _meta: {
      generated_at: new Date().toISOString(),
      source: "MongoDB Atlas SocialMix",
      track_count: formattedTracks.length,
      schema_version: "2.0"
    },
    tracks: formattedTracks
  };
  
  const jsonExportStr = JSON.stringify(jsonExport, null, 2);
  
  // In previous versions, track_metadata.json was a dictionary. Let's create it as a dict just in case iOS expects it.
  const metadataDict = {};
  for (const t of formattedTracks) {
    const key = `${t.title} - ${typeof t.artist === 'object' ? t.artist.name : t.artist}`;
    metadataDict[key] = t;
  }
  const jsonMetadataStr = JSON.stringify(metadataDict, null, 2);
  
  if (isDryRun) {
    console.log('[Sync] 🧪 DRY RUN: All checks passed. Not writing files.');
    await mongoose.disconnect();
    return;
  }
  
  // 3. BACKUP
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR);
  
  const now = new Date();
  const pad = n => n.toString().padStart(2, '0');
  const backupName = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const backupFolder = path.join(BACKUPS_DIR, backupName);
  
  fs.mkdirSync(backupFolder);
  
  if (fs.existsSync(EDITORIAL_PATH)) fs.copyFileSync(EDITORIAL_PATH, path.join(backupFolder, 'editorial_seed.json'));
  if (fs.existsSync(METADATA_PATH)) fs.copyFileSync(METADATA_PATH, path.join(backupFolder, 'track_metadata.json'));
  
  console.log(`[Sync] 💾 Backup created in backups/${backupName}`);
  
  // Rotate backups (keep 10)
  const backups = fs.readdirSync(BACKUPS_DIR).filter(f => fs.statSync(path.join(BACKUPS_DIR, f)).isDirectory()).sort();
  if (backups.length > 10) {
    const toDelete = backups.slice(0, backups.length - 10);
    for (const b of toDelete) {
      fs.rmSync(path.join(BACKUPS_DIR, b), { recursive: true, force: true });
    }
    console.log(`[Sync] 🧹 Deleted ${toDelete.length} old backups.`);
  }
  
  // 4. WRITE EXPORT
  fs.writeFileSync(EDITORIAL_PATH, jsonExportStr);
  // track_metadata.json must be a flat dictionary { "Title - Artist": { ...track } }
  // because iOS DJBrain.loadTrackKnowledge() expects [String: [String: Any]]
  fs.writeFileSync(METADATA_PATH, jsonMetadataStr);
  
  console.log(`[Sync] 🚀 Successfully synced iOS resources!`);
  await mongoose.disconnect();
}

function performRollback(target) {
  const backupFolder = path.join(BACKUPS_DIR, target);
  if (!fs.existsSync(backupFolder)) {
    console.error(`[Sync] ❌ ABORT: Backup folder ${target} not found.`);
    process.exit(1);
  }
  
  fs.copyFileSync(path.join(backupFolder, 'editorial_seed.json'), EDITORIAL_PATH);
  fs.copyFileSync(path.join(backupFolder, 'track_metadata.json'), METADATA_PATH);
  
  console.log(`[Sync] ⏪ Rollback to ${target} successful!`);
}

run().catch(console.error);
