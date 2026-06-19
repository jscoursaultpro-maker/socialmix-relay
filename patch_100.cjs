const fs = require('fs');

let html = fs.readFileSync('admin/monitor.html', 'utf8');

html = html.replace(
  '<option value="50" selected>50</option>',
  '<option value="50">50</option>\n          <option value="100" selected>100</option>'
);

fs.writeFileSync('admin/monitor.html', html);
console.log('patched 100');
