import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to wait 200ms between requests
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const inputCsvPath = process.argv[2] || path.join(__dirname, '..', 'bogus_artists.csv');
  const outputCsvPath = path.join(__dirname, '..', 'bogus_artists_enriched.csv');

  if (!fs.existsSync(inputCsvPath)) {
    console.error(`❌ Input file not found: ${inputCsvPath}`);
    process.exit(1);
  }

  console.log(`📥 Reading from: ${inputCsvPath}`);
  const csvData = fs.readFileSync(inputCsvPath, 'utf8').trim().split('\n');
  
  if (csvData.length < 2) {
    console.log("No data found in CSV.");
    return;
  }

  // Parse CSV (simple parsing handling simple quotes)
  const headers = csvData[0].split(',').map(h => h.trim());
  const tracks = csvData.slice(1).map(row => {
    // Regex to split by comma, ignoring commas inside quotes
    const matches = row.match(/(?:\"([^\"]*)\")|([^\,]+)/g) || [];
    return matches.map(m => {
        if (m.startsWith('"') && m.endsWith('"')) {
            return m.slice(1, -1).replace(/""/g, '"');
        }
        return m.trim() === ',' ? '' : m.trim(); // Handle empty commas as empty strings roughly
    });
  });

  const enrichedCsvLines = ["ID,Title,Artist,ISRC,ProviderId,Suggested_Artist,Suggested_Title,Suggested_Album,Confidence_Score,PreviewURL"];
  
  let resolvedCount = 0;
  let uncertainCount = 0;
  let unresolvedCount = 0;

  for (let i = 0; i < tracks.length; i++) {
    // The previous script wrote: ID, Title, Artist, ISRC, ProviderId
    const row = csvData[i + 1];
    // A robust but simple split. Since we are just appending, we can actually parse properly or just append to the raw line if we know ISRC index
    // Wait, the regex above might be slightly off. Let's just do a simpler split for reading ISRC since we just need the 4th column.
    // Actually, ISRC is the 4th column.
    let isrcMatch = row.match(/,([^,]+),[^,]*$/);
    let isrc = "";
    if (headers[3] === "ISRC") {
        // Let's use a better parsing approach for ISRC (2nd to last column usually, but let's be careful with quotes)
        const parts = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        isrc = parts[3] || "";
    }

    if (!isrc) {
      enrichedCsvLines.push(`${row},"","",0,""`);
      unresolvedCount++;
      continue;
    }

    try {
      const response = await fetch(`https://itunes.apple.com/lookup?isrc=${isrc}&country=FR`);
      const data = await response.json();

      let suggestedArtist = "";
      let suggestedTitle = "";
      let suggestedAlbum = "";
      let confidenceScore = 0;
      let previewUrl = "";

      if (data.resultCount === 1) {
        const item = data.results[0];
        suggestedArtist = item.artistName || "";
        suggestedTitle = item.trackName || "";
        suggestedAlbum = item.collectionName || "";
        previewUrl = item.previewUrl || "";
        confidenceScore = 100;
      } else if (data.resultCount > 1) {
        const item = data.results[0];
        suggestedArtist = item.artistName || "";
        suggestedTitle = item.trackName || "";
        suggestedAlbum = item.collectionName || "";
        previewUrl = item.previewUrl || "";
        confidenceScore = 80; // multiple results, taking first but confident in artist
      } else {
        confidenceScore = 0;
      }

      if (confidenceScore >= 80) resolvedCount++;
      else if (confidenceScore >= 50) uncertainCount++;
      else unresolvedCount++;

      const escapedArtist = `"${suggestedArtist.replace(/"/g, '""')}"`;
      const escapedTitle = `"${suggestedTitle.replace(/"/g, '""')}"`;
      const escapedAlbum = `"${suggestedAlbum.replace(/"/g, '""')}"`;
      
      enrichedCsvLines.push(`${row},${escapedArtist},${escapedTitle},${escapedAlbum},${confidenceScore},"${previewUrl}"`);

    } catch (err) {
      console.error(`Error querying ISRC ${isrc}:`, err.message);
      enrichedCsvLines.push(`${row},"","",0,""`);
      unresolvedCount++;
    }

    // Rate limiting
    await delay(200);
  }

  fs.writeFileSync(outputCsvPath, enrichedCsvLines.join('\n'), 'utf8');
  console.log(`\n✅ Enrichment complete: ${outputCsvPath}`);
  console.log(`📊 Summary:`);
  console.log(`  - Total tracks scanned: ${tracks.length}`);
  console.log(`  - Tracks résolus (confidence >= 80): ${resolvedCount}/${tracks.length}`);
  console.log(`  - Tracks incertains (confidence 50-79): ${uncertainCount}/${tracks.length}`);
  console.log(`  - Tracks non résolus (confidence < 50): ${unresolvedCount}/${tracks.length}`);
}

run();
