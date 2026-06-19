const fs = require('fs');
let html = fs.readFileSync('admin/monitor.html', 'utf8');

html = html.replace(
  '<div class="stat-badge">🤖 ChatGPT queue : <span id="track-chatgpt">0</span></div>',
  '<div class="stat-badge">🤖 ChatGPT queue : <span id="track-chatgpt">0</span></div>\n    <div class="stat-badge" style="background: rgba(255, 100, 100, 0.2);" id="batch-status-badge">📁 Batches : 0/40 done | 40 en attente</div>'
);

fs.writeFileSync('admin/monitor.html', html);
console.log('patched html batches');
