const fs = require('fs');
let js = fs.readFileSync('admin/monitor.js', 'utf8');
js = js.replace(
  "tracks = data.tracks || [];",
  "tracks = data.tracks || [];\n    document.getElementById('track-total-db').textContent = data.total || 0;"
);
fs.writeFileSync('admin/monitor.js', js);

let html = fs.readFileSync('admin/monitor.html', 'utf8');
html = html.replace(
  '<div class="track-progress">TRACK <span id="track-current">1</span> / <span id="track-total">25</span></div>',
  '<div class="track-progress">TRACK <span id="track-current">1</span> / <span id="track-total">25</span> (sur <span id="track-total-db">?</span> au total)</div>'
);
fs.writeFileSync('admin/monitor.html', html);
console.log('patched total');
