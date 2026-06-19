const { execSync } = require('child_process');
try {
  const out = execSync('node --env-file=.env scripts/rollback_gpt_corrupt.mjs --dry-run').toString();
  console.log(out);
} catch(e) { console.log(e.toString()); }
