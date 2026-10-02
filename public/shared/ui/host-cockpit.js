/**
 * public/shared/ui/host-cockpit.js
 * ★ AhOuai — On Air host : modules ENCHAÎNEMENT AUTO + dramaturgie (frise 6 phases) + À SUIVRE
 *   (file ajustable), à l'image du Host iOS. Inséré sous le now-playing, visible en mode host only.
 *   Lit AhOuaiHostEngine (file, auto, code) + /api/state (phase, énergie, participants).
 *   Invité normal non impacté (tout est gated host). Décision : decision-on-air-host-guest-02oct2026.
 */
(function () {
  "use strict";
  var WRAP_ID = 'host-cockpit';
  var STYLE_ID = 'host-cockpit-style';
  var PHASES = [
    { key: 'arrival',  label: 'Arrivée',   ic: '🚪' },
    { key: 'ambiance', label: 'Ambiance',  ic: '🎵' },
    { key: 'takeoff',  label: 'Décollage', ic: '⚡' },
    { key: 'groove',   label: 'Groove',    ic: '🕺' },
    { key: 'party',    label: 'Fête',      ic: '✨' },
    { key: 'closing',  label: 'Memories',  ic: '🎬' }
  ];
  var lastState = null, lastPoll = 0, booting = false;

  function eng() { return window.AhOuaiHostEngine || null; }
  function hostOn() { try { return window.AhOuaiHostMode && window.AhOuaiHostMode.isHostMode(); } catch (e) { return false; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var c = [
      '#' + WRAP_ID + '{display:none;flex-direction:column;gap:14px;margin:4px 0 18px}',
      '#' + WRAP_ID + '.hc-on{display:flex}',
      '#' + WRAP_ID + ' .hc-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:16px 16px}',
      // AUTO
      '#' + WRAP_ID + ' .hc-auto{display:flex;align-items:center;gap:14px}',
      '#' + WRAP_ID + ' .hc-auto .inf{width:30px;height:30px;color:#22e3c9;font-size:24px;line-height:1}',
      '#' + WRAP_ID + ' .hc-auto .lab{flex:1}',
      '#' + WRAP_ID + ' .hc-auto .lab b{display:block;font:800 16px Outfit,sans-serif;color:#f4f8ff}',
      '#' + WRAP_ID + ' .hc-auto .lab span{font:500 13px Outfit,sans-serif;color:#9aa6c2}',
      '#' + WRAP_ID + ' .hc-sw{width:58px;height:33px;border-radius:999px;background:rgba(255,255,255,.14);position:relative;cursor:pointer;transition:background .2s;flex:0 0 auto}',
      '#' + WRAP_ID + ' .hc-sw::after{content:"";position:absolute;top:3px;left:3px;width:27px;height:27px;border-radius:50%;background:#fff;transition:transform .2s}',
      '#' + WRAP_ID + ' .hc-sw.on{background:linear-gradient(90deg,#22e3c9,#13b7a3)}',
      '#' + WRAP_ID + ' .hc-sw.on::after{transform:translateX(25px)}',
      // Dramaturgie
      '#' + WRAP_ID + ' .hc-dram{border:1px solid rgba(34,227,201,.28)}',
      '#' + WRAP_ID + ' .hc-dram .hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}',
      '#' + WRAP_ID + ' .hc-dram .hd .t{font:800 14px Outfit,sans-serif;letter-spacing:.12em;color:#dfe7f5}',
      '#' + WRAP_ID + ' .hc-dram .hd .auto{font:700 11px Outfit,sans-serif;color:#22e3c9;border:1px solid rgba(34,227,201,.4);border-radius:999px;padding:5px 10px}',
      '#' + WRAP_ID + ' .hc-frise{display:flex;align-items:flex-start;justify-content:space-between;gap:2px;margin-bottom:12px}',
      '#' + WRAP_ID + ' .hc-step{display:flex;flex-direction:column;align-items:center;gap:5px;flex:1;min-width:0}',
      '#' + WRAP_ID + ' .hc-dot{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);filter:grayscale(.6);opacity:.5}',
      '#' + WRAP_ID + ' .hc-step.done .hc-dot{opacity:.8;filter:none}',
      '#' + WRAP_ID + ' .hc-step.cur .hc-dot{background:radial-gradient(circle at 35% 30%,#4ad7ff,#2b8cff);border-color:#5bc8ff;box-shadow:0 0 18px rgba(60,160,255,.6);opacity:1;filter:none}',
      '#' + WRAP_ID + ' .hc-step .nm{font:600 9px Outfit,sans-serif;color:#8390ad;text-align:center;line-height:1.1}',
      '#' + WRAP_ID + ' .hc-step.cur .nm{color:#fff;font-weight:800}',
      '#' + WRAP_ID + ' .hc-phase-now{text-align:center;font:800 26px Outfit,sans-serif;color:#fff;margin:2px 0}',
      '#' + WRAP_ID + ' .hc-phase-sub{text-align:center;font:500 13px Outfit,sans-serif;color:#9aa6c2;margin-bottom:12px}',
      '#' + WRAP_ID + ' .hc-stats{display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.04);border-radius:12px;padding:10px 14px;font:600 13px Outfit,sans-serif;color:#cfd8ea}',
      '#' + WRAP_ID + ' .hc-stats .fr{color:#ffb24d}',
      '#' + WRAP_ID + ' .hc-stats b{color:#22e3c9}',
      // À suivre
      '#' + WRAP_ID + ' .hc-next-h{display:flex;align-items:center;gap:8px;margin-bottom:10px;font:800 15px Outfit,sans-serif;color:#f4f8ff}',
      '#' + WRAP_ID + ' .hc-next-h .n{margin-left:auto;background:#ff3fb4;color:#fff;border-radius:999px;font:800 12px Outfit,sans-serif;padding:2px 9px}',
      '#' + WRAP_ID + ' .hc-q{display:flex;flex-direction:column;gap:8px}',
      '#' + WRAP_ID + ' .hc-row{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:9px 10px}',
      '#' + WRAP_ID + ' .hc-rank{width:26px;height:26px;border-radius:50%;background:rgba(34,227,201,.18);color:#22e3c9;font:800 12px Outfit,sans-serif;display:flex;align-items:center;justify-content:center;flex:0 0 auto}',
      '#' + WRAP_ID + ' .hc-ti{flex:1;min-width:0}',
      '#' + WRAP_ID + ' .hc-ti .tt{font:700 14px Outfit,sans-serif;color:#eef3fb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#' + WRAP_ID + ' .hc-ti .ar{font:500 12px Outfit,sans-serif;color:#93a0bd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#' + WRAP_ID + ' .hc-acts{display:flex;gap:6px;flex:0 0 auto}',
      '#' + WRAP_ID + ' .hc-mini{width:30px;height:30px;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#cfd8ea;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center}',
      '#' + WRAP_ID + ' .hc-now{border:none;background:linear-gradient(135deg,#22e3c9,#13b7a3);color:#06121d;font:800 12px Outfit,sans-serif;border-radius:10px;padding:0 12px;height:30px;cursor:pointer}',
      '#' + WRAP_ID + ' .hc-del{width:30px;height:30px;border-radius:9px;border:1px solid rgba(255,63,180,.32);background:rgba(255,63,180,.1);color:#ff8ec9;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}',
      '#' + WRAP_ID + ' .hc-sug{display:inline-flex;align-items:center;gap:5px;font:700 11px Outfit,sans-serif;color:#22e3c9;margin-top:3px}',
      '#' + WRAP_ID + ' .hc-sug .av{width:16px;height:16px;border-radius:50%;background:rgba(34,227,201,.25);display:inline-flex;align-items:center;justify-content:center;font-size:10px}',
      '#' + WRAP_ID + ' .hc-empty{color:#6b7799;font:500 13px Outfit,sans-serif;text-align:center;padding:8px}'
    ].join('');
    var el = document.createElement('style'); el.id = STYLE_ID; el.textContent = c; document.head.appendChild(el);
  }

  function build() {
    var w = document.createElement('div');
    w.id = WRAP_ID;
    w.innerHTML =
      '<div class="hc-card hc-auto">' +
        '<span class="inf">∞</span>' +
        '<div class="lab"><b>Enchaînement auto</b><span>Passe automatiquement au titre suivant</span></div>' +
        '<div class="hc-sw" id="hc-auto-sw"></div>' +
      '</div>' +
      '<div class="hc-card hc-dram">' +
        '<div class="hd"><span class="t">SOIRÉE EN COURS</span><span class="auto">● AUTO</span></div>' +
        '<div class="hc-frise" id="hc-frise"></div>' +
        '<div class="hc-phase-now" id="hc-phase-now">—</div>' +
        '<div class="hc-phase-sub" id="hc-phase-sub">—</div>' +
        '<div class="hc-stats"><span class="fr" id="hc-fr">Fraîcheur —</span><span><b id="hc-people">0</b> personnes</span></div>' +
      '</div>' +
      '<div class="hc-card" id="hc-sugg-card" style="display:none">' +
        '<div class="hc-next-h">💡 Suggestions des invités <span class="n" id="hc-sugg-n">0</span></div>' +
        '<div class="hc-q" id="hc-sugg-list"></div>' +
      '</div>' +
      '<div class="hc-card">' +
        '<div class="hc-next-h">🎚️ À suivre <span class="n" id="hc-q-n">0</span></div>' +
        '<div class="hc-q" id="hc-q"></div>' +
      '</div>';
    // AUTO toggle
    w.querySelector('#hc-auto-sw').addEventListener('click', function () {
      var e = eng(); if (!e) return;
      var on = e.setAutoAdvance(!e.getAutoAdvance());
      this.classList.toggle('on', on);
    });
    // Délégation clics À suivre
    w.querySelector('#hc-q').addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[data-act]') : null;
      if (!b) return;
      var e = eng(); if (!e) return;
      var id = b.getAttribute('data-id'), act = b.getAttribute('data-act');
      var title = b.getAttribute('data-title'), guest = b.getAttribute('data-guest'), isSug = b.getAttribute('data-sug') === '1';
      if (act === 'now') { e.playNow(id); if (isSug) e.noteSuggestionPlayed({ title: title, guestName: guest }); }
      else if (act === 'up') e.move(id, 'up');
      else if (act === 'down') e.move(id, 'down');
      else if (act === 'del') { if (isSug) e.dismissSuggestion({ title: title, guestName: guest, trackId: id }); else e.removeFromQueue(id); }
      setTimeout(renderQueue, 150);
    });
    // Délégation clics Suggestions invités (Ajouter à la file / Refuser)
    w.querySelector('#hc-sugg-list').addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[data-act]') : null;
      if (!b) return;
      var e = eng(); if (!e) return;
      var sugg = { trackId: b.getAttribute('data-id') || null, title: b.getAttribute('data-title'), artist: b.getAttribute('data-artist') || '', guestName: b.getAttribute('data-guest') };
      var act = b.getAttribute('data-act');
      if (act === 'add') { if (e.addSuggestionToQueue) e.addSuggestionToQueue(sugg); }
      else if (act === 'reject') { if (e.dismissSuggestion) e.dismissSuggestion({ title: sugg.title, guestName: sugg.guestName, trackId: sugg.trackId }); }
      setTimeout(function () { renderSuggestions(); renderQueue(); }, 150);
    });
    return w;
  }

  // Suggestions invités en attente (pas encore dans la file) → carte Ajouter / Refuser.
  function renderSuggestions() {
    var box = document.getElementById('hc-sugg-list'); if (!box) return;
    var e = eng();
    var inQ = {};
    var up = (e && e.getUpcoming) ? e.getUpcoming() : [];
    up.forEach(function (t) { inQ[normT(t.title)] = true; });
    var now = (e && e.getNowPlaying) ? e.getNowPlaying() : null;
    if (now) inQ[normT(now.title)] = true;
    var list = ((lastState && lastState.suggestions) || []).filter(function (s) {
      if (!s || ['dismissed', 'played', 'unavailable', 'queued'].indexOf(s.status) >= 0) return false;
      if (s.isHost) return false;
      return !inQ[normT(s.title || s.query)];
    });
    var card = document.getElementById('hc-sugg-card'); if (card) card.style.display = list.length ? '' : 'none';
    var nEl = document.getElementById('hc-sugg-n'); if (nEl) nEl.textContent = list.length;
    box.innerHTML = list.slice(0, 10).map(function (s) {
      var who = esc(s.guestName || (s.suggestedByUser && s.suggestedByUser.firstName) || 'Invité');
      var title = esc(s.title || s.query || ''); var artist = esc(s.artist || '');
      var da = ' data-id="' + esc(s.trackId || '') + '" data-title="' + title + '" data-artist="' + artist + '" data-guest="' + who + '"';
      return '<div class="hc-row">' +
        '<div class="hc-ti"><div class="tt">' + title + '</div><div class="ar">' + artist + '</div>' +
          '<div class="hc-sug"><span class="av">👤</span> ' + who + '</div></div>' +
        '<div class="hc-acts">' +
          '<button class="hc-now" data-act="add"' + da + '>➕ Ajouter</button>' +
          '<button class="hc-del" data-act="reject"' + da + ' aria-label="Refuser">✕</button>' +
        '</div></div>';
    }).join('');
  }

  function ensureMounted() {
    if (document.getElementById(WRAP_ID)) return true;
    var np = document.getElementById('now-playing');
    if (!np || !np.parentNode) return false;
    injectStyle();
    np.parentNode.insertBefore(build(), np.nextSibling);
    return true;
  }

  function renderFrise(phaseKey) {
    var frise = document.getElementById('hc-frise'); if (!frise) return;
    var curIdx = Math.max(0, PHASES.findIndex(function (p) { return p.key === phaseKey; }));
    frise.innerHTML = PHASES.map(function (p, i) {
      var cls = i < curIdx ? 'done' : (i === curIdx ? 'cur' : '');
      return '<div class="hc-step ' + cls + '"><div class="hc-dot">' + p.ic + '</div><div class="nm">' + p.label + '</div></div>';
    }).join('');
    var cur = PHASES[curIdx];
    var nowEl = document.getElementById('hc-phase-now'); if (nowEl) nowEl.textContent = cur.label;
    return curIdx;
  }

  function normT(s) { return String(s == null ? '' : s).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]/g, '').trim(); }
  // Map titre normalisé → { name } des suggestions guests actives (pour « suggéré par »).
  function suggMap() {
    var m = {};
    var list = (lastState && lastState.suggestions) || [];
    list.forEach(function (s) {
      if (!s || ['dismissed', 'played', 'unavailable'].indexOf(s.status) >= 0) return;
      if (s.isHost) return; // suggestion de l'hôte lui-même → pas de badge
      var who = s.guestName || (s.suggestedByUser && s.suggestedByUser.firstName) || 'Invité';
      m[normT(s.title || s.query)] = { name: who };
    });
    return m;
  }

  function renderQueue() {
    var q = document.getElementById('hc-q'); if (!q) return;
    var e = eng(); var up = (e && e.getUpcoming) ? e.getUpcoming() : [];
    var nEl = document.getElementById('hc-q-n'); if (nEl) nEl.textContent = up.length;
    if (!up.length) { q.innerHTML = '<div class="hc-empty">La file se remplit avec le DJ Brain…</div>'; return; }
    var sm = suggMap();
    q.innerHTML = up.slice(0, 10).map(function (t, i) {
      var sug = sm[normT(t.title)];
      var who = sug ? esc(sug.name) : '';
      var sugLine = sug ? '<div class="hc-sug"><span class="av">👤</span> suggéré par ' + who + '</div>' : '';
      var dataAttr = ' data-id="' + esc(t.trackId) + '" data-title="' + esc(t.title) + '" data-guest="' + who + '" data-sug="' + (sug ? '1' : '') + '"';
      return '<div class="hc-row">' +
        '<div class="hc-rank">' + (i + 1) + '</div>' +
        '<div class="hc-ti"><div class="tt">' + esc(t.title) + '</div><div class="ar">' + esc(t.artist || '') + '</div>' + sugLine + '</div>' +
        '<div class="hc-acts">' +
          '<button class="hc-mini" data-act="up"' + dataAttr + ' aria-label="Monter">↑</button>' +
          '<button class="hc-mini" data-act="down"' + dataAttr + ' aria-label="Descendre">↓</button>' +
          '<button class="hc-del" data-act="del"' + dataAttr + ' aria-label="Supprimer">✕</button>' +
          '<button class="hc-now" data-act="now"' + dataAttr + '>Maintenant</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function pollState() {
    var e = eng(); var code = e && e.getCode && e.getCode();
    if (!code) return;
    var now = Date.now();
    if (now - lastPoll < 2500) return; lastPoll = now;
    try {
      var r = await fetch('/api/state?code=' + encodeURIComponent(code), { cache: 'no-store' });
      if (!r.ok) return; var s = await r.json(); lastState = s;
      renderFrise(s.currentPhase || 'arrival');
      var start = s.phaseStartedAt || s.createdAt;
      var mins = start ? Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 60000)) : 0;
      var curIdx = Math.max(0, PHASES.findIndex(function (p) { return p.key === (s.currentPhase || 'arrival'); }));
      var sub = document.getElementById('hc-phase-sub'); if (sub) sub.textContent = 'Depuis ' + mins + ' min · phase ' + (curIdx + 1) + ' sur 6';
      var ppl = (s.participants || []).filter(function (p) { return p && p.connected !== false; }).length;
      var pe = document.getElementById('hc-people'); if (pe) pe.textContent = ppl;
      var fr = document.getElementById('hc-fr'); if (fr) fr.textContent = 'Énergie ' + Math.round((s.vibeScore || 5) * 10) + '%';
    } catch (err) {}
  }

  function sync() {
    var on = hostOn();
    if (on && !document.getElementById(WRAP_ID)) { if (!ensureMounted()) return; }
    var w = document.getElementById(WRAP_ID);
    if (!w) return;
    w.classList.toggle('hc-on', on);
    if (!on) return;
    var e = eng();
    var sw = document.getElementById('hc-auto-sw');
    if (sw && e && e.getAutoAdvance) sw.classList.toggle('on', e.getAutoAdvance());
    renderQueue();
    renderSuggestions();
    pollState();
  }

  function boot() { if (booting) return; booting = true; sync(); setInterval(sync, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.AhOuaiHostCockpit = { sync: sync, renderQueue: renderQueue };
})();
