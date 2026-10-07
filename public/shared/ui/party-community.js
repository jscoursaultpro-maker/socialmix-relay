(() => {
  const dialog=document.createElement('dialog');dialog.className='preparation-dialog community-dialog';document.body.append(dialog);
  let current=null, busy=false, boundSocket=null, poll=null;
  const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  const toast=e=>showToast(e.message||e,5000);
  const button=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=fn;return b;};
  async function api(path='',method='GET',body) {
    const s=typeof state!=='undefined'?state:{};const code=s.partyCode;
    if(!code)throw new Error('Rejoins une soirée pour continuer.');
    const headers={'Content-Type':'application/json'};const jwt=await getProfileJwt();if(jwt)headers.Authorization=`Bearer ${jwt}`;
    if(s.sessionToken)headers['X-Guest-Session']=s.sessionToken;
    const host=window.AhOuaiHostEngine?._debug?.().party;if(host?.code===code)headers['X-Host-Secret']=host.hostSecret;
    const response=await fetch(`/api/party/${encodeURIComponent(code)}/community${path}`,{method,headers,body:body?JSON.stringify(body):undefined});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Action impossible.');return data;
  }
  function header(title){clearInterval(poll);const close=button('× Fermer',()=>{dialog.close();clearInterval(poll);});close.className='community-close';const logo=node('img');logo.src='/assets/brand/ahouai-logo.png';logo.alt='AhOuai';logo.className='community-logo';dialog.replaceChildren(close,logo,node('h1',title));}
  async function action(path,body,after){if(busy)return;busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{const d=await api(path,'POST',body);if(d.message?.text)toast('Message envoyé.');else if(typeof d.message==='string')toast(d.message);if(after)await after();}catch(e){toast(e);}finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  function section(title,items,renderer){dialog.append(node('h2',title));if(!items.length)dialog.append(node('p','Les premiers moments apparaîtront ici.'));items.forEach(renderer);}
  function report(kind,id){const row=node('div');row.className='preparation-actions';row.append(button('Signaler ce contenu',()=>{header('Respecter l’ambiance');dialog.append(node('p','Le premier signalement envoie un avertissement privé. Une récidive alerte l’organisateur. Ton identité n’est pas communiquée à l’invité.'));[['inappropriate','Contenu inapproprié'],['harassment','Harcèlement'],['privacy','Photo ou message sans accord']].forEach(([reason,label])=>dialog.append(button(label,()=>action('/report',{kind,contentId:id,reason},()=>{dialog.close();}))));}));dialog.append(row);}
  window.openParticipantTouch=async userId=>{try{
    current=await api(`/touch/${encodeURIComponent(userId)}`);const p=current.person;header(`La Touch de ${p.name}`);
    if(p.photoURL){const image=node('img');image.src=p.photoURL;image.alt=p.name;image.className='community-profile-photo';dialog.append(image);}
    dialog.append(node('p','Ses sons. Ses mots. Les moments qu’il ou elle partage avec vous.'));
    dialog.append(button('Envoyer un message',()=>openConversation(p)));
    dialog.append(node('p',`Titres : ${current.songs.length} · Mots : ${current.messages.length} · Photos : ${current.photos.length}`));
    section('Ses titres',current.songs,x=>{dialog.append(node('p',`${x.title} · ${x.artist} · ${x.boostCount||0} boosts · ${x.status==='played'?'Joué':['pending','queued','next'].includes(x.status)?'À venir':'Proposé'}`));if(x.canBoost)dialog.append(button('Booster sa proposition',async()=>{await boostSuggestion(x.id,x.title);await window.openParticipantTouch(userId);}));});
    section('Ses mots',current.messages,x=>{dialog.append(node('p',x.message));});
    section('Ses photos',current.photos,x=>{const img=node('img');img.src=x.url;img.alt=x.caption||'Moment partagé';img.className='preparation-cover';dialog.append(img);});
    if(!dialog.open)dialog.showModal();
  }catch(e){toast(e);}};
  async function openConversation(p){header(`Message à ${p.name}`);dialog.append(node('p','Seuls vous deux pouvez lire cet échange.'));
    const messages=node('div');messages.className='community-messages';dialog.append(messages);const input=node('textarea');input.maxLength=1000;input.placeholder='Ton message…';input.setAttribute('aria-label','Ton message');dialog.append(input);
    const refresh=async()=>{if(!dialog.open)return;try{const d=await api();messages.replaceChildren();d.messages.filter(m=>(m.senderId===d.me&&m.targetId===p.userId)||(m.targetId===d.me&&m.senderId===p.userId)).forEach(m=>{const row=node('p',`${m.senderId===d.me?'Toi':p.name} · ${m.text}`);messages.append(row);if(m.senderId!==d.me)row.append(button('Signaler',()=>{header('Signaler ce message privé');[['inappropriate','Inapproprié'],['harassment','Harcèlement']].forEach(([reason,label])=>dialog.append(button(label,()=>action('/report',{kind:'private_message',contentId:m.id,reason},()=>openConversation(p))))); }));});}catch(e){clearInterval(poll);toast(e);}};
    dialog.append(button('Envoyer',()=>{const text=input.value.trim();if(!text)return;action('/message',{targetId:p.userId,text},async()=>{input.value='';await refresh();});}));clearInterval(poll);await refresh();poll=setInterval(refresh,5000);
  }
  async function moderation(userId){try{const d=await api(`/moderation/${encodeURIComponent(userId)}`);header(`Modération · ${d.person.name}`);
    dialog.append(button('Retour à Backstage',backstage),node('p',d.restriction?`Accès suspendu · ${d.restriction==='temporary'?'15 minutes':'cette soirée'}`:'Gestion des avertissements et de la présence.'));
    section('Historique des incidents',d.incidents,x=>{dialog.append(node('p',`Avertissement ${x.warningNumber} · ${{inappropriate:'Contenu inapproprié',harassment:'Harcèlement',privacy:'Sans accord'}[x.reason]||x.reason}`),node('p',x.excerpt||(x.kind==='private_message'?'Message privé signalé : conversation confidentielle.':'Contenu indisponible.')));if(x.url){const img=node('img');img.src=x.url;img.alt='Photo signalée';img.className='preparation-cover';dialog.append(img);}});
    [['temporary','Exclure 15 min'],['permanent','Exclure définitivement de cette soirée'],['departed','Marquer comme parti'],['restore','Autoriser le retour'],['dismiss','Classer les alertes']].forEach(([decision,label])=>dialog.append(button(label,()=>{if(window.confirm(`${label} : ${d.person.name} ?`))action('/decision',{userId,action:decision},backstage);})));if(!dialog.open)dialog.showModal();
  }catch(e){toast(e);}}
  async function backstage(){try{const d=await api();header('Backstage · garder l’ambiance');
    dialog.append(node('h2',`Alertes à traiter · ${d.alerts.length}`));
    d.alerts.forEach(a=>{const p=d.people.find(p=>p.userId===a.targetId);dialog.append(node('p',`${p?.name||'Invité'} · ${a.warningNumber} avertissements · ${{photo:'Photo',message:'Message',song:'Titre',private_message:'Message privé'}[a.kind]||'Contenu'}`),button('Voir le contenu',()=>moderation(a.targetId)),button('Classer ce signalement',()=>action('/decision',{userId:a.targetId,action:'dismiss'},backstage)));});
    dialog.append(node('h2','Les invités'));
    d.people.filter(p=>!p.isHost).forEach(p=>{const row=node('div');row.className='preparation-person';if(p.photoURL){const img=node('img');img.src=p.photoURL;img.alt='';row.append(img);}row.append(button(`${p.name}${p.departedAt?' · parti':''}`,()=>moderation(p.userId)));
      const controls=node('div');controls.className='preparation-actions';[['temporary','Exclure 15 min'],['permanent','Exclure définitivement de cette soirée'],['departed','Marquer comme parti'],['restore','Autoriser le retour']].forEach(([decision,label])=>controls.append(button(label,()=>{if(!window.confirm(`${label} : ${p.name} ?`))return;action('/decision',{userId:p.userId,action:decision},backstage);})));dialog.append(row,controls);});
    if(!dialog.open)dialog.showModal();
  }catch(e){toast(e);}}
  window.mountCommunityBackstage=mount=>{const card=node('section');card.className='bs-card';card.append(node('h2','RESPECT & PRÉSENCE'),node('p','Traite les avertissements et garde la liste des présents à jour.'),button('Gérer les invités et signalements',backstage));mount.append(card);};
  const inbox=button('Mes messages',async()=>{try{const d=await api();header('Mes messages');const ids=new Set(d.messages.map(m=>m.senderId===d.me?m.targetId:m.senderId));if(!ids.size)dialog.append(node('p','Clique sur un participant pour découvrir sa Touch et lui écrire.'));ids.forEach(id=>{const p=d.people.find(p=>p.userId===id);if(p)dialog.append(button(p.name,()=>openConversation(p)));});if(!dialog.open)dialog.showModal();}catch(e){toast(e);}});inbox.className='community-inbox';inbox.hidden=true;document.getElementById('tab-hub')?.prepend(inbox);
  const safety=button('Prévenir l’organisateur',async()=>{try{const d=await api('/reportable');header('Prévenir l’organisateur');dialog.append(node('p','Choisis le contenu concerné. Premier incident : avertissement privé. Récidive : alerte dans Backstage.'));d.items.forEach(x=>{dialog.append(node('p',`${x.name} · ${x.text}`));report(x.kind,x.id);});if(!dialog.open)dialog.showModal();}catch(e){toast(e);}});safety.className='community-inbox';safety.hidden=true;document.getElementById('tab-hub')?.append(safety);
  window.bindCommunitySocket=s=>{if(!s||s===boundSocket)return;boundSocket=s;
    s.on('community:warning',d=>{const key=`ahouai_warning_${state.partyCode}_${d.id}`;if(!localStorage.getItem(key)){localStorage.setItem(key,'seen');toast(d.message);}});s.on('community:alert',()=>toast('Un nouvel avertissement demande ton attention dans Backstage.'));s.on('community:message',()=>toast('Tu as reçu un message privé · My Touch.'));
    s.on('community:excluded',d=>{clearResumeSession();showScreen('choice');dialog.close();toast(d.message);});
  };
  setInterval(()=>{inbox.hidden=!state?.partyCode;safety.hidden=inbox.hidden;if(typeof socket!=='undefined')window.bindCommunitySocket(socket);},1000);
})();
