const fs = require('fs');

// 1. Add modal HTML to monitor.html
let html = fs.readFileSync('admin/monitor.html', 'utf8');
const modalHTML = `
<!-- JSON Import Modal -->
<div class="modal-overlay" id="import-modal" style="display: none; z-index: 1000;">
  <div class="modal-content" style="max-width: 600px; width: 100%;">
    <h2>📥 IMPORTER JSON CHATGPT</h2>
    <p style="margin-bottom: 10px; color: var(--text-muted);">Colle ici l'intégralité du résultat JSON (ou le contenu du fichier .json) renvoyé par ChatGPT :</p>
    <textarea id="import-textarea" rows="15" style="width: 100%; border-radius: 6px; padding: 10px; font-family: monospace; font-size: 12px; background: #1a1a1a; color: #fff; border: 1px solid #333; margin-bottom: 15px;"></textarea>
    <div style="display: flex; gap: 10px; justify-content: flex-end;">
      <button class="btn btn-secondary" onclick="document.getElementById('import-modal').style.display='none'">Annuler</button>
      <button class="btn btn-primary" onclick="processImportGPT()">Valider l'import</button>
    </div>
  </div>
</div>
`;
html = html.replace('<!-- Stats Modal -->', modalHTML + '\n<!-- Stats Modal -->');
fs.writeFileSync('admin/monitor.html', html);

// 2. Modify monitor.js to use the modal
let js = fs.readFileSync('admin/monitor.js', 'utf8');

js = js.replace(
  `async function importGPT() {`,
  `function importGPT() {
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-modal').style.display = 'flex';
}

async function processImportGPT() {
  document.getElementById('import-modal').style.display = 'none';
  const jsonStr = document.getElementById('import-textarea').value;`
);

fs.writeFileSync('admin/monitor.js', js);
console.log('patched modal');
