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
  dialog.innerHTML = `<h2 id="guest-app-choice-title">Ta soirée, à ta façon.</h2>
    <p>Tu es sur la version Web. Tu préfères ouvrir cette soirée dans l’app AhOuai ?</p>
    <a class="guest-app-choice-open">Ouvrir dans AhOuai</a>
    <button type="button" class="guest-app-choice-web">Continuer sur le Web</button>`;
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
