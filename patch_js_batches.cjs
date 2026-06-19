const fs = require('fs');
let js = fs.readFileSync('admin/monitor.js', 'utf8');

js = js.replace(
  "setInterval(updateStats, 15000);",
  "setInterval(updateStats, 15000);\n  setInterval(updateBatchStatus, 5000);\n  updateBatchStatus();"
);

js += `
async function updateBatchStatus() {
  if (!adminToken) return;
  try {
    const res = await api('GET', '/api/monitor/batch-status');
    const badge = document.getElementById('batch-status-badge');
    if (badge) {
      badge.textContent = \`📁 Batches : \${res.done}/\${res.total} done | \${res.in} en attente (Rejetés: \${res.rejected})\`;
    }
  } catch(e) { console.error('batch-status error', e); }
}
`;

fs.writeFileSync('admin/monitor.js', js);
console.log('patched js batches');
