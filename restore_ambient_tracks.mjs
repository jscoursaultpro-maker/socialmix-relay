import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_PATH = path.join(__dirname, '../SocialMix V1.csv');
const DB_PATH = path.join(__dirname, './curated_base_v3.json');

function parseTime(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    if (parts.length === 2) {
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }
    return 0;
}

function parseCSVLine(line) {
    // Simple CSV parser for quoted strings
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && line[i+1] === '"') {
            current += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

async function main() {
    console.log('🎵 Restoring Ambient tracks from CSV...\n');

    // 1. Read curated base v3
    const dbData = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    const tracks = dbData.tracks;
    
    // Create a map of existing deezerIDs
    const existingIds = new Set(tracks.map(t => t.deezerID).filter(id => id > 0));

    // 2. Read CSV
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const lines = csvContent.split('\n');
    
    let restoredCount = 0;
    let newTracks = [];

    for (let i = 1; i < lines.length; i++) { // Skip header
        const line = lines[i].trim();
        if (!line) continue;
        
        const cols = parseCSVLine(line);
        if (cols.length < 12) continue;
        
        const artist = cols[2] || cols[0];
        const title = cols[1];
        const genre = cols[6];
        const timeStr = cols[7];
        const bpmStr = cols[8];
        const filename = cols[11]; // e.g. dz3699147092
        
        if (genre !== 'Ambient') continue;
        
        let deezerID = 0;
        if (filename && filename.startsWith('dz')) {
            deezerID = parseInt(filename.substring(2), 10);
        }
        
        if (deezerID > 0) {
            // Check if already in DB
            if (!existingIds.has(deezerID)) {
                // Determine phase based on BPM
                const bpm = parseFloat(bpmStr) || 0;
                let phase = 'unclassified';
                if (bpm > 0) {
                    if (bpm >= 80 && bpm <= 110) phase = 'closing';
                    else if (bpm > 110 && bpm <= 122) phase = 'arrival';
                    else if (bpm > 122 && bpm <= 128) phase = 'ambiance';
                    else if (bpm > 128) phase = 'groove';
                }

                newTracks.push({
                    deezerID: deezerID,
                    genre: 'Ambient',
                    title: title,
                    artist: artist,
                    bpm: bpm,
                    energy: 0,
                    duration: parseTime(timeStr),
                    source: 'csv_ambient_restored',
                    phase: phase,
                    rank: 0
                });
                restoredCount++;
                existingIds.add(deezerID);
                console.log(`✅ Restored: ${artist} - ${title} (dz${deezerID}, ${bpm} BPM -> ${phase})`);
            } else {
                // If it already exists, maybe its genre was changed to Chill or House?
                // Let's force update the genre to Ambient if it exists but is not Ambient.
                const existingTrack = tracks.find(t => t.deezerID === deezerID);
                if (existingTrack && existingTrack.genre !== 'Ambient') {
                    console.log(`⚠️  Updating existing track: ${artist} - ${title} (was ${existingTrack.genre}, now Ambient)`);
                    existingTrack.genre = 'Ambient';
                    restoredCount++;
                }
            }
        }
    }

    // 3. Merge and update stats
    if (newTracks.length > 0) {
        dbData.tracks = [...tracks, ...newTracks];
    }
    
    // Sort tracks by genre, then artist
    dbData.tracks.sort((a, b) => {
        if (a.genre !== b.genre) return (a.genre || '').localeCompare(b.genre || '');
        return (a.artist || '').localeCompare(b.artist || '');
    });

    // Recompute stats
    const stats = {
        total: dbData.tracks.length,
        withDeezerID: dbData.tracks.filter(t => t.deezerID > 0).length,
        withBPM: dbData.tracks.filter(t => t.bpm > 0).length,
        withEnergy: dbData.tracks.filter(t => t.energy > 0).length,
        byGenre: {}
    };
    
    dbData.tracks.forEach(t => {
        const g = t.genre || 'Unknown';
        stats.byGenre[g] = (stats.byGenre[g] || 0) + 1;
    });
    dbData.stats = stats;
    dbData.generatedAt = new Date().toISOString();

    // 4. Save
    fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2));
    
    console.log(`\n🎉 Done! Restored/Updated ${restoredCount} Ambient tracks.`);
    console.log(`Total tracks in DB: ${stats.total}`);
    console.log(`Ambient tracks in DB: ${stats.byGenre['Ambient']}`);
}

main().catch(console.error);
