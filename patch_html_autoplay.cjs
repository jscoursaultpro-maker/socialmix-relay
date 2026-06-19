const fs = require('fs');

let html = fs.readFileSync('admin/monitor.html', 'utf8');

html = html.replace(
  '<div class="shortcuts" style="margin-top: 20px;">',
  `<div style="margin-top: 20px; padding: 10px; background: rgba(0, 0, 0, 0.2); border-radius: 6px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color: #aaa;">
          <input type="checkbox" id="f-autoplay" checked /> 🎶 Auto-play au passage au titre suivant
        </label>
      </div>\n      <div class="shortcuts" style="margin-top: 20px;">`
);

fs.writeFileSync('admin/monitor.html', html);
console.log('patched html autoplay');
