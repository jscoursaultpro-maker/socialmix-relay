import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../../public/shared/ui/party-community.js',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('chat badges persist until conversation read; safety precedes exit; participant opens Touch',async()=>{
 const dom=new JSDOM('<body><section id="tab-hub"><div id="moi-action-bar"></div><button id="quit-btn">Quitter</button></section><button data-nav="moi">My Touch</button></body>',{url:'https://join.ahouai.com/guest?code=ABC123',runScripts:'outside-only'});
 const w=dom.window;const events={};const timers=[];const paths=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.state={partyCode:'ABC123',sessionToken:'session'};w.socket={on:(name,fn)=>events[name]=fn};w.showToast=()=>{};
 w.setInterval=fn=>{timers.push(fn);return timers.length;};w.clearInterval=()=>{};
 Object.defineProperty(w.document,'hidden',{value:false});
 const data={me:'me',people:[{userId:'romeo',name:'Romeo',photoURL:'/avatar.png'}],messages:[{id:'m1',senderId:'romeo',targetId:'me',text:'Salut'},{id:'m2',senderId:'me',targetId:'romeo',text:'Hello'}]};
 w.fetch=async path=>{paths.push(path);return {ok:true,json:async()=>path.includes('/touch/')?{person:data.people[0],isOwn:false,songs:[],messages:[],photos:[]}:data};};
 w.eval(source);timers[1]();await settle();
 assert.equal(w.document.querySelector('#quit-btn').previousElementSibling.textContent,'Prévenir l’organisateur');
 assert.equal(w.document.querySelector('[data-nav="moi"] .community-chat-badge').textContent,'1');
 await events['community:message']();assert.ok(w.document.querySelector('#community-chat-notice'));
 w.document.querySelector('[data-nav="moi"]').click();assert.equal(w.document.querySelector('#community-chat-notice'),null);
 w.document.querySelector('.community-inbox').click();await settle();
 assert.equal(w.document.querySelector('[data-chat-user] .community-chat-badge').textContent,'1');
 w.document.querySelector('[data-chat-user]').click();await settle();
 assert.equal(w.document.querySelector('[data-nav="moi"] .community-chat-badge'),null);
 assert.match(w.document.querySelector('.community-messages').textContent,/Salut/);
 assert.match(w.document.querySelector('.community-message.is-own').textContent,/Hello/);
 w.document.querySelector('.community-inbox').click();await settle();
 w.document.querySelector('.community-chat-identity button').click();await settle();
 assert.ok(paths.some(path=>path.endsWith('/touch/romeo')));dom.window.close();
});
test('report contents drill down by user ID, with photos, songs and words',async()=>{
 const dom=new JSDOM('<body><div id="moi-action-bar"></div><button id="quit-btn"></button></body>',{url:'https://join.ahouai.com',runScripts:'outside-only'});
 const w=dom.window;w.state={partyCode:'ABC123',sessionToken:'session'};w.showToast=()=>{};w.setInterval=()=>1;w.clearInterval=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const items=[{userId:'a',name:'Daphné',id:'song1',kind:'song',text:'Bullit',artist:'Watermät',url:'/cover.jpg'},
 {userId:'a',name:'Daphné',id:'photo1',kind:'photo',text:'Photo partagée',url:'/photo.jpg'},
 {userId:'a',name:'Daphné',id:'word1',kind:'message',text:'Salut tout le monde'},
 {userId:'b',name:'Daphné',id:'word2',kind:'message',text:'Autre personne'}];
 w.fetch=async()=>({ok:true,json:async()=>({items})});w.eval(source);
 w.document.querySelector('.community-safety').click();await settle();
 const groups=w.document.querySelectorAll('.community-report-person');assert.equal(groups.length,2);
 assert.equal(groups[0].open,false);groups[0].querySelector('summary').click();assert.equal(groups[0].open,true);
 assert.equal(groups[0].querySelectorAll('.community-report-content').length,3);
 assert.match(groups[0].textContent,/Bullit/);assert.match(groups[0].textContent,/Watermät/);assert.match(groups[0].textContent,/Salut tout le monde/);
 assert.equal(groups[0].querySelector('.community-report-photo').getAttribute('src'),'/photo.jpg');
 groups[0].querySelector('.community-report-content button').click();assert.match(w.document.querySelector('dialog').textContent,/Contenu inapproprié/);
 dom.window.close();
});
