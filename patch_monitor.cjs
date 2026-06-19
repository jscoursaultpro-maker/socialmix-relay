const fs = require('fs');
let code = fs.readFileSync('admin/monitor.js', 'utf8');
code = code.replace(/document\.getElementById\('f-not-labeled'\)\.checked \? 'needs_review' : 'all'/g, "document.getElementById('f-not-labeled').checked ? 'unlabeled' : 'all'");
fs.writeFileSync('admin/monitor.js', code);
console.log('patched monitor.js filter');
