const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');
server = server.replace(
  "if (filter === 'needs_review') query.needs_review = true;",
  "if (filter === 'needs_review') { query.isLabeled = { $ne: true }; query.gptSuggestion = { $ne: null }; }"
);
fs.writeFileSync('server.js', server);

console.log('patched needs_review filter query');
