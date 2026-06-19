const fs = require('fs');

let js = fs.readFileSync('admin/monitor.js', 'utf8');

// remove the erroneous line in loadTracks
js = js.replace(
  "tracks = data.tracks || [];\n    document.getElementById('track-total-db').textContent = data.total || 0;",
  "tracks = data.tracks || [];\n    window._lastDataTotal = data.total || 0;"
);

// insert the update inside selectTrack (near track-total)
js = js.replace(
  "document.getElementById('track-total').textContent = tracks.length;",
  "document.getElementById('track-total').textContent = tracks.length;\n  if (document.getElementById('track-total-db')) document.getElementById('track-total-db').textContent = window._lastDataTotal || 0;"
);

fs.writeFileSync('admin/monitor.js', js);
console.log('fixed monitor.js');
