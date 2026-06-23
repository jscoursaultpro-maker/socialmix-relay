import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import Party from '../models/Party.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const DRY_RUN = process.argv.includes('--dry-run');

async function migratePhotos() {
  console.log(`🚀 Starting Migration ${DRY_RUN ? '(DRY RUN)' : ''}`);
  const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://jscoursaultpro_db_user:********@cluster0.drictlo.mongodb.net/socialmix?retryWrites=true&w=majority&appName=Cluster0";
  
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected');

  const parties = await Party.find({ 'photos.base64': { $exists: true } });
  // Also check for photos.dataURL if base64 was renamed
  const partiesDataURL = await Party.find({ 'photos.dataURL': { $exists: true } });
  
  const allParties = [...new Set([...parties, ...partiesDataURL])];
  console.log(`Found ${allParties.length} parties with legacy base64/dataURL photos.`);

  let totalMigrated = 0;
  let totalErrors = 0;

  for (const party of allParties) {
    let partyModified = false;
    console.log(`\n📦 Processing Party: ${party.code} (${party.photos.length} photos)`);

    for (let i = 0; i < party.photos.length; i++) {
      const photo = party.photos[i];
      const base64Data = photo.base64 || photo.dataURL;

      if (base64Data && base64Data.startsWith('data:image')) {
        console.log(`  📸 Migrating photo ${i + 1}/${party.photos.length} for ${photo.guestName}...`);
        
        if (!DRY_RUN) {
          try {
            const folder = `${process.env.CLOUDINARY_UPLOAD_FOLDER}/${party.code}`;
            const result = await cloudinary.uploader.upload(base64Data, {
              folder,
              resource_type: 'image',
              transformation: [
                { width: 1080, height: 1080, crop: 'limit' },
                { quality: 'auto:good' },
                { format: 'auto' }
              ]
            });

            // Update photo object
            photo.url = result.secure_url;
            photo.publicId = result.public_id;
            photo.width = result.width;
            photo.height = result.height;
            
            // Remove legacy fields
            photo.base64 = undefined;
            photo.dataURL = undefined;
            
            partyModified = true;
            totalMigrated++;
            console.log(`    ✅ Success: ${photo.url}`);
          } catch (err) {
            console.error(`    ❌ Failed to upload photo ${i + 1}:`, err.message);
            totalErrors++;
          }
        } else {
          console.log(`    [DRY RUN] Would upload photo length: ${Math.round(base64Data.length/1024)} KB`);
          totalMigrated++;
        }
      }
    }

    if (partyModified && !DRY_RUN) {
      await party.save();
      console.log(`💾 Saved party ${party.code} to DB.`);
    }
  }

  console.log(`\n🎉 Migration complete.`);
  console.log(`Total photos migrated: ${totalMigrated}`);
  console.log(`Total errors: ${totalErrors}`);

  await mongoose.disconnect();
  process.exit(0);
}

migratePhotos().catch(console.error);
