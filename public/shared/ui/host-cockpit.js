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
  // ★ Task #55 — Salle d'attente : état local alimenté par party:state (isHost) + host:pendingGuestRequest.
  var pending = [], waitApproval = false, _wiredSock = null, _lastStateReq = 0;

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
      '#' + WRAP_ID + ' .hc-empty{color:#6b7799;font:500 13px Outfit,sans-serif;text-align:center;padding:8px}',
      // ★ Task #55 — Salle d'attente
      '#' + WRAP_ID + ' .hc-wait{border:1px solid rgba(91,200,255,.28)}',
      '#' + WRAP_ID + ' .hc-wait .hc-wait-toggle{display:flex;align-items:center;gap:12px;margin:2px 0 12px}',
      '#' + WRAP_ID + ' .hc-wait .hc-wait-toggle .lab{flex:1;min-width:0}',
      '#' + WRAP_ID + ' .hc-wait .hc-wait-toggle .lab b{display:block;font:800 15px Outfit,sans-serif;color:#f4f8ff}',
      '#' + WRAP_ID + ' .hc-wait .hc-wait-toggle .lab span{font:500 12px Outfit,sans-serif;color:#9aa6c2}',
      '#' + WRAP_ID + ' .hc-pending-av{width:30px;height:30px;border-radius:50%;background:rgba(91,200,255,.18);color:#8fd3ff;display:flex;align-items:center;justify-content:center;font-size:15px;flex:0 0 auto}',
      '#' + WRAP_ID + ' .hc-ok{border:none;background:linear-gradient(135deg,#22e3c9,#13b7a3);color:#06121d;font:800 12px Outfit,sans-serif;border-radius:10px;padding:0 12px;height:30px;cursor:pointer;white-space:nowrap}',
      // ★ Task #62 — mini-roster On Air
      '#' + WRAP_ID + ' .hc-crew-list{display:flex;flex-wrap:wrap;gap:10px}',
      '#' + WRAP_ID + ' .hc-crew-chip{display:flex;align-items:center;gap:7px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:4px 11px 4px 4px}',
      '#' + WRAP_ID + ' .hc-crew-av{width:26px;height:26px;border-radius:50%;background:rgba(34,227,201,.18);color:#22e3c9;display:flex;align-items:center;justify-content:center;font-size:13px;overflow:hidden;flex:0 0 auto}',
      '#' + WRAP_ID + ' .hc-crew-av img{width:100%;height:100%;object-fit:cover}',
      '#' + WRAP_ID + ' .hc-crew-nm{font:600 12px Outfit,sans-serif;color:#e7edf7;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis}'
    ].join('');
    var el = document.createElement('style'); el.id = STYLE_ID; el.textContent = c; document.head.appendChild(el);
  }

  function build() {
    var w = document.createElement('div');
    w.id = WRAP_ID;
    w.innerHTML =
      '<div class="hc-card hc-dram">' +
        '<div class="hd"><span class="t">SOIRÉE EN COURS</span><span class="auto" id="hc-mode-badge" title="Cliquer pour revenir à l\'enchaînement automatique">● AUTO</span></div>' +
        '<div class="hc-frise" id="hc-frise"></div>' +
        '<div class="hc-phase-now" id="hc-phase-now">—</div>' +
        '<div class="hc-phase-sub" id="hc-phase-sub">—</div>' +
        '<div class="hc-stats"><span class="fr" id="hc-fr">Fraîcheur —</span><span><b id="hc-people">0</b> personnes</span></div>' +
      '</div>' +
      // ★ Task #62 — Mini-roster « Dans la soirée » sur On Air (noms/avatars des participants).
      //   Évite au host de quitter On Air pour voir qui est entré (le roster complet reste au Social Hub).
      '<div class="hc-card hc-crew" id="hc-crew-card" style="display:none">' +
        '<div class="hc-next-h">👥 Dans la soirée <span class="n" id="hc-crew-n">0</span></div>' +
        '<div class="hc-crew-list" id="hc-crew-list"></div>' +
      '</div>' +
      // ★ Task #55/#61 — Salle d'attente : le TOGGLE est toujours visible en mode host (sinon le host
      //   ne peut jamais activer la validation) ; seule la LISTE des pending est conditionnelle.
      '<div class="hc-card hc-wait" id="hc-wait-card">' +
        '<div class="hc-next-h">🚪 Salle d\'attente <span class="n" id="hc-wait-n">0</span></div>' +
        '<div class="hc-wait-toggle">' +
          '<div class="lab"><b>Valider les invités</b><span>ON : chaque invité attend ton feu vert · OFF : entrée libre</span></div>' +
          '<div class="hc-sw" id="hc-wait-sw"></div>' +
        '</div>' +
        '<div class="hc-q" id="hc-wait-list"></div>' +
      '</div>' +
      // Sélecteur descendu, juste au-dessus de la file qu'il pilote.
      '<div class="hc-card hc-auto">' +
        '<span class="inf">∞</span>' +
        '<div class="lab"><b>Enchaînement auto</b><span>ON : les suggestions entrent seules dans la file · OFF : tu les ajoutes à la main</span></div>' +
        '<div class="hc-sw" id="hc-auto-sw"></div>' +
      '</div>' +
      // Carte suggestions — visible uniquement quand l'enchaînement auto est OFF.
      '<div class="hc-card" id="hc-sugg-card" style="display:none">' +
        '<div class="hc-next-h">💡 Suggestions <span class="n" id="hc-sugg-n">0</span></div>' +
        '<div class="hc-q" id="hc-sugg-list"></div>' +
      '</div>' +
      '<div class="hc-card">' +
        '<div class="hc-next-h">🎚️ À suivre <span class="n" id="hc-q-n">0</span></div>' +
        '<div class="hc-q" id="hc-q"></div>' +
      '</div>' +
      // Terminer la soirée → AfterGlow (confirmation en 2 temps, pas de modale navigateur).
      '<div class="hc-card" style="text-align:center">' +
        '<button id="hc-end" style="width:100%;padding:13px;border:1px solid rgba(255,77,128,.5);border-radius:12px;background:rgba(255,77,128,.12);color:#ff6b9d;font:800 15px Outfit,sans-serif;cursor:pointer">Terminer la soirée</button>' +
      '</div>';
    // Terminer la soirée — confirmation en 2 temps (1er clic arme, 2e clic dans 4 s confirme).
    (function () {
      var btn = w.querySelector('#hc-end'); if (!btn) return;
      var armed = false, timer = null;
      btn.addEventListener('click', function () {
        var e = eng(); if (!e || !e.endParty) return;
        if (!armed) {
          armed = true;
          btn.textContent = 'Confirmer la fin ?';
          btn.style.background = 'rgba(255,77,128,.28)';
          timer = setTimeout(function () { armed = false; btn.textContent = 'Terminer la soirée'; btn.style.background = 'rgba(255,77,128,.12)'; }, 4000);
          return;
        }
        if (timer) clearTimeout(timer);
        armed = false; btn.disabled = true; btn.textContent = 'Soirée terminée…';
        e.endParty();   // serveur → party:ended → l'hôte (room invité) bascule sur le récap
      });
    })();
    // Frise cliquable — override manuel de phase (le DJ Brain repart de la phase choisie).
    (function () {
      var frise = w.querySelector('#hc-frise'); if (!frise) return;
      frise.addEventListener('click', function (ev) {
        var step = ev.target.closest ? ev.target.closest('.hc-step[data-stage]') : null;
        if (!step) return;
        var e = eng(); if (!e || !e.setPhase) return;
        var stage = step.getAttribute('data-stage');
        e.setPhase(stage);
        renderFrise(stage);   // feedback visuel immédiat (le party:state confirmera)
      });
    })();
    // Badge mode phase (● AUTO / ● MANUEL) — cliquable : en manuel, relâche vers l'automatique.
    (function () {
      var badge = w.querySelector('#hc-mode-badge'); if (!badge) return;
      badge.style.cursor = 'pointer';
      badge.addEventListener('click', function () {
        var e = eng(); if (!e || !e.getPhaseMode || !e.setAuto) return;
        if (e.getPhaseMode() !== 'auto') { e.setAuto(); setTimeout(sync, 150); }
      });
    })();
    // AUTO toggle — bascule aussi le mode suggestions (auto-file vs carte manuelle)
    w.querySelector('#hc-auto-sw').addEventListener('click', function () {
      var e = eng(); if (!e) return;
      var on = e.setAutoAdvance(!e.getAutoAdvance());
      this.classList.toggle('on', on);
      sync();
    });
    // Délégation clics carte Suggestions (mode auto OFF) : Ajouter / Refuser
    w.querySelector('#hc-sugg-list').addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[data-act]') : null;
      if (!b) return;
      var e = eng(); if (!e) return;
      var sugg = { trackId: b.getAttribute('data-id') || null, title: b.getAttribute('data-title'), artist: b.getAttribute('data-artist') || '', guestName: b.getAttribute('data-guest') };
      var act = b.getAttribute('data-act');
      if (act === 'add') { if (e.addSuggestionToQueue) e.addSuggestionToQueue(sugg, 'end'); }
      else if (act === 'reject') { if (e.dismissSuggestion) e.dismissSuggestion({ title: sugg.title, guestName: sugg.guestName, trackId: sugg.trackId }); }
      setTimeout(function () { renderSuggCard(); renderQueue(); }, 150);
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
    // ★ Task #55 — Toggle « Valider les invités » : bascule party.requiresApproval côté serveur.
    w.querySelector('#hc-wait-sw').addEventListener('click', function () {
      var e = eng(); if (!e || !e.setApprovalMode) return;
      var next = !waitApproval;
      waitApproval = next;                 // optimiste, confirmé par l'ack + le prochain party:state
      this.classList.toggle('on', next);
      e.setApprovalMode(next, function (ack) {
        // ★ Task #67 — rollback optimiste si le serveur rejette (ex. NOT_HOST : host non
        //   autoritaire). Sans ça, l'UI resterait sur un faux « ON » jamais persisté en Mongo.
        if (ack && ack.ok === false) { waitApproval = !next; }
        else if (ack && typeof ack.enabled === 'boolean') { waitApproval = ack.enabled; }
        renderWaitingRoom();
      });
      renderWaitingRoom();
    });
    // ★ Task #55 — Admettre (host:approveGuest) / Refuser (host:denyGuest existant). Retrait optimiste.
    w.querySelector('#hc-wait-list').addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[data-act]') : null;
      if (!b) return;
      var e = eng(); if (!e) return;
      var uid = b.getAttribute('data-uid'), act = b.getAttribute('data-act');
      if (!uid) return;
      pending = pending.filter(function (p) { return String(p.userId) !== String(uid); });
      renderWaitingRoom();
      var done = function () { if (e.requestHostState) e.requestHostState(); setTimeout(renderWaitingRoom, 250); };
      if (act === 'approve' && e.approveGuest) e.approveGuest(uid, done);
      else if (act === 'deny' && e.denyGuest) e.denyGuest(uid, done);
    });
    return w;
  }

  // Mode auto OFF : les suggestions en attente s'affichent dans la carte, l'hôte les ajoute à la main.
  function renderSuggCard() {
    var card = document.getElementById('hc-sugg-card'); var box = document.getElementById('hc-sugg-list');
    if (!card || !box) return;
    var e = eng();
    var inQ = {};
    var up = (e && e.getUpcoming) ? e.getUpcoming() : [];
    up.forEach(function (t) { inQ[normT(t.title)] = true; });
    var now = (e && e.getNowPlaying) ? e.getNowPlaying() : null;
    if (now) inQ[normT(now.title)] = true;
    var list = ((lastState && lastState.suggestions) || []).filter(function (s) {
      if (!s || ['dismissed', 'played', 'unavailable', 'queued'].indexOf(s.status) >= 0) return false;
      // ★ 03/10 (option A, host=guest) : on affiche AUSSI les suggestions de l'hôte lui-même,
      //   pour qu'il puisse les ajouter à la main en auto OFF (et que le test solo fonctionne).
      return !inQ[normT(s.title || s.query)];
    });
    card.style.display = list.length ? '' : 'none';
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
      return '<div class="hc-step ' + cls + '" data-stage="' + p.key + '" style="cursor:pointer" title="Passer en ' + p.label + '"><div class="hc-dot">' + p.ic + '</div><div class="nm">' + p.label + '</div></div>';
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

  // ★ Task #55 — Salle d'attente : socket partagé (même binding global lexical que host-engine).
  function sockRef() { try { return (typeof socket !== 'undefined' && socket) ? socket : (window.socket || null); } catch (e) { return window.socket || null; } }

  // Attache les écouteurs une fois par instance de socket (robuste à la reconnexion = nouveau socket).
  function wireWaitingRoom() {
    var s = sockRef(); if (!s || s === _wiredSock) return;
    _wiredSock = s;
    // party:state (host) → pendingGuests + requiresApproval font autorité (buildLightState isHost=true).
    s.on('party:state', function (ps) {
      if (!ps) return;
      if (Array.isArray(ps.pendingGuests)) pending = ps.pendingGuests.slice();
      if (typeof ps.requiresApproval === 'boolean') waitApproval = ps.requiresApproval;
      renderWaitingRoom();
    });
    // Ajout live d'un invité qui frappe à la porte (émis par le serveur au seul hostSocketId).
    s.on('host:pendingGuestRequest', function (g) {
      if (!g || !g.userId) return;
      if (!pending.some(function (p) { return String(p.userId) === String(g.userId); })) {
        pending.push({ userId: g.userId, firstName: g.firstName || '', lastName: g.lastName || '', email: g.email || '', requestedAt: g.requestedAt || Date.now() });
      }
      renderWaitingRoom();
    });
    // ★ Task #67 — revendique l'identité host autoritaire une fois par socket (ouverture cockpit
    //   / reconnexion). Sans ça, un host dont la party a été ré-hydratée par une action guest
    //   (hostSocketId=null) voit ses mutations (toggle, modération, admission) rejetées en silence.
    var e = eng(); if (e && e.claim) e.claim();
    // Charge l'état host immédiatement (peuple la salle d'attente au montage / à la reconnexion).
    if (e && e.requestHostState) e.requestHostState();
  }

  function renderWaitingRoom() {
    var card = document.getElementById('hc-wait-card'); if (!card) return;
    // ★ Task #61 : carte (donc le toggle) TOUJOURS visible en mode host — c'est le seul moyen
    //   d'activer la validation. Seule la liste des pending reste conditionnelle (ci-dessous).
    card.style.display = '';
    var sw = document.getElementById('hc-wait-sw'); if (sw) sw.classList.toggle('on', !!waitApproval);
    var nEl = document.getElementById('hc-wait-n'); if (nEl) nEl.textContent = pending.length;
    var box = document.getElementById('hc-wait-list'); if (!box) return;
    if (!pending.length) {
      box.innerHTML = waitApproval ? '<div class="hc-empty">Personne en attente. Les invités qui scannent le QR apparaîtront ici.</div>' : '';
      return;
    }
    box.innerHTML = pending.map(function (p) {
      var nm = ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || p.email || 'Invité';
      var uid = esc(String(p.userId || ''));
      return '<div class="hc-row" data-uid="' + uid + '">' +
        '<div class="hc-pending-av">🙋</div>' +
        '<div class="hc-ti"><div class="tt">' + esc(nm) + '</div></div>' +
        '<div class="hc-acts">' +
          '<button class="hc-ok" data-act="approve" data-uid="' + uid + '">✓ Admettre</button>' +
          '<button class="hc-del" data-act="deny" data-uid="' + uid + '" aria-label="Refuser">✕</button>' +
        '</div></div>';
    }).join('');
  }

  // ★ Task #62 — Mini-roster « Dans la soirée » : noms/avatars des participants, lu depuis le state
  //   global (alimenté par party:state / participants:update dans app.js). Host-gated (dans le cockpit).
  function renderCrew() {
    var card = document.getElementById('hc-crew-card'); if (!card) return;
    var st = (typeof state !== 'undefined' && state) ? state : (window.state || {});
    var list = (st && Array.isArray(st.participants)) ? st.participants : [];
    card.style.display = list.length ? '' : 'none';
    var nEl = document.getElementById('hc-crew-n'); if (nEl) nEl.textContent = list.length;
    var box = document.getElementById('hc-crew-list'); if (!box) return;
    box.innerHTML = list.map(function (p) {
      var nm = (p && (p.name || p.firstName)) || 'Invité';
      var badge = (p && p.isHost) ? ' 🎧' : '';
      var av = (p && p.photo)
        ? '<span class="hc-crew-av"><img src="' + esc(p.photo) + '" alt=""></span>'
        : '<span class="hc-crew-av">' + esc((p && p.emoji) || '🎉') + '</span>';
      return '<div class="hc-crew-chip">' + av + '<span class="hc-crew-nm">' + esc(nm) + badge + '</span></div>';
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
    var auto = (e && e.getAutoAdvance) ? e.getAutoAdvance() : true;
    if (sw) sw.classList.toggle('on', auto);
    // Badge mode phase : ● AUTO (cascade) ou ● MANUEL <phase> (décision tenue par l'hôte).
    var badge = document.getElementById('hc-mode-badge');
    if (badge) {
      var pm = (e && e.getPhaseMode) ? e.getPhaseMode() : 'auto';
      if (pm === 'auto') { badge.textContent = '● AUTO'; badge.style.opacity = ''; }
      else {
        var lab = (PHASES.filter(function (p) { return p.key === pm; })[0] || {}).label || pm;
        badge.textContent = '✋ ' + lab.toUpperCase();
      }
    }
    if (auto) {
      // Auto ON → c'est le DJ Brain qui décide QUAND passer les suggestions (scoring
      // phase/énergie, côté serveur). On ne force rien dans la file : elles remontent
      // via /api/djbrain/next au bon moment. Carte masquée.
      var card = document.getElementById('hc-sugg-card'); if (card) card.style.display = 'none';
    } else {
      // Auto OFF → l'hôte ajoute les suggestions à la main via la carte.
      renderSuggCard();
    }
    renderQueue();
    // ★ Task #55 — Salle d'attente : brancher les écouteurs + rafraîchir l'état host (sécurité
    //   en plus du live host:pendingGuestRequest : couvre le cas « host rejoint après coup »).
    wireWaitingRoom();
    var tnow = Date.now();
    if (tnow - _lastStateReq > 3000) { _lastStateReq = tnow; if (e && e.requestHostState) e.requestHostState(); }
    renderWaitingRoom();
    renderCrew();
    pollState();
  }

  function boot() { if (booting) return; booting = true; sync(); setInterval(sync, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.AhOuaiHostCockpit = { sync: sync, renderQueue: renderQueue };
})();
