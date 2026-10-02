/**
 * public/shared/ui/host-mode.js
 * ★ AhOuai — « Mode host » du guest : rend l'écran On Air pilotable par l'hôte, à l'image du
 *   Host iOS. Il n'y a qu'un écran On Air ; en mode host on ajoute le transport (juste au-dessus
 *   des votes), et la vidéo prend la place du vinyle (géré par host-engine.js). Invité = inchangé.
 *
 * Décision : claude/decision-on-air-host-guest-02oct2026.md.
 * Module autonome (script classique après app.js) : lit le `state` global + AhOuaiHostEngine.
 */
(function () {
  "use strict";

  var DEV_FORCE = /[?&]host=1\b/.test(location.search);
  var STYLE_ID = 'host-mode-style';
  var TRANSPORT_ID = 'host-transport';
  var booted = false, lastHost = null;

  function isHostMode() {
    if (DEV_FORCE) return true;
    try { if (window.AhOuaiHostEngine && window.AhOuaiHostEngine.isActive && window.AhOuaiHostEngine.isActive()) return true; } catch (e) {}
    try {
      var s = (typeof state !== 'undefined' && state) ? state : null;
      if (!s || !s.userId || !Array.isArray(s.participants)) return false;
      var mine = String(s.userId);
      return s.participants.some(function (p) { return p && p.isHost && p.userId && String(p.userId) === mine; });
    } catch (e) { return false; }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      // Transport host — juste au-dessus des votes, formes iOS (photo 2)
      '#' + TRANSPORT_ID + '{display:none;align-items:center;justify-content:center;gap:16px;margin:6px 0 14px;padding:4px 0}',
      '#' + TRANSPORT_ID + '.hm-on{display:flex}',
      '#' + TRANSPORT_ID + ' .hm-rejouer{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:999px;',
      'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14);color:#dfe7f5;font:700 14px/1 Outfit,system-ui,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '#' + TRANSPORT_ID + ' .hm-rejouer:active{transform:scale(.96)}',
      '#' + TRANSPORT_ID + ' .hm-pp{width:70px;height:70px;border-radius:50%;border:none;cursor:pointer;color:#06121d;',
      'background:radial-gradient(circle at 35% 30%,#4df0d8,#22e3c9 55%,#17b9c9);',
      'box-shadow:0 0 0 6px rgba(34,227,201,.12),0 0 34px rgba(34,227,201,.55);font-size:26px;display:flex;align-items:center;justify-content:center;transition:transform .12s ease}',
      '#' + TRANSPORT_ID + ' .hm-pp:active{transform:scale(.93)}',
      '#' + TRANSPORT_ID + ' .hm-next{width:56px;height:56px;border-radius:50%;cursor:pointer;color:#eaf2ff;',
      'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);font-size:22px;display:flex;align-items:center;justify-content:center}',
      '#' + TRANSPORT_ID + ' .hm-next:active{transform:scale(.93)}',
      // Vidéo YouTube dans la zone pochette (remplace le vinyle)
      '.soiree-artwork-zone.hm-host-video #soiree-vinyl-wrap,.soiree-artwork-zone.hm-host-video #np-artwork{display:none!important}',
      '.soiree-artwork-zone.hm-host-video #yt-player-mount{display:block}',
      '#yt-player-mount{width:200px;height:200px;max-width:100%;border-radius:18px;overflow:hidden;background:#000}',
      '#yt-player-mount #yt-player,#yt-player-mount iframe{width:100%;height:100%;border:0;display:block}'
    ].join('');
    var el = document.createElement('style'); el.id = STYLE_ID; el.textContent = css;
    document.head.appendChild(el);
  }

  function buildTransport() {
    var t = document.createElement('div');
    t.id = TRANSPORT_ID;
    t.innerHTML =
      '<button class="hm-rejouer" data-act="repeat"><span>⟳</span> Rejouer</button>' +
      '<button class="hm-pp" data-act="playpause"><span id="hm-pp-ic">▶</span></button>' +
      '<button class="hm-next" data-act="next" aria-label="Suivant">⏭</button>';
    t.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (b) onAction(b.getAttribute('data-act'));
    });
    return t;
  }

  var playing = true;
  async function onAction(act) {
    var eng = window.AhOuaiHostEngine || null;
    if (act === 'playpause') {
      if (eng && eng.isActive()) { playing = await eng.togglePlay(); }
      else { playing = !playing; toast('Lance une soirée pour piloter'); }
      var ic = document.getElementById('hm-pp-ic'); if (ic) ic.textContent = playing ? '⏸' : '▶';
    } else if (act === 'next') {
      if (eng && eng.isActive()) eng.next(); else toast('Moteur non actif');
    } else if (act === 'repeat') {
      if (eng && eng.isActive()) eng.repeat(); else toast('Moteur non actif');
    }
  }

  function toast(m) { try { if (typeof showToast === 'function') return showToast(m, 2000); } catch (e) {} }

  // Monte le transport juste AVANT la rangée de votes (#soiree-vote-row).
  function ensureMounted() {
    if (document.getElementById(TRANSPORT_ID)) return true;
    var voteRow = document.getElementById('vote-meh') ? document.querySelector('.soiree-vote-row') : null;
    if (!voteRow || !voteRow.parentNode) return false;
    injectStyle();
    voteRow.parentNode.insertBefore(buildTransport(), voteRow);
    return true;
  }

  function sync() {
    var host = isHostMode();
    if (host && !document.getElementById(TRANSPORT_ID)) { if (!ensureMounted()) return; }
    var t = document.getElementById(TRANSPORT_ID);
    if (t) t.classList.toggle('hm-on', host);
    if (host !== lastHost) {
      lastHost = host;
      if (host) console.log('[host-mode] On Air host — transport au-dessus des votes');
    }
  }

  function boot() { if (booted) return; booted = true; sync(); setInterval(sync, 1200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.AhOuaiHostMode = { isHostMode: isHostMode, sync: sync };
})();
