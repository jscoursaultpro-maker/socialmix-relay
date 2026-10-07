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
  var pendingGuests = [];
  var waitingRoomSocket = null;

  function isHostMode() {
    if (DEV_FORCE && ['localhost','127.0.0.1'].includes(location.hostname)) return true;
    try { if (window.AhOuaiHostEngine && window.AhOuaiHostEngine.isActive && window.AhOuaiHostEngine.isActive()) { var party=window.AhOuaiHostEngine._debug?.().party; if(party?.code && typeof state !== 'undefined' && party.code===state.partyCode) return true; } } catch (e) {}
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
      '.soiree-artwork-zone.hm-host-video{flex:0 0 200px!important;width:200px!important;max-width:200px!important}',
      '.soiree-artwork-zone.hm-host-video #yt-player-mount{display:block}',
      '#yt-player-mount{width:200px!important;height:200px!important;max-width:200px;border-radius:18px;overflow:hidden;background:#000}',
      '#yt-player-mount #yt-player,#yt-player-mount iframe{width:100%;height:100%;border:0;display:block}',
      'body.ah-host-mode #bottom-nav{grid-template-columns:repeat(5,minmax(0,1fr))}',
      'body.ah-host-mode #bottom-nav .nav-label{font-size:8px}',
      '@media(min-width:1024px){body.ah-host-mode #cockpit-screen{max-width:1180px!important;padding-left:28px!important;padding-right:28px!important}',
      'body.ah-host-mode #bottom-nav{max-width:980px!important;bottom:18px!important;border:1px solid rgba(104,236,225,.16)!important;border-radius:24px!important;box-shadow:0 22px 70px rgba(0,0,0,.55)!important}',
      'body.ah-host-mode #bottom-nav .nav-label{font-size:11px!important}',
      'body.ah-host-mode .v2-space-heading h1{font-size:48px!important}',
      'body.ah-host-mode .v2-space-heading p{font-size:17px!important}',
      'body.ah-host-mode #tab-backstage #backstage-content{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}',
      'body.ah-host-mode #tab-backstage .bs-waiting,body.ah-host-mode #tab-backstage .bs-end{grid-column:1/-1}',
      'body.ah-host-mode #tab-hub .moi-dashboard,body.ah-host-mode #tab-memories .story-main{max-width:none!important}',
      'body.ah-host-mode .soiree-now-card{padding:28px!important}}',
      '#backstage-nav-btn[hidden]{display:none!important}',
      '#backstage-content{display:grid;gap:14px}',
      '#backstage-content .bs-card{position:relative;overflow:hidden;padding:18px;border:1px solid rgba(85,239,224,.2);border-radius:22px;background:linear-gradient(135deg,rgba(4,39,52,.92),rgba(34,18,60,.92));box-shadow:0 16px 38px rgba(0,0,0,.18)}',
      '#backstage-content .bs-card:before{content:"";position:absolute;inset:-60% auto auto -20%;width:170px;height:170px;border-radius:50%;background:#28e4d51c;filter:blur(12px);pointer-events:none}',
      '#backstage-content .bs-card h2{position:relative;margin:0 0 5px;color:#fff;font:900 17px Outfit,sans-serif;letter-spacing:.04em}',
      '#backstage-content .bs-card p{position:relative;margin:0;color:#9aa7bd;font:600 13px Outfit,sans-serif}',
      '#backstage-content .bs-head{display:flex;align-items:center;gap:10px}',
      '#backstage-content .bs-count{margin-left:auto;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#39e8d8;color:#05161e;font:900 15px Outfit,sans-serif}',
      '#backstage-content .bs-items{display:grid;gap:8px;margin-top:10px}',
      '#backstage-content .bs-item{display:flex;align-items:center;gap:10px;padding:11px;border-radius:14px;background:rgba(0,0,0,.18);color:#eef3fb;font:700 12px Outfit,sans-serif}',
      '#backstage-content .bs-item span{flex:1}',
      '#backstage-content .bs-delete{border:0;border-radius:999px;padding:8px 10px;color:#ff7f9d;background:rgba(255,65,105,.12);font:800 9px Outfit,sans-serif}',
      '#backstage-content .bs-waiting-empty{margin-top:12px;padding:12px;border-radius:14px;background:rgba(0,0,0,.16);color:#b9c4d4;font:700 12px Outfit,sans-serif}',
      '#backstage-content .bs-guest{display:grid;grid-template-columns:42px minmax(0,1fr);gap:10px;align-items:center;margin-top:11px;padding:12px;border-radius:16px;background:rgba(0,0,0,.2)}',
      '#backstage-content .bs-avatar{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#39e8d8,#f45bc2);color:#07151d;font:900 16px Outfit,sans-serif}',
      '#backstage-content .bs-identity strong,#backstage-content .bs-identity small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#backstage-content .bs-identity strong{font:800 13px Outfit,sans-serif;color:#fff}',
      '#backstage-content .bs-identity small{margin-top:2px;color:#8e9aaf;font:600 10px Outfit,sans-serif}',
      '#backstage-content .bs-actions{grid-column:1/-1;display:flex;gap:8px}',
      '#backstage-content .bs-approve{flex:1;border:0;border-radius:12px;padding:11px;background:#39e8d8;color:#06151d;font:900 11px Outfit,sans-serif}',
      '#backstage-content .bs-deny{width:44px;border:0;border-radius:12px;background:rgba(255,91,139,.14);color:#ff76a1;font:900 13px Outfit,sans-serif}',
      '#backstage-content .bs-visibility{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:12px}',
      '#backstage-content .bs-vis{display:grid;gap:5px;place-items:center;min-width:0;padding:12px 4px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.04);color:#aab5c7;font:900 10px Outfit,sans-serif;cursor:pointer}',
      '#backstage-content .bs-vis i{font-style:normal;font-size:17px}',
      '#backstage-content .bs-vis.is-active{border-color:#39e8d8;background:#39e8d8;color:#06151d;box-shadow:0 0 20px rgba(57,232,216,.2)}',
      '#backstage-content .bs-vis-copy{margin-top:10px!important;font-size:11px!important}',
      '#backstage-content .bs-end{width:100%;padding:14px;border:1px solid rgba(255,77,128,.5);border-radius:14px;background:rgba(255,77,128,.12);color:#ff6b9d;font:900 13px Outfit,sans-serif}'
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
    document.body.classList.toggle('ah-host-mode', host);
    var backstageNav = document.getElementById('backstage-nav-btn');
    if (backstageNav) backstageNav.hidden = !host;
    var backstageTab = document.getElementById("tab-backstage");
    if (backstageTab) backstageTab.hidden = !host;
    if (!host && document.getElementById('tab-backstage')?.classList.contains('active') && typeof showTab === 'function') showTab('on-air');
    if (host !== lastHost) {
      lastHost = host;
      if (host) console.log('[host-mode] On Air host — transport au-dessus des votes');
    }
    if (host) bindWaitingRoom();
  }

  function activeSocket() {
    try { return typeof socket !== 'undefined' ? socket : null; } catch (e) { return null; }
  }

  function emitHostCommand(eventName, payload, callback) {
    var engine = window.AhOuaiHostEngine;
    if (engine && typeof engine.emitHost === 'function' && engine.emitHost(eventName, payload, callback)) return true;
    toast('Session Host indisponible');
    return false;
  }

  function bindWaitingRoom() {
    var sck = activeSocket();
    if (!sck || sck === waitingRoomSocket || typeof sck.on !== 'function') return;
    waitingRoomSocket = sck;
    sck.on('host:pendingGuestRequest', function (payload) {
      if (!payload || !payload.userId) return;
      pendingGuests = pendingGuests.filter(function (g) { return String(g.userId) !== String(payload.userId); });
      pendingGuests.push(payload);
      renderBackstage();
      toast('Quelqu’un attend à la porte');
    });
  }

  function decidePendingGuest(userId, approve) {
    var eventName = approve ? 'host:approveGuest' : 'host:denyGuest';
    emitHostCommand(eventName, { userId: userId }, function (reply) {
      if (reply && reply.ok === false) return toast(reply.error || 'Action impossible');
      pendingGuests = pendingGuests.filter(function (g) { return String(g.userId) !== String(userId); });
      if (typeof state !== 'undefined' && state && Array.isArray(state.pendingGuests)) {
        state.pendingGuests = state.pendingGuests.filter(function (g) { return String(g.userId) !== String(userId); });
      }
      renderBackstage();
      toast(approve ? 'Invité accepté' : 'Demande refusée');
    });
  }

  function updateVisibility(visibility) {
    emitHostCommand('host:updateVisibility', { visibility: visibility }, function (reply) {
      if (!reply || reply.ok === false) return toast((reply && reply.error) || 'Action impossible');
      if (typeof state !== 'undefined' && state) state.visibility = visibility;
      renderBackstage();
      toast('Accès de la soirée mis à jour');
    });
  }

  function renderBackstage() {
    if (!isHostMode()) return;
    var mount = document.getElementById('backstage-content'); if (!mount) return;
    var s = (typeof state !== 'undefined' && state) ? state : {};
    var participants = Array.isArray(s.participants) ? s.participants : [];
    var photos = Array.isArray(s.allPhotos) ? s.allPhotos : [];
    var messages = Array.isArray(s.liveMessages) ? s.liveMessages : [];
    var visibility = ['private','friends','public'].indexOf(s.visibility) >= 0 ? s.visibility : 'private';
    if (Array.isArray(s.pendingGuests)) pendingGuests = s.pendingGuests.slice();
    function safe(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
    var photoRows = photos.slice(-4).reverse().map(function(p){ var idx = photos.indexOf(p); return '<div class="bs-item"><span>📷 '+safe(p.guestName || 'Invité')+'</span><button class="bs-delete" data-photo-index="'+idx+'" data-photo-id="'+safe(p.id || p._id || '')+'" data-photo-url="'+safe(p.url || p.dataURL || '')+'">SUPPRIMER</button></div>'; }).join('');
    var messageRows = messages.slice(-4).reverse().map(function(m){ return '<div class="bs-item"><span>💬 '+safe(m.guestName || 'Invité')+' — '+safe(m.message || '')+'</span><button class="bs-delete" data-message-id="'+safe(m.id || '')+'">SUPPRIMER</button></div>'; }).join('');
    var waitingRows = pendingGuests.map(function(g) {
      var name = ((g.firstName || '')+' '+(g.lastName || '')).trim() || 'Nouvel invité';
      return '<div class="bs-guest"><div class="bs-avatar">'+safe(name.slice(0,1).toUpperCase())+'</div><div class="bs-identity"><strong>'+safe(name)+'</strong><small>'+safe(g.email || 'Demande de rejoindre')+'</small></div><div class="bs-actions"><button class="bs-approve" data-approve="'+safe(g.userId)+'">FAIRE ENTRER</button><button class="bs-deny" data-deny="'+safe(g.userId)+'" aria-label="Refuser">✕</button></div></div>';
    }).join('');
    mount.innerHTML =
      '<section class="bs-card bs-waiting"><div class="bs-head"><div><h2>🚪 SALLE D’ATTENTE</h2><p>C’est toi qui ouvres la porte.</p></div><span class="bs-count">'+pendingGuests.length+'</span></div>'+(waitingRows || '<div class="bs-waiting-empty">✓ Personne n’attend. La porte est fluide.</div>')+'</section>'+
      '<section class="bs-card"><h2>👁 QUI PEUT REJOINDRE ?</h2><div class="bs-visibility">'+
        '<button class="bs-vis '+(visibility==='private'?'is-active':'')+'" data-visibility="private"><i>🔒</i>PRIVÉE</button>'+
        '<button class="bs-vis '+(visibility==='friends'?'is-active':'')+'" data-visibility="friends"><i>👥</i>AMIS</button>'+
        '<button class="bs-vis '+(visibility==='public'?'is-active':'')+'" data-visibility="public"><i>🌐</i>PUBLIQUE</button>'+
      '</div><p class="bs-vis-copy">'+(visibility==='private'?'Chaque nouvelle personne attend ton accord.':visibility==='public'?'Toute personne avec le lien ou le QR code entre directement.':'Ton crew entre directement ; les autres attendent ton accord.')+'</p></section>'+
      '<section class="bs-card"><h2>👥 LE CREW</h2><p>'+participants.length+' personne'+(participants.length>1?'s':'')+' dans la soirée.</p></section>'+
      '<section class="bs-card"><h2>📸 PHOTOS & MOTS</h2><p>'+photos.length+' photos · '+messages.length+' mots</p><div class="bs-items">'+(photoRows+messageRows || '<p>Rien à modérer pour le moment.</p>')+'</div></section>'+
      '<button class="bs-end" id="bs-end-party">TERMINER LA SOIRÉE</button>';
    mount.querySelectorAll('[data-photo-index]').forEach(function(btn){ btn.addEventListener('click', function(){ emitHostCommand('host:deletePhoto',{photoId:btn.dataset.photoId,url:btn.dataset.photoUrl,index:Number(btn.dataset.photoIndex)},function(reply){ if(!reply||reply.ok===false)return toast((reply&&reply.error)||'Suppression impossible'); toast('Photo supprimée'); }); }); });
    mount.querySelectorAll('[data-message-id]').forEach(function(btn){ btn.addEventListener('click', function(){ emitHostCommand('host:deleteMessage',{id:btn.dataset.messageId},function(reply){ if(!reply||reply.ok===false)return toast((reply&&reply.error)||'Suppression impossible'); toast('Mot supprimé'); }); }); });
    mount.querySelectorAll('[data-approve]').forEach(function(btn){ btn.addEventListener('click', function(){ decidePendingGuest(btn.dataset.approve, true); }); });
    mount.querySelectorAll('[data-deny]').forEach(function(btn){ btn.addEventListener('click', function(){ decidePendingGuest(btn.dataset.deny, false); }); });
    mount.querySelectorAll('[data-visibility]').forEach(function(btn){ btn.addEventListener('click', function(){ updateVisibility(btn.dataset.visibility); }); });
    window.mountCommunityBackstage?.(mount);
    var end = mount.querySelector('#bs-end-party'); if (end) end.addEventListener('click', function(){
      if (!window.confirm('Terminer la soirée maintenant ?')) return;
      var e=window.AhOuaiHostEngine;
      if (e && e.endParty) e.endParty(); else toast('La soirée ne peut pas être terminée pour le moment');
    });
  }

  function boot() { if (booted) return; booted = true; sync(); setInterval(sync, 1200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.AhOuaiHostMode = { isHostMode: isHostMode, sync: sync, renderBackstage: renderBackstage };
})();
