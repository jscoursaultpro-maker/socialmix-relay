const fs = require('fs');

let html = fs.readFileSync('admin/monitor.html', 'utf8');

html = html.replace(
  '<div class="shortcut"><kbd>E</kbd> Toggle Emotional</div>',
  '<div class="shortcut"><kbd>E</kbd> Toggle Emotional</div>\n        <div class="shortcut"><kbd>X</kbd> Toggle Hardcore</div>'
);

fs.writeFileSync('admin/monitor.html', html);
console.log('patched html');
