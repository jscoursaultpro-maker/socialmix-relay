const fs = require('fs');

// 1. STYLE.CSS
const cssPath = '../relay-server/public/style.css';
let css = fs.readFileSync(cssPath, 'utf8');

const newCSS = `
/* App Store CTA */
.cta-appstore {
  margin-top: 16px;
  padding: 20px;
  background: linear-gradient(135deg, rgba(0,210,255,0.1), rgba(0,200,83,0.1));
  border: 1px solid rgba(0,210,255,0.2);
  border-radius: 16px;
  width: 100%;
  max-width: 340px;
  text-align: center;
}
.cta-appstore p {
  color: white;
  font-size: 13px;
  font-weight: 800;
  margin-bottom: 12px;
}
.cta-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  background: linear-gradient(135deg, #00d2ff, #00bfa5);
  border: none;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 800;
  color: #0a0e1a;
  text-decoration: none;
  width: 100%;
  box-sizing: border-box;
}
`;
if (!css.includes('.cta-appstore')) {
    fs.appendFileSync(cssPath, newCSS, 'utf8');
}

// 2. APP.JS
const appPath = '../relay-server/public/app.js';
let app = fs.readFileSync(appPath, 'utf8');

const targetBlock = `        <div style="margin-top:16px;padding:14px 20px;background:linear-gradient(135deg,rgba(0,210,255,0.08),rgba(138,43,226,0.06));border:1px solid rgba(0,210,255,0.15);border-radius:12px;width:100%;max-width:300px;text-align:center;">
          <div style="font-size:20px;margin-bottom:4px;">📱</div>
          <div style="font-size:11px;font-weight:800;color:white;margin-bottom:2px;">TÉLÉCHARGE L'APP</div>
          <div style="font-size:9px;color:var(--text-dim);margin-bottom:8px;">Garde un accès à tes soirées Social Mix</div>
          <button onclick="alert('Bientôt disponible sur l\\'App Store ! 🎧')" style="padding:8px 20px;background:linear-gradient(135deg,#00d2ff,#8a2be2);border:none;border-radius:10px;font-size:11px;font-weight:800;color:white;cursor:pointer;">🍎 DISPONIBLE BIENTÔT</button>
        </div>`;

const replaceBlock = `        <div class="cta-appstore">
          <p>Toi aussi anime ta soirée avec SocialMix</p>
          <a href="https://apps.apple.com/app/socialmix" target="_blank" class="cta-button">
            🍎 Télécharger sur l'App Store
          </a>
        </div>`;

app = app.replace(targetBlock, replaceBlock);
fs.writeFileSync(appPath, app, 'utf8');

