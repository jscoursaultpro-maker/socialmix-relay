const fs = require('fs');

let js = fs.readFileSync('admin/monitor.js', 'utf8');

js = js.replace(
  "if (!Array.isArray(arr)) {",
  "if (arr && arr.tracks && Array.isArray(arr.tracks)) {\n      arr = arr.tracks;\n    }\n    if (!Array.isArray(arr)) {"
);

fs.writeFileSync('admin/monitor.js', js);
console.log('patched json wrapper');
