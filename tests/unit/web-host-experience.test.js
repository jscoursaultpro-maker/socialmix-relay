import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../../public/shared/ui/host-experience.js',import.meta.url),'utf8');
const settle=()=>new Promise(r=>setImmediate(r));
function fixture(host=true){
 const dom=new JSDOM(`<body><section id="cockpit-screen"><header class="soiree-top-header"><button id="show-qr-btn"><svg viewBox="0 0 24 24"></svg></button><button id="edit-profile-btn"></button></header><section id="tab-hub"><div id="moi-overview"><div class="moi-identity-card">Legacy identity</div><div id="my-touch-contributions"><details class="touch-collapse"><summary><strong>Mes favoris · mes feux</strong></summary></details></div><section class="moi-circle-panel"></section><section class="moi-ranking-panel"></section></div><button id="quit-btn">Quitter</button></section><div id="backstage-content"></div></section><nav id="bottom-nav"><button data-nav="moi">MY TOUCH<span class="community-chat-badge">2</span></button><button id="backstage-nav-btn">BACKSTAGE</button></nav><dialog class="community-dialog"></dialog></body>`,{url:'https://join.ahouai.com',runScripts:'outside-only'});
 const w=dom.window, calls=[],commands=[],screens=[],touches=[];let active=host;
 Object.defineProperty(w.document,'hidden',{value:false});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const data={me:'host-user',people:[{userId:'host-user',name:'Jean Sébastien',photoURL:'/host.png',isHost:true},{userId:'guest-a',name:'Daphné',photoURL:'/daphne.png'},{userId:'guest-b',name:'Daphné',photoURL:'/other.png'}],messages:[],warnings:[{id:'w1',status:'warned'}],alerts:[{id:'a1',targetId:'guest-a'}]};
 w.state={partyCode:'ABC123',userId:'host-user',guestName:'Jean Sébastien',participants:data.people,leaderboard:[{id:'Daphné',participantId:'guest-a',name:'Daphné',points:75},{id:'host',participantId:'host-user',name:'Jean Sébastien',points:55}],allPhotos:[],liveMessages:[],pendingGuests:[],visibility:'private'};
 w.AhOuaiHostMode={isHostMode:()=>active,renderBackstage:()=>{}};
 w.AhOuaiHostEngine={_debug:()=>({party:{code:w.state.partyCode,hostSecret:'test-only-credential'}}),endParty:()=>{commands.push('end');return true;},emitHost:(event,payload,callback)=>{commands.push({event,payload});callback({ok:true});return true;}};
 w.openParticipantTouch=id=>touches.push(id);w.showScreen=name=>screens.push(name);w.showPartyQR=()=>calls.push('qr');w.showToast=()=>{};
 w.setInterval=()=>1;w.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>data};};
 w.eval(source);
 return {dom,w,data,calls,commands,screens,touches,changeHost:value=>{active=value;w.AhOuaiHostExperience.sync();}};
}
test('guest is untouched: no host DOM, no request, no label changes',async()=>{
 const f=fixture(false);await settle();assert.equal(f.calls.length,0);assert.equal(f.w.document.querySelector('#hx-header'),null);assert.equal(f.w.document.querySelector('.touch-collapse strong').textContent,'Mes favoris · mes feux');assert.equal(f.w.document.body.classList.contains('hx-host-experience'),false);f.dom.window.close();
});
test('host header, canonical ranking, portraits and navigation; menu does not end party',async()=>{
 const f=fixture();await settle();const {w}=f;
 assert.equal(f.calls[0].options.headers['X-Host-Secret'],'test-only-credential');
 assert.match(w.document.querySelector('#hx-touch-heading').textContent,/55 points · #2/);
 assert.equal(w.document.querySelector('#hx-touch-heading img').getAttribute('src'),'/host.png');
 assert.equal(w.document.querySelector('.touch-collapse strong').textContent,'Les favoris · les feux');
 w.document.querySelector('#hx-ranking button').click();assert.equal(f.touches.at(-1),'guest-a');
 w.document.querySelectorAll('#hx-circle button')[1].click();assert.equal(f.touches.at(-1),'guest-b');
 w.document.querySelector('.hx-qr').click();assert.equal(f.calls.at(-1),'qr');
 w.AhOuaiHostExperience.openDoor();[...w.document.querySelectorAll('.hx-dialog button')].find(b=>b.textContent==='Revenir au menu').click();assert.deepEqual(f.screens,['choice']);assert.deepEqual(f.commands,[]);
 w.AhOuaiHostExperience.openDoor();[...w.document.querySelectorAll('.hx-dialog button')].find(b=>b.textContent==='Terminer la soirée').click();assert.equal(f.commands.length,0);[...w.document.querySelectorAll('.hx-dialog button')].find(b=>b.textContent==='Terminer la soirée').click();assert.deepEqual(f.commands,['end']);
 f.changeHost(false);assert.equal(w.document.querySelector('#hx-header'),null);assert.equal(w.document.querySelector('.touch-collapse strong').textContent,'Mes favoris · mes feux');assert.equal(w.document.body.classList.contains('hx-host-experience'),false);f.dom.window.close();
});
test('host alerts and own warnings are separate from chats and clear only on relevant view',async()=>{
 const f=fixture();await settle();const {w,data}=f;const nav=w.document.querySelector('[data-nav=moi]');
 assert.equal(nav.querySelector('.community-chat-badge').textContent,'2');assert.match(nav.querySelector('.hx-warning').getAttribute('aria-label'),/^2 /);
 const d=w.document.querySelector('.community-dialog');d.open=true;d.innerHTML='<h1>Mes chats</h1>';w.AhOuaiHostExperience.sync();assert.ok(nav.querySelector('.hx-warning'));
 d.innerHTML='<h1>Backstage · garder l’ambiance</h1>';w.AhOuaiHostExperience.sync();assert.equal(w.document.querySelector('#backstage-nav-btn .hx-warning'),null);assert.match(nav.querySelector('.hx-warning').getAttribute('aria-label'),/^1 /);
 d.innerHTML='<h1>Prévenir l’organisateur</h1>';w.AhOuaiHostExperience.sync();assert.equal(nav.querySelector('.hx-warning'),null);
 d.close();data.alerts.push({id:'a2',targetId:'guest-b'});await w.AhOuaiHostExperience.refresh();assert.ok(nav.querySelector('.hx-warning'));f.dom.window.close();
});
test('Backstage exposes all contents by identity, approval, privacy, delete confirmation',async()=>{
 const f=fixture();await settle();const {w}=f,s=w.state;
 s.pendingGuests=[{userId:'pending',firstName:'Romeo'}];
 s.allPhotos=Array.from({length:6},(_,i)=>({id:`photo-${i}`,authorUserId:i<5?'guest-a':'guest-b',guestName:'Daphné',url:`/photo-${i}.png`}));s.liveMessages=[{id:'word-1',authorUserId:'guest-a',message:'Mot à modérer'}];
 const mount=w.document.querySelector('#backstage-content');w.AhOuaiHostExperience.renderBackstage(mount,s);
 assert.equal(mount.querySelectorAll('details').length,2);assert.equal(mount.querySelectorAll('.hx-content').length,7);assert.equal(mount.querySelectorAll('.hx-content img').length,6);
 [...mount.querySelectorAll('button')].find(b=>b.textContent==='Faire entrer').click();assert.equal(f.commands.at(-1).event,'host:approveGuest');assert.equal(s.pendingGuests.length,0);
 [...mount.querySelectorAll('button')].find(b=>b.textContent==='Publique').click();assert.equal(f.commands.at(-1).event,'host:updateVisibility');assert.equal(s.visibility,'public');
 mount.querySelector('.hx-content button').click();assert.notEqual(f.commands.at(-1).event,'host:deletePhoto');
 [...w.document.querySelectorAll('.hx-dialog button')].find(b=>b.textContent==='Confirmer la suppression').click();assert.equal(f.commands.at(-1).event,'host:deletePhoto');assert.equal(f.commands.at(-1).payload.photoId,'photo-0');assert.equal(s.allPhotos.length,5);
 f.changeHost(false);const count=f.commands.length;w.AhOuaiHostExperience.openDoor();w.document.querySelector('.hx-dialog button')?.click();assert.equal(f.commands.length,count);f.dom.window.close();
});
