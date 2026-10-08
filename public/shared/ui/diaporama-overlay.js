/**
 * public/shared/ui/diaporama-overlay.js
 * ★ AhOuai — Best Of/diaporama amené dans l'app host (chemin B : le host récupère les
 *   environnements du guest). Overlay plein écran lançable d'un bouton, pensé pour la recopie
 *   AirPlay sur une TV : il affiche l'écran AhOuai (pochette, titre, phase, QR, souvenirs),
 *   JAMAIS le lecteur YouTube. Réutilise la surface d'affichage déjà déployée (/host/display)
 *   dans un plein écran intégré — le host reste sur son cockpit, le diaporama passe par-dessus.
 *
 * Autonome (script classique). Exposé : window.AhOuaiDiaporama { open(code), close() }.
 * Guest-safe : n'affecte que l'app host où il est inclus.
 */
(function () {
  "use strict";
  var OVERLAY_ID = 'ahouai-diapo-overlay';

  function close() {
    var o = document.getElementById(OVERLAY_ID);
    if (o) o.remove();
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    document.body.style.overflow = '';
  }

  function open(code) {
    code = (code || '').toUpperCase().trim();
    if (!code) { try { if (typeof showToast === 'function') showToast('Aucun code de soirée'); } catch (e) {} return; }
    if (document.getElementById(OVERLAY_ID)) close();

    var o = document.createElement('div');
    o.id = OVERLAY_ID;
    o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#070b14;display:flex;flex-direction:column';

    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:rgba(7,11,20,.9);border-bottom:1px solid rgba(255,255,255,.08);font-family:Outfit,system-ui,sans-serif';
    bar.innerHTML = '<span style="color:#22e3c9;font-weight:700;font-size:14px;letter-spacing:.08em">DIAPORAMA · ' + code + '</span>' +
      '<span style="color:#6b7799;font-size:12px;flex:1;text-align:center">Recopie cet écran sur ta TV (AirPlay)</span>';

    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px';
    var fs = document.createElement('button');
    fs.textContent = '⛶ Plein écran';
    fs.style.cssText = 'background:rgba(255,255,255,.08);color:#f4f8ff;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:8px 12px;font:600 13px Outfit,sans-serif;cursor:pointer';
    fs.onclick = function () { try { o.requestFullscreen ? o.requestFullscreen() : (o.webkitRequestFullscreen && o.webkitRequestFullscreen()); } catch (e) {} };
    var cl = document.createElement('button');
    cl.textContent = '✕ Fermer';
    cl.style.cssText = 'background:rgba(255,63,180,.15);color:#ff8ec9;border:1px solid rgba(255,63,180,.35);border-radius:10px;padding:8px 12px;font:600 13px Outfit,sans-serif;cursor:pointer';
    cl.onclick = close;
    btns.appendChild(fs); btns.appendChild(cl);
    bar.appendChild(btns);

    var frame = document.createElement('iframe');
    frame.src = '/host/display/?code=' + encodeURIComponent(code);
    frame.title = 'Diaporama AhOuai';
    frame.allow = 'autoplay; fullscreen';
    frame.style.cssText = 'flex:1;width:100%;border:0;background:#070b14';

    o.appendChild(bar);
    o.appendChild(frame);
    document.body.appendChild(o);
    document.body.style.overflow = 'hidden';
  }

  // Esc ferme l'overlay
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  window.AhOuaiDiaporama = { open: open, close: close };
})();
