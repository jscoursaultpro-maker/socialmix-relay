(() => {
  let planned = false, busy = false, activeParty = null;
  const byId = id => document.getElementById(id);
  const secrets = () => { try { return JSON.parse(localStorage.getItem('ahouai_planned_secrets') || '{}'); } catch { return {}; } };
  async function api(path, method = 'GET', body, code) {
    const token = typeof getProfileJwt === 'function' ? await getProfileJwt() : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (code && secrets()[code]) headers['X-Host-Secret'] = secrets()[code];
    const response = await fetch(`/api/party/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'La demande n’a pas abouti. Réessaie.');
    return data;
  }
  function node(tag, text, className) {
    const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el;
  }
  function button(text, action) { const el = node('button', text); el.type = 'button'; el.onclick = action; return el; }
  function notify(error) { if (typeof showToast === 'function') showToast(error.message || error, 5000); }
  function dateText(value) { return new Date(value).toLocaleString('fr-FR', { weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit' }); }
  function dateValue(date) { const d = new Date(date); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16); }
  window.isPartyPlanned = () => planned;
  window.setupPartyTiming = provider => {
    planned = false;
    byId('cd-provider-name').textContent = ({spotify:'Spotify',apple:'Apple Music',youtube:'YouTube'}[provider] || 'Votre musique');
    byId('cd-date').value = dateValue(Date.now() + 86400000);
    byId('cd-date').min = dateValue(Date.now() + 60000);
    byId('cd-message').value = '';
    timing(false);
  };
  function timing(later) {
    planned = later;
    byId('cd-schedule-fields').hidden = !later;
    byId('cd-launch').textContent = later ? 'Créer mon invitation ✨' : 'Lancer la soirée ✨';
    byId('cd-mode-hint').textContent = later ? 'Les inscriptions sont ouvertes. La musique attendra ton lancement. Les demandes seront à accepter dans ta soirée planifiée.' : 'Tes amis rejoignent par lien ou QR code, sans rien installer.';
    byId('cd-visibility').closest('.cd-field').hidden = later;
    byId('cd-timing').querySelectorAll('button').forEach(b => b.classList.toggle('is-on', (b.dataset.timing === 'later') === later));
  }
  byId('cd-timing')?.addEventListener('click', event => { const b = event.target.closest('[data-timing]'); if (b) timing(b.dataset.timing === 'later'); });
  async function compressedCover(dataURL) {
    if (!dataURL) return null;
    const img = new Image(); img.src = dataURL; await img.decode();
    const scale = Math.min(1,1200 / Math.max(img.width,img.height));
    const canvas = document.createElement('canvas'); canvas.width = img.width * scale; canvas.height = img.height * scale;
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    for (const quality of [.75,.55,.35,.2]) { const result = canvas.toDataURL('image/jpeg',quality); if(result.length < 665000) return result; }
    throw new Error('Choisis une photo plus légère.');
  }
  window.cropPartyCover = async dataURL => {
    const img=new Image(); img.src=dataURL; await img.decode();
    return new Promise(resolve=>{
      const modal=node('dialog',null,'cover-crop-dialog');
      modal.append(node('h2','La bonne photo, le bon cadre'),node('p','Zoome et ajuste le cadrage de ta couverture.'));
      const canvas=node('canvas');canvas.width=960;canvas.height=600;modal.append(canvas);
      const values={zoom:1,x:.5,y:.5};
      function draw(){const scale=Math.max(960/img.width,600/img.height)*values.zoom;const w=img.width*scale,h=img.height*scale;canvas.getContext('2d').drawImage(img,(960-w)*values.x,(600-h)*values.y,w,h);}
      for(const [key,title,min,max,step] of [['zoom','Zoom',1,3,.01],['x','Position horizontale',0,1,.01],['y','Position verticale',0,1,.01]]){
        const label=node('label',title),input=node('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=values[key];input.oninput=()=>{values[key]=Number(input.value);draw();};label.append(input);modal.append(label);
      }
      let finished=false;function finish(value){if(finished)return;finished=true;modal.close();modal.remove();resolve(value);}
      modal.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
      const actions=node('div',null,'preparation-actions');actions.append(button('Annuler',()=>finish(null)),button('Utiliser ce cadrage',()=>finish(canvas.toDataURL('image/jpeg',.8))));modal.append(actions);document.body.append(modal);modal.showModal();draw();
    });
  };
  window.scheduleCurrentParty = async () => {
    if (busy) return;
    const date = new Date(byId('cd-date').value);
    if (!Number.isFinite(date.getTime()) || date <= new Date()) return notify('Choisis une date à venir.');
    busy = true; byId('cd-launch').disabled = true;
    try {
      const code = [...crypto.getRandomValues(new Uint8Array(6))].map(x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
      const hostSecret = crypto.randomUUID();
      const coverPhoto = await compressedCover(typeof _createCoverB64 !== 'undefined' ? _createCoverB64 : null);
      const data = await api('schedule','POST',{ code, hostSecret, scheduledFor:date.toISOString(), partyName:byId('cd-name').value.trim() || 'Une soirée ensemble', welcomeText:byId('cd-message').value, coverPhoto });
      const saved = secrets(); saved[code] = hostSecret; localStorage.setItem('ahouai_planned_secrets',JSON.stringify(saved));
      showScreen('choice'); await loadList(); await openParty(data.party.code);
    } catch(error) { notify(error); }
    finally { busy=false; byId('cd-launch').disabled=false; }
  };
  const choice = byId('choice-screen');
  const home = node('section',null,'preparation-home');
  home.append(node('h3','Soirées planifiées'));
  const list = node('div'); home.append(list,button('Voir mes soirées planifiées', loadList));
  (choice?.querySelector('.choice-actions-panel') || choice?.querySelector('.landing-container') || choice)?.append(home);
  async function loadList() {
    list.replaceChildren(node('p','Chargement…','preparation-empty'));
    try {
      if (!Object.keys(secrets()).length && !(typeof getProfileJwt === 'function' && await getProfileJwt())) { list.replaceChildren(node('p','Connecte-toi pour retrouver tes soirées planifiées.','preparation-empty')); return; }
      const data = await api('scheduled/list','POST',{hostSecrets:Object.values(secrets())});
      list.replaceChildren();
      if (!data.parties.length && !data.invitations?.length) list.append(node('p','Le prochain moment commence par une invitation.','preparation-empty'));
      (data.invitations || []).forEach(p => {
        const card=button('',()=>{ location.href=`/?code=${encodeURIComponent(p.code)}`; });card.className='planned-card';
        const text=node('div',`Tu es invité(e) · ${p.partyName}`);text.append(node('span',`${dateText(p.scheduledFor)} · Confirmer ma participation →`));card.append(text);list.append(card);
      });
      data.parties.forEach(p => {
        const card = button('',() => openParty(p.code)); card.className='planned-card';
        const image = node('img'); image.src=p.coverPhoto || 'assets/brand/host-party-discovery.jpg'; image.alt='';
        const text=node('div',p.partyName);text.append(node('span',`${dateText(p.scheduledFor)} · ${p.participantCount} inscrits · ${p.pendingCount} demandes`));card.append(image,text);list.append(card);
      });
    } catch(error) { list.replaceChildren(node('p',error.message,'preparation-error')); }
  }
  const dialog = node('dialog',null,'preparation-dialog');document.body.append(dialog);
  async function openParty(code) {
    try {
      activeParty = await api(`${code}/preparation`,'GET',null,code);
      if(activeParty.hostSecret){const saved=secrets();saved[code]=activeParty.hostSecret;localStorage.setItem('ahouai_planned_secrets',JSON.stringify(saved));}
      renderParty(); if(!dialog.open) dialog.showModal();
    } catch(error) { notify(error); }
  }
  function person(p) {
    const row=node('div',null,'preparation-person');
    if(p.photoURL){const image=node('img');image.src=p.photoURL;image.alt='';row.append(image);}
    else row.append(node('span',(p.name || '?').slice(0,1),'preparation-initial'));
    row.append(node('strong',p.name || 'Invité'));return row;
  }
  function section(title,people,empty) {
    const el=node('section');el.append(node('h2',`${title} · ${people.length}`));
    if(!people.length)el.append(node('p',empty,'preparation-empty'));
    people.forEach(p=>el.append(person(p)));return el;
  }
  async function mutate(path,body,method='POST') {
    if(busy)return;busy=true;
    dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
    try { await api(`${activeParty.code}/preparation/${path}`.replace(/\/$/,''),method,body,activeParty.code);await openParty(activeParty.code);await loadList(); }
    catch(error){notify(error);dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
    finally{busy=false;}
  }
  function renderParty() {
    const p=activeParty;dialog.replaceChildren();
    const head=node('header');const logo=node('img');logo.src='assets/brand/ahouai-logo.png';logo.alt='AhOuai';const close=button('×',()=>dialog.close());close.className='preparation-close';close.setAttribute('aria-label','Fermer');head.append(logo,close);
    const cover=node('img',null,'preparation-cover');cover.src=p.coverPhoto || 'assets/brand/host-party-discovery.jpg';cover.alt='La soirée se prépare';
    dialog.append(head,cover,node('p','LE PROCHAIN MOMENT, ENSEMBLE','host-eyebrow'),node('h1',p.partyName),node('p',dateText(p.scheduledFor),'preparation-date'),node('p',p.welcomeText),node('p','La musique attend ton lancement. Les invitations et les inscriptions sont ouvertes.','preparation-empty'));
    const actions=node('div',null,'preparation-actions');
    actions.append(button('Partager l’invitation',async()=>{const url=`https://join.ahouai.com/guest?code=${p.code}`;try{if(navigator.share)await navigator.share({title:p.partyName,url});else{await navigator.clipboard.writeText(url);notify('Lien copié.');}}catch(e){if(e.name!=='AbortError')notify(e);}}),button('Partager sur WhatsApp',()=>{const url=`https://join.ahouai.com/guest?code=${encodeURIComponent(p.code)}`;const text=`Tu es invité(e) à ${p.partyName} !${p.scheduledFor ? `\n${dateText(p.scheduledFor)}` : ''}\nRejoins-nous et confirme ta participation :\n${url}`;window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,'_blank','noopener,noreferrer');}),button('Ajouter mes amis',pickFriends),button('Modifier',editParty),button('Actualiser',()=>openParty(p.code)));dialog.append(actions);
    dialog.append(section('Inscrits · acceptés',p.participants || [],'Les premières inscriptions apparaîtront ici.'),section('Invités · réponse attendue',p.invited || [],'Ajoute tes amis ou partage le lien. Chacun confirme sa participation.'));
    const pending=node('section');pending.append(node('h2',`Demandes à accepter · ${(p.pending || []).length}`));
    (p.pending || []).forEach(guest=>{const row=person(guest);row.append(button('Accepter',()=>mutate(`requests/${guest.userId}`,{action:'accept'})),button('Décliner',()=>mutate(`requests/${guest.userId}`,{action:'decline'})));pending.append(row);});dialog.append(pending);
    const launch=button('C’est le moment · ouvrir la soirée',()=>{dialog.close();startHostWeb({code:p.code,hostSecret:p.hostSecret,provider:sessionStorage.getItem('ahouai_host_provider') || 'youtube',name:p.partyName,coverPhoto:p.coverPhoto,visibility:'private'});});launch.className='host-launch-cta';dialog.append(launch);
  }
  async function pickFriends() {
    try {
      const token=await getProfileJwt(); if(!token)throw new Error('Connecte ton compte pour retrouver tes amis.');
      const response=await fetch('/api/user/friends',{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error('Impossible de charger tes amis.');
      const data=await response.json();dialog.replaceChildren(node('h1','Qui sera de la partie ?'));const selected=new Set();
      (data.friends || []).forEach(friend=>{const row=person({name:friend.name,photoURL:friend.photo});const check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label',`Inviter ${friend.name}`);check.onchange=()=>check.checked?selected.add(friend.id):selected.delete(friend.id);row.prepend(check);dialog.append(row);});
      if(!data.friends?.length)dialog.append(node('p','Tes amis confirmés apparaîtront ici. Tu peux aussi partager le lien.','preparation-empty'));
      const actions=node('div',null,'preparation-actions');actions.append(button('Retour',renderParty),button('Inviter mes amis',()=>{if(!selected.size)return notify('Sélectionne au moins un ami.');mutate('friends',{userIds:[...selected]});}));dialog.append(actions);
    }catch(e){notify(e);}
  }
  function editParty() {
    const p=activeParty;dialog.replaceChildren(node('h1','Préparer votre rendez-vous'));const form=node('div',null,'preparation-edit');
    function field(text,input){const label=node('label',text);label.append(input);form.append(label);return input;}
    const name=field('Nom de la soirée',node('input'));name.value=p.partyName;name.maxLength=60;
    const date=field('Date et heure',node('input'));date.type='datetime-local';date.value=dateValue(p.scheduledFor);date.min=dateValue(Date.now()+60000);
    const message=field('Un mot pour tes invités',node('textarea'));message.value=p.welcomeText || '';message.maxLength=500;
    const file=field('Changer la photo',node('input'));file.type='file';file.accept='image/*';let cover=p.coverPhoto;
    let processingPhoto=false;
    file.onchange=async()=>{const selected=file.files[0];if(!selected)return;if(selected.size>15*1024*1024){file.value='';return notify('Choisis une photo de moins de 15 Mo.');}try{processingPhoto=true;const reader=new FileReader();reader.onerror=()=>{processingPhoto=false;notify("Impossible de lire cette photo.");};reader.onload=async()=>{try{const cropped=await window.cropPartyCover(reader.result);if(cropped)cover=await compressedCover(cropped);}catch(e){notify(e);}finally{processingPhoto=false;}};reader.readAsDataURL(selected);}catch(e){notify(e);}};
    dialog.append(form);const actions=node('div',null,'preparation-actions');actions.append(button('Annuler',renderParty),button('Enregistrer',()=>{if(processingPhoto)return notify('La photo est en cours de préparation.');const d=new Date(date.value);if(!Number.isFinite(d.getTime())||d<=new Date())return notify('Choisis une date à venir.');mutate('',{partyName:name.value,scheduledFor:d.toISOString(),welcomeText:message.value,coverPhoto:cover},'PATCH');}));dialog.append(actions);
  }
  window.loadScheduledParties = loadList;
})();
