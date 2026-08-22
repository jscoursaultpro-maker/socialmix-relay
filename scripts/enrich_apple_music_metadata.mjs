import jwt from 'jsonwebtoken';
import fs from 'fs';
import mongoose from 'mongoose';

const DRY_RUN = process.env.DRY_RUN !== '0' && process.env.LIVE !== '1';
const LIMIT = parseInt(process.env.LIMIT) || 30;

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l.match(/^[A-Z]/) && l.includes('='))
    .map(l => {
      const i = l.indexOf('=');
      return [l.substring(0, i).trim(), l.substring(i + 1).replace(/^"|"$/g, '').trim()];
    })
);

(async () => {
  try {
    const privateKey = fs.readFileSync(env.APPLE_MUSIC_PRIVATE_KEY_PATH, 'utf8');

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign({}, privateKey, {
      algorithm: 'ES256',
      expiresIn: '4h',
      issuer: env.APPLE_MUSIC_TEAM_ID,
      header: { alg: 'ES256', kid: env.APPLE_MUSIC_KEY_ID }
    });

    await mongoose.connect(env.MONGO_URI || env.MONGODB_URI);
    const Track = mongoose.model('Track', new mongoose.Schema({}, { strict: false }));

    const query = {
      qualityLevel: { $nin: ['complete', 'platine'] },
      isVerified: { $ne: true },
      suggestable: { $ne: false },
      isrc: { $exists: true, $ne: null, $ne: '' },
      'appleMusicMetadata.genreNames': { $exists: false }
    };

    const tracks = await Track.find(query).sort({ deezerRank: -1 }).limit(LIMIT).lean();
    console.log(`=== ENRICH APPLE MUSIC METADATA (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ===`);
    console.log(`Found ${tracks.length} tracks to enrich.`);

    // Chunk by 5
    const chunkSize = 5;
    for (let i = 0; i < tracks.length; i += chunkSize) {
      const batch = tracks.slice(i, i + chunkSize);
      const isrcs = batch.map(t => t.isrc).join(',');
      
      console.log(`\nProcessing batch ${Math.floor(i / chunkSize) + 1} (${batch.length} tracks)...`);
      
      const url = `https://api.music.apple.com/v1/catalog/us/songs?filter[isrc]=${encodeURIComponent(isrcs)}`;
      const resp = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'AhOuai/1.0'
        }
      });
      
      console.log(`  Apple Music API HTTP ${resp.status}`);
      
      if (resp.ok) {
        const data = await resp.json();
        const songs = data?.data || [];
        
        console.log(`  Found ${songs.length} entries matching ISRCs in this batch.`);
        
        for (const song of songs) {
          const trackIsrc = song.attributes?.isrc;
          const dbTrack = batch.find(t => t.isrc === trackIsrc);
          if (!dbTrack) continue; // Should not happen since we filtered by isrc
          
          // Remove from batch so we only process the first match for a given ISRC
          const idx = batch.findIndex(t => t.isrc === trackIsrc);
          if (idx !== -1) batch.splice(idx, 1);
          
          const artworkUrl = song.attributes?.artwork?.url?.replace('{w}x{h}', '640x640') || null;
          const genreNames = song.attributes?.genreNames || [];
          const releaseDate = song.attributes?.releaseDate || null;
          const durationInMillis = song.attributes?.durationInMillis || 0;
          
          if (DRY_RUN) {
            console.log(`  [DRY_RUN] Matched ${dbTrack.title}: genres=${genreNames.join(',')}, release=${releaseDate}, duration=${durationInMillis}`);
          } else {
            await Track.updateOne({ _id: dbTrack._id }, {
              $set: {
                'providers.appleMusic.trackId': song.id,
                'appleMusicMetadata.genreNames': genreNames,
                'appleMusicMetadata.releaseDate': releaseDate,
                'appleMusicMetadata.previewUrl': song.attributes?.previews?.[0]?.url || null,
                'appleMusicMetadata.artworkUrl': artworkUrl,
                'appleMusicMetadata.durationInMillis': durationInMillis
              }
            });
            console.log(`  [LIVE] Updated ${dbTrack.title}`);
          }
        }
        
        if (batch.length > 0) {
            console.log(`  [WARN] ${batch.length} tracks in batch not found on Apple Music:`, batch.map(t => t.title).join(', '));
            if (!DRY_RUN) {
                // Mark them as checked but not found by setting empty genreNames so they are skipped next time
                for (const notFound of batch) {
                    await Track.updateOne({ _id: notFound._id }, {
                        $set: { 'appleMusicMetadata.genreNames': [] }
                    });
                }
            }
        }
      } else {
        const err = await resp.text();
        console.error(`  Error from Apple Music: ${err.substring(0, 200)}`);
      }
      
      if (i + chunkSize < tracks.length) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    
    console.log('\nFinished processing.');
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
})();
