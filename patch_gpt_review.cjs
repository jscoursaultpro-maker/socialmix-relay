const fs = require('fs');

// 1. Update HTML
let html = fs.readFileSync('admin/monitor.html', 'utf8');
html = html.replace(
  '<label><input type="checkbox" id="f-no-gpt" onchange="applyFilter()" /> Non-analysé par GPT</label>',
  '<label><input type="checkbox" id="f-no-gpt" onchange="applyFilter()" /> Non-analysé par GPT</label>\n        <label><input type="checkbox" id="f-gpt-review" onchange="applyFilter()" /> À vérifier (Suggestion IA reçue)</label>'
);
fs.writeFileSync('admin/monitor.html', html);

// 2. Update JS
let js = fs.readFileSync('admin/monitor.js', 'utf8');
js = js.replace(
  "if (document.getElementById('f-no-gpt')?.checked) {",
  "if (document.getElementById('f-gpt-review')?.checked) {\n      params.set('filter', 'needs_review');\n    } else if (document.getElementById('f-no-gpt')?.checked) {"
);
fs.writeFileSync('admin/monitor.js', js);

console.log('patched gpt review filter');
