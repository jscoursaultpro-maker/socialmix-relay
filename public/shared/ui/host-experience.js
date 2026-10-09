/* Host-only experience B. Reuses guest community surfaces and existing host commands.
 * No mutations or API calls while the current party is not owned by this host. */
(() => {
  'use strict';
  if (window.AhOuaiHostExperience) return;
  const $ = id => document.getElementById(id);
  const on = () => !!window.AhOuaiHostMode?.isHostMode();
  const engine = () => window.AhOuaiHostEngine;
  const current = () => typeof state === 'undefined' ? {} : state;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = (text, action, cls) => { const b = el('button', text, cls); b.type = 'button'; b.onclick = () => { if (on()) action(); }; return b; };
  const additions = new Set();
  const labels = new Map();
  const pendingCommands = new Set();
  let snapshot = null, partyCode = null, loading = false, lastFetch = 0, dialog = null;
  let boardSignature = '', touchSignature = '', crewSignature = '';
  const own = n => { additions.add(n); return n; };
  const photo = (url, name) => {
    const avatar = el('span', name?.slice(0, 1)?.toUpperCase() || '♪', 'hx-avatar');
    if (url && /^(https?:|data:image\/|\/)/.test(url)) { const img = el('img'); img.src = url; img.alt = ''; img.onerror = () => img.remove(); avatar.append(img); }
    return avatar;
  };
  function rename(n, text) { if (!n || n.textContent === text) return; if (!labels.has(n)) labels.set(n, n.textContent); n.textContent = text; }
  function feedback(text) {
    if (dialog?.open) { let p = dialog.querySelector('.hx-feedback'); if (!p) { p = el('p', '', 'hx-feedback'); p.setAttribute('role', 'status'); dialog.append(p); } p.textContent = text; }
    else if (typeof showToast === 'function') showToast(text, 4000);
  }
  function closeDialog() { if (dialog) { dialog.close(); dialog.remove(); additions.delete(dialog); dialog = null; } }
  function panel(title) {
    closeDialog(); dialog = own(el('dialog', '', 'hx-dialog'));
    const close = button('Fermer', closeDialog, 'hx-close'); dialog.append(close, el('h1', title)); document.body.append(dialog); dialog.showModal(); return dialog;
  }
  function endParty() {
    if (!on()) return;
    const d = panel('Terminer la soirée ?');
    d.append(el('p', 'La musique s’arrête. Les moments partagés restent dans Best Of.'), button('Terminer la soirée', () => {
      if (engine()?.endParty?.()) closeDialog(); else feedback('La connexion hôte est indisponible. Réessaie.');
    }, 'hx-danger'), button('Annuler', closeDialog));
  }
  function returnToMenu() { closeDialog(); if (typeof showScreen === 'function') showScreen('choice'); }
  function door() {
    if (!on()) return;
    const d = panel('Ta soirée');
    d.append(button('Revenir au menu', returnToMenu), el('p', 'La soirée reste en cours.'), button('Terminer la soirée', endParty, 'hx-danger'), button('Annuler', closeDialog));
  }
  function communityBackstage() {
    const mount = el('div'); window.mountCommunityBackstage?.(mount);
    const trigger = mount.querySelector('button');
    if (trigger) trigger.click(); else feedback('La gestion des signalements se charge. Réessaie.');
  }
  function reportHub() {
    const d = panel('Signalements');
    d.append(button('Mes contenus signalés', () => { closeDialog(); document.querySelector('.community-safety')?.click(); }),
      button('Signalements à traiter · Backstage', () => { closeDialog(); communityBackstage(); }));
  }
  function seenKey(data) { return `ahouai_warning_read_${current().partyCode}_${data.me}`; }
  function seen(data) { try { return new Set(JSON.parse(localStorage.getItem(seenKey(data)) || '[]')); } catch { return new Set(); } }
  function warnings(data) { return (data?.warnings || []).filter(w => !['dismissed', 'removed', 'resolved'].includes(w.status)); }
  function markViewedReports() {
    if (!snapshot) return;
    const surface = document.querySelector('.community-dialog[open]');
    const title = surface?.querySelector('h1')?.textContent;
    let ids = [];
    if (title === 'Backstage · garder l’ambiance') ids = (snapshot.alerts || []).map(a => a.id);
    else if (title === 'Prévenir l’organisateur') ids = warnings(snapshot).map(a => a.id);
    if (ids.length) { const read = seen(snapshot); ids.forEach(id => read.add(String(id))); try { localStorage.setItem(seenKey(snapshot), JSON.stringify([...read])); } catch {} }
  }
  function badge(target, count) {
    if (!target) return;
    let b = target.querySelector('.hx-warning');
    if (!count) { b?.remove(); return; }
    if (!b) { b = own(el('span', '!', 'hx-warning')); target.prepend(b); }
    b.setAttribute('aria-label', `${count} signalements non consultés`);
  }
  function updateBadges() {
    if (!snapshot) return;
    markViewedReports();
    const read = seen(snapshot), alerts = (snapshot.alerts || []).filter(x => !read.has(String(x.id)));
    const count = new Set([...warnings(snapshot), ...alerts].filter(x => !read.has(String(x.id))).map(x => String(x.id))).size;
    badge(document.querySelector('[data-nav="moi"]'), count);
    badge($('hx-reports'), count); badge($('backstage-nav-btn'), alerts.length);
  }
  async function refresh() {
    if (!on() || loading || document.hidden) return;
    const p = engine()?._debug?.().party;
    if (!p?.code || p.code !== current().partyCode || !p.hostSecret) return;
    loading = true; lastFetch = Date.now();
    try {
      const r = await fetch(`/api/party/${encodeURIComponent(p.code)}/community`, { headers: { 'X-Host-Secret': p.hostSecret } });
      if (!r.ok) throw new Error('Communauté indisponible');
      const data = await r.json();
      if (!on() || current().partyCode !== p.code) return;
      snapshot = data; sync();
    } catch { /* Existing surfaces provide retry feedback; keep last known data. */ }
    finally { loading = false; }
  }
  function mountHeader() {
    if ($('hx-header') || !$('cockpit-screen')) return;
    const h = own(el('header', '', 'hx-header')); h.id = 'hx-header';
    const brand = button('', returnToMenu, 'hx-brand'); brand.setAttribute('aria-label', 'AhOuai · revenir au menu');
    const logo = el('img'); logo.src = '/assets/brand/ahouai-o-mark.png'; logo.alt = 'AhOuai'; brand.append(logo);
    const qr = button('', () => { if (typeof showPartyQR === 'function') showPartyQR(); }, 'hx-qr'); qr.setAttribute('aria-label', 'Afficher le QR code et inviter des amis');
    const icon = document.querySelector('#show-qr-btn svg'); if (icon) qr.append(icon.cloneNode(true)); else qr.textContent = 'QR';
    const actions = el('div', '', 'hx-header-actions');
    const exit = button('♧', door, 'hx-door'); exit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21V3h13v18M4 3l9 3v15M17 21h3M10 12v2"/></svg>'; exit.setAttribute('aria-label', 'Menu de la soirée');
    const profile = button('', () => $('edit-profile-btn')?.click(), 'hx-profile'); profile.id = 'hx-profile'; profile.setAttribute('aria-label', 'Mon profil');
    actions.append(exit, profile); h.append(brand, qr, actions); $('cockpit-screen').prepend(h);
  }
  function touch() {
    const s = current(), me = snapshot?.people?.find(p => p.userId === snapshot.me) || s.participants?.find(p => p.isHost) || {};
    const name = me.name || s.guestName || 'Hôte', url = me.photoURL || me.photo || s.guestPhoto;
    const rankings = [...(s.leaderboard || [])].sort((a,b) => b.points - a.points);
    const identity = p => String(p.participantId || p.userId || (p.id === 'host' ? snapshot?.me || s.userId : p.id) || '');
    const rank = rankings.findIndex(p => identity(p) === String(snapshot?.me || s.userId) || p.id === 'host');
    const signature = JSON.stringify([name,url,rank,rankings[rank]?.points]);
    const mount = $('my-touch-contributions');
    if (mount && (!$('hx-touch-heading') || signature !== touchSignature)) {
      $('hx-touch-heading')?.remove(); const h = own(el('section', '', 'hx-touch-heading')); h.id = 'hx-touch-heading';
      const text = el('div'); text.append(el('h2', `La Touch de ${name}`), el('p', `${rank >= 0 ? rankings[rank].points : s.missionPoints || 0} points${rank >= 0 ? ` · #${rank + 1}` : ''}`));
      h.append(photo(url,name), text); mount.before(h); touchSignature = signature;
    }
    const profile = $('hx-profile');
    if (profile && profile.dataset.signature !== JSON.stringify([url,name])) { profile.replaceChildren(photo(url,name)); profile.dataset.signature = JSON.stringify([url,name]); }
    const report = $('hx-reports');
    if (!report && $('moi-overview')) { const b = own(button('Signalé · contenus et signalements', reportHub, 'hx-return')); b.id = 'hx-reports'; $('moi-overview').before(b); }
    if (!$('hx-touch-actions') && $('quit-btn')) {
      const row = own(el('div', '', 'hx-touch-actions')); row.id = 'hx-touch-actions';
      row.append(button('Revenir au menu', returnToMenu, 'hx-return'),button('Terminer la soirée', endParty, 'hx-danger')); $('quit-btn').before(row);
    }
    document.querySelectorAll('#my-touch-contributions .touch-collapse strong, .community-dialog .touch-collapse strong').forEach(n => {
      const label = n.textContent.replace(/\b(?:Mes|mes|Ses|ses)\b/g, (v, offset) => offset === 0 ? 'Les' : 'les'); rename(n,label);
    });
    const title = document.querySelector('.community-dialog h1');
    if (title?.textContent === 'My Touch') rename(title,`La Touch de ${name}`);
    else if (title?.textContent.startsWith('My Touch de ')) rename(title,title.textContent.replace('My Touch de ','La Touch de '));
    const rankingMount = document.querySelector('.moi-ranking-panel');
    const rankingKey = JSON.stringify([rankings,snapshot?.people]);
    if (rankingMount && (!$('hx-ranking') || boardSignature !== rankingKey)) {
      const wasOpen = $('hx-ranking')?.querySelector('details')?.open; $('hx-ranking')?.remove();
      const card = own(el('section','','hx-card'));card.id='hx-ranking';card.append(el('h2','Classement'));
      const details=el('details'), summary=el('summary','Voir tout le classement');details.append(summary); details.open=!!wasOpen;
      rankings.forEach((p,i)=>{const id=identity(p), person=snapshot?.people?.find(x=>String(x.userId)===id) || s.participants?.find(x=>String(x.userId)===id)||{};
        const b=button('',()=>{if(id)window.openParticipantTouch?.(id);},'hx-person');
        b.append(el('b',`#${i+1}`),photo(person.photoURL||person.photo,p.name),el('span',`${p.name || 'Invité'}${id===String(snapshot?.me||s.userId)?' · Moi':''}`),el('strong',`${p.points||0} pts`));(i<3?card:details).append(b);
      });
      if(!rankings.length)card.append(el('p','Le classement apparaîtra avec les premières participations.'));if(rankings.length>3)card.append(details);
      rankingMount.after(card);boardSignature=rankingKey;
    }
    const crew = (snapshot?.people || s.participants || []).filter(p=>!p.departedAt&&String(p.userId)!==String(snapshot?.me||s.userId)&&!p.isHost);
    const circle = document.querySelector('.moi-circle-panel'), crewKey=JSON.stringify(crew);
    if(circle&&(!$('hx-circle')||crewSignature!==crewKey)){
      $('hx-circle')?.remove();const card=own(el('section','','hx-card'));card.id='hx-circle';card.append(el('h2','Mes amis ce soir'));
      const grid=el('div','','hx-people');crew.forEach(p=>{const b=button('',()=>window.openParticipantTouch?.(p.userId),'hx-person');b.append(photo(p.photoURL||p.photo,p.name),el('span',p.name||'Invité'));grid.append(b);});
      if(!crew.length)grid.append(el('p','Les participants apparaîtront ici dès leur arrivée.'));card.append(grid,button('Voir mes amis →',()=>{if(typeof openMyFriendsScreen==='function')openMyFriendsScreen();}));circle.after(card);crewSignature=crewKey;
    }
  }
  function command(event,payload,after) {
    if(!on())return;
    const commandKey=JSON.stringify([event,payload]);if(pendingCommands.has(commandKey))return;pendingCommands.add(commandKey);
    let settled=false;
    const timer=setTimeout(()=>{if(!settled){settled=true;pendingCommands.delete(commandKey);feedback('Pas de confirmation reçue. Vérifie la connexion avant de réessayer.');}},10000);
    const sent=engine()?.emitHost?.(event,payload,reply=>{if(settled)return;settled=true;pendingCommands.delete(commandKey);clearTimeout(timer);if(!reply?.ok){feedback(reply?.error||'Action impossible. Réessaie.');return;}after?.();});
    if(!sent){settled=true;pendingCommands.delete(commandKey);clearTimeout(timer);feedback('Session hôte indisponible.');}
  }
  function renderBackstage(mount,s) {
    if(!on())return;
    const key=JSON.stringify([s.pendingGuests,s.visibility,s.participants,s.allPhotos,s.liveMessages]);
    if(mount.dataset.hxSignature===key&&mount.querySelector('.hx-backstage'))return;
    const expanded = new Set([...mount.querySelectorAll('details[open]')].map(n=>n.dataset.person));
    mount.dataset.hxSignature=key;mount.replaceChildren();const wrap=el('div','','hx-backstage');mount.append(wrap);
    const card=title=>{const n=el('section','','hx-card');n.append(el('h2',title));wrap.append(n);return n;};
    const waiting=card('Salle d’attente'),requests=s.pendingGuests||[];waiting.append(el('p',`${requests.length} personne${requests.length>1?'s':''} en attente. C’est toi qui ouvres la porte.`));
    requests.forEach(p=>{const row=el('div','','hx-person');row.append(photo(p.photoURL||p.photo,p.firstName),el('span',p.name||[p.firstName,p.lastName].filter(Boolean).join(' ')||'Invité'));
      const decide=approve=>command(approve?'host:approveGuest':'host:denyGuest',{userId:p.userId},()=>{s.pendingGuests=requests.filter(x=>x.userId!==p.userId);current().pendingGuests=s.pendingGuests;renderBackstage(mount,s);});
      row.append(button('Faire entrer',()=>decide(true)),button('Refuser',()=>decide(false)));waiting.append(row);});
    const visibility=card('Qui peut rejoindre ?');
    const choices=el('div','','hx-visibility');[['private','Privée'],['friends','Amis'],['public','Publique']].forEach(([value,label])=>{const b=button(label,()=>command('host:updateVisibility',{visibility:value},()=>{current().visibility=value;s.visibility=value;renderBackstage(mount,s);}));b.setAttribute('aria-pressed',String((s.visibility||'private')===value));choices.append(b);});visibility.append(choices,el('p',s.visibility==='public'?'Le lien ou le QR permet de rejoindre directement.':s.visibility==='friends'?'Tes amis entrent directement ; les autres attendent ton accord.':'Chaque nouvelle personne attend ton accord.'));
    const guests=card('Les invités'),people=(s.participants||[]).filter(p=>!p.departedAt);guests.append(el('p',`${people.length} personnes dans la soirée`));
    people.forEach(p=>{const row=button('',()=>{if(p.userId)window.openParticipantTouch?.(p.userId);},'hx-person');row.append(photo(p.photoURL||p.photo,p.name),el('span',`${p.name||'Invité'}${p.isHost?' · Moi':''}`));guests.append(row);});guests.append(button('Inviter des amis · QR code',()=>{if(typeof showPartyQR==='function')showPartyQR();}));
    const reports=card('Respect & présence');reports.append(el('p','Consulte les avertissements, gère les accès et les signalements.'),button('Gérer les invités et signalements',communityBackstage));
    const contents=card('Photos & mots'),groups=new Map();
    for(const [kind,items] of [['photo',s.allPhotos||[]],['message',s.liveMessages||[]]])items.forEach((item,index)=>{
      const userId=item.authorUserId||item.userId||item.guestId;const p=userId?people.find(p=>String(p.userId)===String(userId)||String(p.id)===String(userId)):null;
      const name=p?.name||item.guestName||'Invité', id=userId||`legacy:${name}`;
      if(!groups.has(id))groups.set(id,{name,person:p,items:[]});groups.get(id).items.push({kind,item,index});
    });
    if(!groups.size)contents.append(el('p','Les photos et mots partagés apparaîtront ici.'));
    groups.forEach((g,id)=>{const d=el('details');d.dataset.person=String(id);d.open=expanded.has(String(id));const summary=el('summary');summary.append(photo(g.person?.photoURL||g.person?.photo,g.name),el('span',`${g.name} · ${g.items.length} contenus`));d.append(summary);
      g.items.forEach(({kind,item,index})=>{const row=el('article','','hx-content');row.append(el('strong',kind==='photo'?'Photo':'Mot'));
        if(kind==='photo'){const image=el('img');image.src=item.url||item.dataURL||'';image.alt=`Photo partagée par ${g.name}`;image.loading='lazy';row.append(image);}else row.append(el('p',item.message||item.text||''));
        row.append(button('Supprimer',()=>{const modal=panel(kind==='photo'?'Supprimer cette photo ?':'Supprimer ce mot ?');modal.append(el('p',`Contenu de ${g.name}`),button('Confirmer la suppression',()=>{
          command(kind==='photo'?'host:deletePhoto':'host:deleteMessage',kind==='photo'?{photoId:item.id||item._id||'',url:item.url||item.dataURL,index}:{id:item.id},()=>{closeDialog();const field=kind==='photo'?'allPhotos':'liveMessages';current()[field]=(current()[field]||[]).filter(x=>x!==item);s[field]=current()[field];renderBackstage(mount,s);});
        },'hx-danger'),button('Annuler',closeDialog));},'hx-danger'));d.append(row);
      });contents.append(d);
    });
    wrap.append(button('Revenir au menu',returnToMenu,'hx-return'),button('Terminer la soirée',endParty,'hx-danger'));
  }
  function cleanup() {
    additions.forEach(n=>{if(n.tagName==='DIALOG'&&n.open)n.close();n.remove();});additions.clear();
    labels.forEach((text,n)=>{if(n.isConnected)n.textContent=text;});labels.clear();
    document.body.classList.remove('hx-host-experience');
    snapshot=null;partyCode=null;dialog=null;touchSignature='';boardSignature='';crewSignature='';lastFetch=0;
  }
  function sync() {
    if(!on()){if(partyCode)cleanup();return;}
    if(partyCode!==current().partyCode){cleanup();partyCode=current().partyCode;}
    document.body.classList.add('hx-host-experience');
    additions.forEach(n=>{if(!n.isConnected)additions.delete(n);});
    labels.forEach((_,n)=>{if(!n.isConnected)labels.delete(n);});
    mountHeader();touch();updateBadges();
    const memories = $('tab-memories');
    if(memories&&!$('hx-bestof-tools')){const tools=own(el('div','','hx-touch-actions'));tools.id='hx-bestof-tools';tools.append(button('Modérer les photos et les mots',()=>{if(typeof showTab==='function')showTab('backstage');}));memories.append(tools);}
    if(Date.now()-lastFetch>5000)refresh();
  }
  const css=el('link');css.rel='stylesheet';css.href='/shared/ui/host-experience.css';document.head.append(css);
  window.AhOuaiHostExperience={sync,renderBackstage,openDoor:door,refresh};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&on())refresh();});
  setInterval(sync,1000);sync();window.AhOuaiHostMode?.renderBackstage?.();
})();
