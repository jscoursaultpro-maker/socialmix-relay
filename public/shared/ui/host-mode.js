/**
 * public/shared/ui/host-mode.js
 * ★ AhOuai — « Mode host » du guest (brique 1 : détection + barre de contrôles musique, UI).
 *
 * Décision 02/10/2026 (claude/decision-guest-mode-host-02oct2026.md) :
 * il n'y a qu'UNE appli — le guest — qui passe en « mode host » pour l'hôte.
 * Mêmes écrans ; la seule différence host = piloter la musique (play/pause/suivant/repeat).
 *
 * Ce module est AUTONOME (script classique chargé après app.js) :
 *  - il lit le `state` global du guest (participants + userId) pour détecter l'hôte,
 *  - il injecte sa propre CSS et sa barre de contrôles dans l'écran On Air (#tab-soiree),
 *  - il ne modifie AUCUN fichier du guest (app.js / style.css) → zéro collision avec Daphné.
 *
 * Brique 1 = UI + détection uniquement. Le câblage du moteur (player-engine : YouTube/Spotify/
 * Apple) viendra dans une brique suivante, coordonnée avec Daphné. Les boutons sont donc des
 * placeholders honnêtes (ils le disent) tant que le moteur n'est pas rebranché dans le guest.
 */
(function () {
  "use strict";

  var DEV_FORCE = /[?&]host=1\b/.test(location.search); // override de test : ...?host=1
  var MOUNT_ID = 'host-cockpit-bar';
  var STYLE_ID = 'host-mode-style';
  var booted = false;
  var lastHostState = null;

  // ── Détection « je suis l'hôte de cette soirée » ──────────────────────────
  function isHostMode() {
    if (DEV_FORCE) return true;
    try {
      var s = (typeof state !== 'undefined' && state) ? state : null;
      if (!s || !s.userId || !Array.isArray(s.participants)) return false;
      var mine = String(s.userId);
      return s.participants.some(function (p) {
        return p && p.isHost && p.userId && String(p.userId) === mine;
      });
    } catch (e) { return false; }
  }

  // ── Toast (réutilise celui du guest s'il existe) ──────────────────────────
  function toast(msg) {
    try {
      if (typeof showToast === 'function') { showToast(msg, 2200); return; }
    } catch (e) {}
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:104px;left:50%;transform:translateX(-50%);z-index:12000;background:rgba(8,14,26,.92);color:#eaf2ff;padding:11px 18px;border-radius:12px;font:600 13px/1.2 Outfit,system-ui,sans-serif;border:1px solid rgba(34,227,201,.4);box-shadow:0 10px 30px rgba(0,0,0,.4)';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  // ── CSS injectée (pas de style.css touché) ────────────────────────────────
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#' + MOUNT_ID + '{display:none;margin:0 0 16px;padding:14px 16px;border-radius:20px;',
      'background:linear-gradient(135deg,rgba(34,227,201,.14),rgba(122,92,255,.12));',
      'border:1px solid rgba(34,227,201,.34);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
      'box-shadow:0 10px 34px rgba(0,0,0,.35)}',
      '#' + MOUNT_ID + '.hm-on{display:block;animation:hmIn .35s ease}',
      '@keyframes hmIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}',
      '#' + MOUNT_ID + ' .hm-head{display:flex;align-items:center;gap:9px;margin-bottom:12px}',
      '#' + MOUNT_ID + ' .hm-badge{font:800 10px/1 Outfit,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#07131f;background:#22e3c9;padding:5px 9px;border-radius:999px}',
      '#' + MOUNT_ID + ' .hm-sub{font:600 12px/1.2 Outfit,sans-serif;color:#aeb9d4}',
      '#' + MOUNT_ID + ' .hm-row{display:flex;align-items:center;gap:10px}',
      '#' + MOUNT_ID + ' .hm-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;',
      'padding:12px 6px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);',
      'color:#f4f8ff;font:600 11px/1 Outfit,sans-serif;cursor:pointer;transition:transform .12s ease,background .15s ease;-webkit-tap-highlight-color:transparent}',
      '#' + MOUNT_ID + ' .hm-btn:active{transform:scale(.94)}',
      '#' + MOUNT_ID + ' .hm-btn .ic{font-size:20px;line-height:1}',
      '#' + MOUNT_ID + ' .hm-btn.hm-primary{background:linear-gradient(135deg,#22e3c9,#13b7a3);color:#06121d;border-color:transparent;flex:1.5}',
      '#' + MOUNT_ID + ' .hm-btn.hm-active{background:rgba(34,227,201,.22);border-color:rgba(34,227,201,.55);color:#22e3c9}',
      '#' + MOUNT_ID + ' .hm-soon{margin-top:10px;font:600 10px/1.3 Outfit,sans-serif;color:#6b7799;text-align:center}'
    ].join('');
    var el = document.createElement('style');
    el.id = STYLE_ID; el.textContent = css;
    document.head.appendChild(el);
  }

  // ── Barre de contrôles (UI) ───────────────────────────────────────────────
  function buildBar() {
    var bar = document.createElement('div');
    bar.id = MOUNT_ID;
    bar.innerHTML =
      '<div class="hm-head"><span class="hm-badge">Mode host</span>' +
      '<span class="hm-sub">Tu pilotes la musique</span></div>' +
      '<div class="hm-row">' +
        '<button class="hm-btn hm-primary" data-act="playpause"><span class="ic" id="hm-pp-ic">▶️</span><span id="hm-pp-tx">Play</span></button>' +
        '<button class="hm-btn" data-act="next"><span class="ic">⏭️</span><span>Suivant</span></button>' +
        '<button class="hm-btn" data-act="repeat" id="hm-repeat"><span class="ic">🔁</span><span>Repeat</span></button>' +
      '</div>' +
      '<div class="hm-soon">Contrôles bientôt reliés au moteur musique (brique suivante)</div>';
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.hm-btn') : null;
      if (!btn) return;
      onAction(btn.getAttribute('data-act'), btn);
    });
    return bar;
  }

  // Placeholders honnêtes — remplacés par les vrais appels moteur dans la brique suivante.
  var playing = false;
  function onAction(act) {
    if (act === 'playpause') {
      playing = !playing;
      var ic = document.getElementById('hm-pp-ic'), tx = document.getElementById('hm-pp-tx');
      if (ic) ic.textContent = playing ? '⏸️' : '▶️';
      if (tx) tx.textContent = playing ? 'Pause' : 'Play';
    } else if (act === 'repeat') {
      var r = document.getElementById('hm-repeat');
      if (r) r.classList.toggle('hm-active');
    }
    toast('🎛️ Contrôle « ' + act + ' » — à relier au moteur (brique suivante)');
  }

  // ── Montage + bascule de visibilité ───────────────────────────────────────
  function ensureMounted() {
    if (document.getElementById(MOUNT_ID)) return true;
    var onair = document.getElementById('tab-soiree');
    if (!onair) return false;
    injectStyle();
    onair.insertBefore(buildBar(), onair.firstChild);
    return true;
  }

  function sync() {
    var host = isHostMode();
    var bar = document.getElementById(MOUNT_ID);
    if (host && !bar) { if (!ensureMounted()) return; bar = document.getElementById(MOUNT_ID); }
    if (!bar) return;
    bar.classList.toggle('hm-on', host);
    if (host !== lastHostState) {
      lastHostState = host;
      if (host) console.log('[host-mode] activé (barre de contrôles affichée sur On Air)');
    }
  }

  function boot() {
    if (booted) return; booted = true;
    sync();
    setInterval(sync, 1500); // re-évalue au fil des party:state (participants/userId)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }

  // Exposé pour la brique suivante (câblage moteur) et le debug.
  window.AhOuaiHostMode = { isHostMode: isHostMode, sync: sync };
})();
