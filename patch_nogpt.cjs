const fs = require('fs');

// 1. Update HTML
let html = fs.readFileSync('admin/monitor.html', 'utf8');
html = html.replace(
  '<label><input type="checkbox" id="f-not-labeled" onchange="applyFilter()" checked /> isLabeled = false</label>',
  '<label><input type="checkbox" id="f-not-labeled" onchange="applyFilter()" checked /> isLabeled = false</label>\n        <label><input type="checkbox" id="f-no-gpt" onchange="applyFilter()" /> Non-analysé par GPT</label>'
);
fs.writeFileSync('admin/monitor.html', html);

// 2. Update JS
let js = fs.readFileSync('admin/monitor.js', 'utf8');
js = js.replace(
  "if (document.getElementById('f-not-labeled').checked) filterParts.push('filter=unlabeled');",
  "if (document.getElementById('f-not-labeled').checked) filterParts.push('filter=unlabeled');\n    if (document.getElementById('f-no-gpt')?.checked) filterParts.push('filter=no_gpt');"
);
js = js.replace(
  "params.set('filter', document.getElementById('f-not-labeled').checked ? 'unlabeled' : 'all');",
  "if (document.getElementById('f-no-gpt')?.checked) {\n      params.set('filter', 'no_gpt');\n    } else {\n      params.set('filter', document.getElementById('f-not-labeled').checked ? 'unlabeled' : 'all');\n    }"
);
fs.writeFileSync('admin/monitor.js', js);

// 3. Update server.js
let server = fs.readFileSync('server.js', 'utf8');
server = server.replace(
  "if (filter === 'unlabeled') query.isLabeled = { $ne: true };",
  "if (filter === 'unlabeled') query.isLabeled = { $ne: true };\n    if (filter === 'no_gpt') { query.isLabeled = { $ne: true }; query.gptSuggestion = null; }"
);
fs.writeFileSync('server.js', server);

console.log('patched no-gpt filter');
