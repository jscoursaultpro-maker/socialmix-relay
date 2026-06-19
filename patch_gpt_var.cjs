const fs = require('fs');

let js = fs.readFileSync('admin/monitor.js', 'utf8');
js = js.replace(
  "const gpt = t.gptSuggestion || {};",
  "const gpt = t.gpt_suggestion || t.gptSuggestion || {};"
);
fs.writeFileSync('admin/monitor.js', js);

console.log('patched gpt_suggestion mapping');
