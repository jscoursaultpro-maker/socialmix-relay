const fs = require('fs');
const path = '/Users/Jean-Sebastien/App Workshop/Virtual DJ V3/relay-server/public/index.html';
let content = fs.readFileSync(path, 'utf8');

const target = `                <div class="np-artist" id="np-artist">—</div>
                <div class="np-meta">`;

const replacement = `                <div class="np-artist" id="np-artist">—</div>
                <div id="np-suggester" style="display:none; margin-top: 6px; padding: 4px 10px; background: rgba(0, 210, 255, 0.1); border: 1px solid rgba(0, 210, 255, 0.2); border-radius: 12px; font-size: 11px; color: #00d2ff; font-weight: 600; align-items: center; gap: 4px; width: fit-content;">
                    <span id="np-suggester-icon" style="font-size: 12px;">✨</span> <span id="np-suggester-text">Mis le feu par</span> <span id="np-suggester-name" style="font-weight: 800;"></span>
                </div>
                <div class="np-meta">`;

content = content.replace(target, replacement);
fs.writeFileSync(path, content, 'utf8');
