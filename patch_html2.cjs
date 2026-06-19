const fs = require('fs');
let html = fs.readFileSync('admin/monitor.html', 'utf8');

html = html.replace('GÉNÉRER LISTE', 'APPLIQUER FILTRES');
html = html.replace('📋 EXPORTER PROMPT', '📋 GÉNÉRER PROMPT IA');

fs.writeFileSync('admin/monitor.html', html);
console.log('patched monitor html buttons');
