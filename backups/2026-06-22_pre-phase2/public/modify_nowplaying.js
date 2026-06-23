const fs = require('fs');
const path = '/Users/Jean-Sebastien/App Workshop/Virtual DJ V3/relay-server/public/app.js';
let content = fs.readFileSync(path, 'utf8');

const target = `  $('np-genre').textContent = (track.genre || '—').toUpperCase();
  
  // Album artwork (from Shazam)`;

const replacement = `  $('np-genre').textContent = (track.genre || '—').toUpperCase();
  
  // ★ NEW: Suggester Badge
  const suggesterEl = $('np-suggester');
  const suggesterName = $('np-suggester-name');
  const suggesterIcon = $('np-suggester-icon');
  const suggesterText = $('np-suggester-text');
  
  if (suggesterEl && suggesterName && suggesterIcon && suggesterText) {
    if (track.suggestedBy) {
      suggesterEl.style.display = 'inline-flex';
      suggesterName.textContent = track.suggestedBy;
      suggesterIcon.textContent = '✨';
      suggesterText.textContent = 'Mis le feu par';
    } else if (state.mode === 'appMix') { // appMix = Jukebox mode
      suggesterEl.style.display = 'inline-flex';
      suggesterName.textContent = 'DJ Brain';
      suggesterIcon.textContent = '🤖';
      suggesterText.textContent = 'Mixé par le';
    } else {
      // In DJ Live mode, don't show DJ Brain
      suggesterEl.style.display = 'none';
    }
  }

  // Album artwork (from Shazam)`;

content = content.replace(target, replacement);
fs.writeFileSync(path, content, 'utf8');
