// Only an explicit click may open AhOuai. Loading or dismissing stays on web.
(() => {
  if (location.pathname !== '/guest') return;
  const code = new URLSearchParams(location.search).get('code') || '';
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS || !/^[a-z0-9]{4,10}$/i.test(code)) return;
  const key = `ahouai:app-choice:${code.toUpperCase()}`;
  try { if (sessionStorage.getItem(key)) return; } catch {}
  const dialog = document.createElement('dialog');
  dialog.className = 'guest-app-choice';
  dialog.setAttribute('aria-labelledby', 'guest-app-choice-title');
  dialog.innerHTML = `<div class="guest-choice-brand"><img src="/assets/ahouai-wordmark.png" alt="AhOuai" /></div>
    <span class="guest-choice-eyebrow">LA SOIRÉE, ENSEMBLE</span>
    <h2 id="guest-app-choice-title">Entre dans<br>le moment.</h2>
    <p>Retrouve tes amis. Propose tes sons.<br>Donne le ton, à ta façon.</p>
    <button type="button" class="guest-app-choice-web">Rejoindre sur le Web <span aria-hidden="true">→</span></button>
    <span class="guest-choice-hint">Tout est là. Rien à installer.</span>
    <a class="guest-app-choice-open">J’ai déjà l’app · Ouvrir AhOuai</a>
    <section class="guest-choice-store" aria-label="Application iPhone bientôt disponible">
      <div class="guest-choice-store-heading"><strong>AhOuai sur iPhone</strong><span class="guest-choice-soon">COMING SOON</span></div>
      <p>La soirée tient dans ta poche.</p>
      <button type="button" class="guest-choice-download" disabled>Télécharger sur l’App Store</button>
      <span class="guest-choice-hint">Bientôt disponible</span>
    </section>
    <span class="guest-choice-footer">Tu choisis. La musique vous rassemble.</span>`;
  const remember = () => { try { sessionStorage.setItem(key, 'chosen'); } catch {} };
  const close = () => { remember(); dialog.close(); dialog.remove(); };
  const open = dialog.querySelector('a');
  open.href = `ahouai://join?code=${encodeURIComponent(code.toUpperCase())}`;
  open.addEventListener('click', () => { remember(); dialog.close(); });
  dialog.querySelector('button').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector('button').focus();
})();
