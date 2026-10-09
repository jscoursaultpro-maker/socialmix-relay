(() => {
  const dialog=document.createElement('dialog');dialog.className='preparation-dialog community-dialog';document.body.append(dialog);
  let current=null, busy=false, boundSocket=null, poll=null, activeConversation=null, activeRefresh=null;
  const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  const toast=e=>showToast(e.message||e,5000);
  const button=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=fn;return b;};
  async function api(path='',method='GET',body) {
    const s=typeof state!=='undefined'?state:{};const code=s.partyCode;
    if(!code)throw new Error('Rejoins une soirée pour continuer.');
    const headers={'Content-Type':'application/json'};
    const host=window.AhOuaiHostEngine?._debug?.().party;
    if(host?.code===code&&host.hostSecret)headers['X-Host-Secret']=host.hostSecret;
    else if(s.sessionToken)headers['X-Guest-Session']=s.sessionToken;
    else {const jwt=await getProfileJwt();if(jwt)headers.Authorization=`Bearer ${jwt}`;}
    const response=await fetch(`/api/party/${encodeURIComponent(code)}/community${path}`,{method,headers,body:body?JSON.stringify(body):undefined});
    const data=await response.json().catch(()=>null);if(!response.ok||!data)throw new Error(response.status===401?'Ta connexion doit être restaurée. Réessaie dans quelques instants.':'Impossible de charger ce contenu. Réessaie dans quelques instants.');return data;
  }
  function header(title){dialog.classList.remove('community-conversation');activeConversation=null;activeRefresh=null;clearInterval(poll);const close=button('× Fermer',()=>{dialog.close();clearInterval(poll);});close.className='community-close';const logo=node('img');logo.src='/assets/brand/ahouai-logo.png';logo.alt='AhOuai';logo.className='community-logo';dialog.replaceChildren(close,logo,node('h1',title));}
  async function action(path,body,after){if(busy)return;busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{const d=await api(path,'POST',body);if(d.message?.text)toast('Message envoyé.');else if(typeof d.message==='string')toast(d.message);if(after)await after();}catch(e){toast(e);}finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  function section(title,items,renderer){dialog.append(node('h2',title));if(!items.length)dialog.append(node('p','Les premiers moments apparaîtront ici.'));items.forEach(renderer);}
  function report(kind,id){const row=node('div');row.className='preparation-actions';row.append(button('Signaler ce contenu',()=>{header('Respecter l’ambiance');dialog.append(node('p','Le premier signalement envoie un avertissement privé. Une récidive alerte l’organisateur. Ton identité n’est pas communiquée à l’invité.'));[['inappropriate','Contenu inapproprié'],['harassment','Harcèlement'],['privacy','Photo ou message sans accord']].forEach(([reason,label])=>dialog.append(button(label,()=>action('/report',{kind,contentId:id,reason},()=>{dialog.close();}))));}));dialog.append(row);}
  async function boostTouchSong(song,reload){
    const host=window.AhOuaiHostEngine?._debug?.().party;
    if(host?.code===state.partyCode){
      const token=await getProfileJwt();if(!token)throw new Error('Reconnecte ton compte pour booster.');
      const response=await fetch(`/api/party/${encodeURIComponent(host.code)}/suggest/${encodeURIComponent(song.id)}/boost`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({suggestionTitle:song.title})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Boost indisponible.');toast('Proposition boostée.');
    }else await boostSuggestion(song.id,song.title);
    await reload();
  }
  function renderTouch(mount,t,reload){const own=t.isOwn;const p=t.person;const title=(mine,theirs)=>own?mine:theirs;
    if(mount!==dialog&&!own)mount.append(node('h2',own?'My Touch':`My Touch de ${p.name}`));
    if(p.photoURL&&(!own||mount===dialog)){const img=node('img');img.src=p.photoURL;img.alt=p.name;img.className='community-profile-photo';mount.append(img);}
    if(!own)mount.append(button('Envoyer un message privé',()=>{header(`Message à ${p.name}`);if(!dialog.open)dialog.showModal();openConversation(p);}));
    const section=(label,items,render)=>{const parent=mount,card=node('details');card.className='touch-collapse';const summary=node('summary'),heading=node('strong',label),count=node('span',String(items.length));count.className='touch-count';const rate=label.includes('favoris')?'+10 pts / vote':label.includes('attente')?'+5 pts / proposition':label.includes('messages')?'+10 pts / message':label.includes('photos')?'+20 pts / photo':label==='Mon classement'?'Ton impact dans la soirée':'+20 pts / titre joué';const text=node('span');text.append(heading,node('small',rate));summary.append(text,count);card.append(summary);const body=node('div');body.className='touch-collapse-body';card.append(body);parent.append(card);mount=body;if(!items.length)mount.append(node('p','Tes premiers moments apparaîtront ici.'));items.forEach(render);mount=parent;};
    const songRow=x=>{
      const row=node('article');row.className='touch-song-row';
      const cover=node('div');cover.className='touch-song-cover';
      if(x.coverURL){const img=node('img');img.src=x.coverURL;img.alt='';img.onerror=()=>{cover.replaceChildren(node('span','♫'));};cover.append(img);}else cover.append(node('span','♫'));
      const text=node('div');text.className='touch-song-info';text.append(node('strong',x.title),node('small',x.artist),node('span',`${x.fireCount ? `🔥 ${x.fireCount} · ` : ''}${x.boostCount != null ? `${x.boostCount} boosts · ` : ''}${{played:'Joué',pending:'En attente',queued:'Dans la file',next:'À suivre',rejected:'Non retenu',skipped:'Passé'}[x.status]||'Favori'}`));row.append(cover,text);mount.append(row);
      if(!own&&x.canBoost)row.append(button('Booster',async()=>{try{await boostTouchSong(x,reload);}catch(e){toast(e);}}));
    };
    section(title('Mes favoris · mes feux','Ses favoris · ses feux'),t.favorites||[],songRow);
    section(title('Mes titres joués','Ses titres joués'),t.songs.filter(x=>x.status==='played'),songRow);
    section(title('Mes titres en attente','Ses titres en attente'),t.songs.filter(x=>['pending','queued','next'].includes(x.status)),songRow);
    const other=t.songs.filter(x=>!['played','pending','queued','next'].includes(x.status));if(other.length)section('Autres suggestions',other,songRow);
    const like=(kind,x)=>button(`${x.liked?'♥ Aimé':'♡ J’aime'} · ${x.likeCount||0}`,()=>action('/like',{kind,contentId:x.id,liked:!x.liked},reload));
    section(title('Mes messages publiés','Ses messages publiés'),t.messages,x=>{mount.append(node('p',x.message));if(!own)mount.append(like('message',x));else mount.append(node('p',`♥ ${x.likeCount||0}`));});
    section(title('Mes photos publiées','Ses photos publiées'),t.photos,x=>{const img=node('img');img.src=x.url;img.alt=x.caption||'Moment partagé';img.className='preparation-cover';mount.append(img);if(!own)mount.append(like('photo',x));else mount.append(node('p',`♥ ${x.likeCount||0}`));});
    if(own){section('Mon classement',t.ranking?.position?[t.ranking]:[],x=>mount.append(node('p',`#${x.position} · ${x.points} points`)));}
  }
  window.openParticipantTouch=async userId=>{try{current=await api(`/touch/${encodeURIComponent(userId)}`);header(current.isOwn?'My Touch':`My Touch de ${current.person.name}`);renderTouch(dialog,current,()=>window.openParticipantTouch(userId));if(!dialog.open)dialog.showModal();}catch(e){toast(e);}};
  window.mountOwnMyTouch=async mount=>{try{const me=await api();const t=await api(`/touch/${encodeURIComponent(me.me)}`);if(!mount.isConnected)return;mount.replaceChildren();renderTouch(mount,t,()=>window.mountOwnMyTouch(mount));}catch(e){if(!mount.isConnected)return;mount.replaceChildren(node('p','Ton My Touch est momentanément indisponible.'),button('Réessayer',()=>window.mountOwnMyTouch(mount)));}};
  async function openConversation(p){header(`Discuter avec ${p.name}`);dialog.classList.add('community-conversation');dialog.append(button('← Mes chats',()=>inbox.click()));activeConversation=p.userId;if(!dialog.open)dialog.showModal();dialog.append(node('p','Seuls vous deux pouvez lire cet échange.'));
    const messages=node('div');messages.className='community-messages';dialog.append(messages);const input=node('textarea');input.maxLength=1000;input.placeholder='Ton message…';input.setAttribute('aria-label','Ton message');dialog.append(input);
    const refresh=async()=>{if(!dialog.open)return;try{const d=await api();markConversationRead(d,p.userId);messages.replaceChildren();d.messages.filter(m=>(m.senderId===d.me&&m.targetId===p.userId)||(m.targetId===d.me&&m.senderId===p.userId)).forEach(m=>{const row=node('article');row.className=`community-message ${m.senderId===d.me?'is-own':'is-received'}`;row.append(node('small',m.senderId===d.me?'Toi':p.name),node('p',m.text));if(m.sentAt){const date=new Date(m.sentAt);if(!Number.isNaN(date.getTime()))row.append(node('time',date.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})));}messages.append(row);if(m.senderId!==d.me)row.append(button('Signaler',()=>{header('Signaler ce message privé');[['inappropriate','Inapproprié'],['harassment','Harcèlement']].forEach(([reason,label])=>dialog.append(button(label,()=>action('/report',{kind:'private_message',contentId:m.id,reason},()=>openConversation(p))))); }));});if(!messages.children.length)messages.append(node('p','Commencez la discussion ici.'));const latest=d.messages.at(-1)?.id;if(messages.dataset.latest!==latest){messages.scrollTop=messages.scrollHeight;messages.dataset.latest=latest||'';}}catch(e){clearInterval(poll);toast(e);}};
    dialog.append(button('Envoyer',()=>{const text=input.value.trim();if(!text)return;action('/message',{targetId:p.userId,text},async()=>{input.value='';await refresh();});}));clearInterval(poll);activeRefresh=refresh;await refresh();poll=setInterval(refresh,5000);
  }
  async function moderation(userId){try{const d=await api(`/moderation/${encodeURIComponent(userId)}`);header(`Modération · ${d.person.name}`);
    dialog.append(button('Retour à Backstage',backstage),node('p',d.restriction?`Accès suspendu · ${d.restriction==='temporary'?'15 minutes':'cette soirée'}`:'Gestion des avertissements et de la présence.'));
    section('Historique des incidents',d.incidents,x=>{dialog.append(node('p',`Avertissement ${x.warningNumber} · ${{inappropriate:'Contenu inapproprié',harassment:'Harcèlement',privacy:'Sans accord'}[x.reason]||x.reason}`),node('p',x.excerpt||(x.kind==='private_message'?'Message privé signalé : conversation confidentielle.':'Contenu indisponible.')));if(x.url){const img=node('img');img.src=x.url;img.alt='Photo signalée';img.className='preparation-cover';dialog.append(img);}if(x.contentId&&['photo','message'].includes(x.kind)&&x.status!=='removed')dialog.append(button('Retirer ce contenu et avertir',()=>action('/content-remove',{kind:x.kind,contentId:x.contentId},()=>moderation(userId))));});
    [['photo','Photos'],['message','Messages'],['song','Suggestions']].forEach(([channel,label])=>{const blocked=(d.blockedChannels||[]).includes(channel);dialog.append(button(`${blocked?'Rétablir':'Suspendre'} · ${label}`,()=>action('/capability',{userId,channel,blocked:!blocked},()=>moderation(userId))));});
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
  window.mountCommunityBackstage=mount=>{if(!window.AhOuaiHostMode?.isHostMode?.())return;const card=node('section');card.className='bs-card';card.append(node('h2','RESPECT & PRÉSENCE'),node('p','Traite les avertissements et garde la liste des présents à jour.'),button('Gérer les invités et signalements',backstage));mount.append(card);};
  let chatSnapshot=null,chatLoading=false;
  const readChatIds=d=>{try{return new Set(JSON.parse(localStorage.getItem(`ahouai_chat_read_${state.partyCode}_${d.me}`)||'[]'));}catch{return new Set();}};
  function unreadCount(d, userId){const read=readChatIds(d);return d.messages.filter(m=>m.targetId===d.me&&(!userId||m.senderId===userId)&&!read.has(String(m.id))).length;}
  function badgeFor(el,count){el.querySelector('.community-chat-badge')?.remove();if(count){const badge=node('span',String(count));badge.className='community-chat-badge';badge.setAttribute('aria-label',`${count} messages non lus`);el.append(badge);}}
  function updateChatBadge(d){
    chatSnapshot=d;const count=unreadCount(d);
    inbox.replaceChildren(node('span','MES CHATS'),node('span','›'));badgeFor(inbox,count);
    inbox.setAttribute('aria-label',`Mes chats${count?` · ${count} nouveaux messages`:''}`);
    document.querySelectorAll('[data-nav="moi"]').forEach(el=>{badgeFor(el,count);el.setAttribute('aria-label',`My Touch${count?` · ${count} messages non lus`:''}`);});
    dialog.querySelectorAll('[data-chat-user]').forEach(el=>badgeFor(el,unreadCount(d,el.dataset.chatUser)));
  }
  function chatNotice(){
    document.getElementById('community-chat-notice')?.remove();
    const notice=node('aside');notice.id='community-chat-notice';notice.setAttribute('role','status');
    const close=button('×',()=>notice.remove());close.className='community-notice-close';close.setAttribute('aria-label','Fermer la notification');
    notice.append(close,node('strong','Nouveau message privé'),node('p','Retrouve ta conversation dans Mes chats.'),button('Voir mes chats',()=>{notice.remove();inbox.click();}));document.body.append(notice);
  }
  document.addEventListener('click',e=>{if(e.target.closest('[data-nav], [data-v2-action]'))document.getElementById('community-chat-notice')?.remove();});
  async function refreshChatBadge(){if(chatLoading||!state?.partyCode||document.hidden)return;chatLoading=true;try{updateChatBadge(await api());}catch{}finally{chatLoading=false;}}
  function markConversationRead(d,id){const read=readChatIds(d);d.messages.filter(m=>m.targetId===d.me&&m.senderId===id).forEach(m=>read.add(String(m.id)));try{localStorage.setItem(`ahouai_chat_read_${state.partyCode}_${d.me}`,JSON.stringify([...read]));}catch{}updateChatBadge(d);}
  const inbox=button('MES CHATS' ,async()=>{try{const d=await api();updateChatBadge(d);header('Mes chats');const people=d.people.filter(p=>p.userId!==d.me&&!p.departedAt);if(!people.length)dialog.append(node('p','Les participants apparaîtront ici dès leur arrivée.'));people.forEach(p=>{
      const card=node('article');card.className='community-chat-person';const identity=node('div');identity.className='community-chat-identity';
      if(p.photoURL){const img=node('img');img.src=p.photoURL;img.alt='';identity.append(img);}else{const avatar=node('span',p.name?.slice(0,1)||'✨');avatar.className='community-chat-avatar';identity.append(avatar);}
      identity.append(button(p.name,()=>window.openParticipantTouch(p.userId)));card.append(identity);const actions=node('div');actions.className='community-chat-actions';
      const friend=button('Demander en ami',async()=>{await sendFriendRequest(p.userId,p.name);const status=state._friendStatuses?.[p.userId]?.status;if(status==='pending_sent'){friend.textContent='Demande envoyée ✓';friend.disabled=true;}});
      const status=state._friendStatuses?.[p.userId]?.status;if(status==='pending_sent'||status==='accepted'){friend.textContent=status==='accepted'?'Déjà amis ✓':'Demande envoyée ✓';friend.disabled=true;}
      const chat=button(`Discuter avec ${p.name}`,()=>openConversation(p));chat.dataset.chatUser=p.userId;badgeFor(chat,unreadCount(d,p.userId));
      actions.append(friend,chat,button(`Voir le My Touch de ${p.name}`,()=>window.openParticipantTouch(p.userId)));card.append(actions);dialog.append(card);
    });if(!dialog.open)dialog.showModal();}catch(e){toast(e);}});inbox.className='community-inbox';inbox.hidden=true;document.getElementById('moi-action-bar')?.after(inbox);
  const safety=button('Prévenir l’organisateur',async()=>{try{const d=await api('/reportable');header('Prévenir l’organisateur');dialog.append(node('p','Choisis le contenu concerné. Premier incident : avertissement privé. Récidive : alerte dans Backstage.'));d.items.forEach(x=>{dialog.append(node('p',`${x.name} · ${x.text}`));report(x.kind,x.id);});if(!dialog.open)dialog.showModal();}catch(e){toast(e);}});safety.className='community-safety';safety.hidden=true;document.getElementById('quit-btn')?.before(safety);
  window.bindCommunitySocket=s=>{if(!s||s===boundSocket)return;boundSocket=s;
    s.on('community:warning',d=>{const key=`ahouai_warning_${state.partyCode}_${d.id}`;if(!localStorage.getItem(key)){localStorage.setItem(key,'seen');toast(d.message);}});s.on('community:alert',()=>toast('Un nouvel avertissement demande ton attention dans Backstage.'));s.on('community:message',async()=>{if(dialog.open&&activeConversation&&activeRefresh)await activeRefresh();await refreshChatBadge();if(chatSnapshot&&unreadCount(chatSnapshot))chatNotice();});
    s.on('community:excluded',d=>{clearResumeSession();showScreen('choice');dialog.close();toast(d.message);});
  };
  setInterval(refreshChatBadge,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshChatBadge();});
  setInterval(()=>{const wasHidden=inbox.hidden;inbox.hidden=!state?.partyCode;safety.hidden=inbox.hidden;const bar=document.getElementById('moi-action-bar');if(bar&&bar.nextElementSibling!==inbox)bar.after(inbox);const quit=document.getElementById('quit-btn');if(quit&&quit.previousElementSibling!==safety)quit.before(safety);if(wasHidden&&!inbox.hidden)refreshChatBadge();if(typeof socket!=='undefined')window.bindCommunitySocket(socket);},1000);
})();
