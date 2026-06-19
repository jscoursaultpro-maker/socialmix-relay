const fs = require('fs');

let js = fs.readFileSync('admin/monitor.js', 'utf8');

js = js.replace(
  "const cleanStr = jsonStr.replace(/```(?:json)?/gi, '').trim();",
  `let cleanStr = jsonStr.replace(/\\r/g, '').trim();
    // Extract array if there's text around it
    const startIdx = cleanStr.indexOf('[');
    const endIdx = cleanStr.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      cleanStr = cleanStr.substring(startIdx, endIdx + 1);
    }
    // Also remove markdown if any remains
    cleanStr = cleanStr.replace(/\`\`\`(?:json)?/gi, '').trim();`
);

fs.writeFileSync('admin/monitor.js', js);
console.log('patched json extract');
