import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Party from '../../models/Party.js';
import communityRouter, { activeRestriction, registerReport, resolveReportedContent, communityAccessGuard } from '../../routes/party-community.js';

test('one warning per distinct content, escalation, rate limits and scoped expiration',()=>{
  const reports=[];const input={reporterId:'a',targetId:'b',kind:'photo',contentId:'one',reason:'privacy'};
  const one=registerReport(reports,input,1000000);assert.equal(one.warningNumber,1);assert.equal(one.status,'warned');
  assert.throws(()=>registerReport(reports,{...input,reporterId:'c'}),/déjà/);
  const two=registerReport(reports,{...input,contentId:'two'},1000001);assert.equal(two.status,'needs_review');
  registerReport(reports,{...input,contentId:'three'},1000002);
  assert.throws(()=>registerReport(reports,{...input,contentId:'four'},1000003),/Attends/);
  const until=new Date(1000).toISOString();assert.ok(activeRestriction([{userId:'b',kind:'temporary',until}],'b',999));assert.equal(activeRestriction([{userId:'b',kind:'temporary',until}],'b',1000),null);
  assert.equal(activeRestriction([{userId:'b',kind:'permanent'}],'a'),null);
  assert.ok(activeRestriction([{userId:'b',kind:'permanent'}],'b'));
  const party={participants:[{userId:'b'},{userId:'h',isHost:true}],messages:[{id:'m',authorUserId:'b'},{id:'h',authorUserId:'h'}]};
  assert.equal(resolveReportedContent(party,'message','m').author.userId,'b');assert.equal(resolveReportedContent(party,'message','h'),null);
});

test('private inbox isolation, actual content ownership, host decisions and access revocation',async()=>{
  const alice={userId:'a',id:'sa',name:'Alice',sessionToken:'token-a',connected:true};
  const bob={userId:'b',id:'sb',name:'Bob',sessionToken:'token-b',connected:true};
  const p={code:'ABC123',hostSecret:'secret-host',participants:[alice,bob,{userId:'h',id:'sh',name:'Host',isHost:true}],messages:[{id:'m1',authorUserId:'b',message:'word'},{id:'m2',authorUserId:'b',message:'second'}],photos:[],suggestions:[]};
  const doc={communityReports:[],communityRestrictions:[],privateMessages:[]}; const events=[];
  const PartyModel={findOne(){return{select(){return this},async lean(){return structuredClone(doc)}}},async updateOne(q,u){
    for(const [key,value] of Object.entries(u.$push||{}))doc[key].push(structuredClone(value));
    if(u.$set?.communityRestrictions)doc.communityRestrictions=structuredClone(u.$set.communityRestrictions);
    if(u.$set?.['communityReports.$[r].status'])doc.communityReports.forEach(r=>r.status='reviewed');
    if(u.$pull?.communityRestrictions)doc.communityRestrictions=doc.communityRestrictions.filter(x=>x.userId!==u.$pull.communityRestrictions.userId);
  }};
  const io={to(room){return{emit(event,data){events.push({room,event,data})}}},sockets:{sockets:new Map()}};
  const app=express();app.use(express.json());app.use('/api/party',communityRouter({parties:new Map([[p.code,p]]),io,PartyModel,buildLightState:()=>({code:p.code}),authenticate:async()=>{throw new Error('bad jwt')}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/api/party/ABC123/community`;
  const request=async(path='',body,headers={'X-Guest-Session':'token-a'})=>{const r=await fetch(url+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}};
  try{
    assert.equal((await request('',undefined,{})).status,403);
    assert.equal((await request('',undefined,{Authorization:'Bearer invalid'})).status,401);
    assert.equal((await request('/decision',{userId:'b',action:'permanent'})).status,403);
    assert.equal((await request('/message',{targetId:'b',text:'Private hello'})).status,200);
    assert.equal((await request()).body.messages.length,1);
    assert.equal((await request('',undefined,{'X-Host-Secret':'secret-host'})).body.messages.length,0);
    assert.equal((await request('/report',{kind:'message',contentId:'missing',reason:'inappropriate'})).status,400);
    assert.equal((await request('/report',{kind:'message',contentId:'m1',reason:'inappropriate'})).status,200);
    const privateWarning=events.find(e=>e.event==='community:warning');assert.equal(privateWarning.room,'sb');assert.equal(privateWarning.data.reporterId,undefined);
    assert.equal((await request('/report',{kind:'message',contentId:'m1',reason:'inappropriate'})).status,400);
    assert.equal((await request('/report',{kind:'message',contentId:'m2',reason:'inappropriate'})).status,200);
    assert.ok(events.find(e=>e.event==='community:alert'&&e.room==='host:ABC123'));
    assert.equal((await request()).body.alerts.length,0);
    assert.equal((await request('',undefined,{'X-Host-Secret':'secret-host'})).body.alerts.length,1);
    assert.equal((await request('/moderation/b')).status,403);
    const dossier=await request('/moderation/b',undefined,{'X-Host-Secret':'secret-host'});
    assert.equal(dossier.status,200);assert.equal(dossier.body.incidents.length,2);
    assert.equal(dossier.body.incidents[0].reporterId,undefined);
    const touch=await request('/touch/b');assert.equal(touch.status,200);
    assert.equal(touch.body.incidents,undefined);assert.equal(touch.body.restriction,undefined);
    const reportable=await request('/reportable');assert.equal(reportable.status,200);
    assert.ok(reportable.body.items.every(x=>x.name==='Bob'));
    assert.equal((await request('/decision',{userId:'b',action:'temporary'},{'X-Host-Secret':'secret-host'})).status,200);
    assert.equal(doc.communityRestrictions[0].kind,'temporary');assert.ok(new Date(doc.communityRestrictions[0].until)>new Date(Date.now()+890000));
    assert.equal((await request('/message',{targetId:'a',text:'cannot send'},{'X-Guest-Session':'token-b'})).status,403);
    assert.equal((await request('/decision',{userId:'h',action:'permanent'},{'X-Host-Secret':'secret-host'})).status,400);
    assert.equal((await request('/decision',{userId:'b',action:'restore'},{'X-Host-Secret':'secret-host'})).status,200);assert.equal(doc.communityRestrictions.length,0);
    assert.ok(bob.departedAt); // Permission to return does not pretend the guest has returned.
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('private data excluded from generic party reads and admission guard handles expiration',async()=>{
  for(const field of ['privateMessages','communityReports','communityRestrictions'])assert.equal(Party.schema.path(field).options.select,false);
  let restrictions=[{userId:'a',kind:'temporary',until:new Date(Date.now()+900000).toISOString()}];
  const PartyModel={findOne(){return{select(){return this},async lean(){return{communityRestrictions:restrictions,participants:[{userId:'a',departedAt:new Date().toISOString()}]}}}}};
  const guard=communityAccessGuard({parties:new Map(),PartyModel,authenticate:async()=>({_id:'a'})});
  async function check(path){let status=null,passed=false;const req={method:'POST',path,headers:{authorization:'Bearer valid'},body:{}};const res={status(n){status=n;return this},json(){}};await guard(req,res,()=>{passed=true});return{status,passed};}
  assert.equal((await check('/ABC123/request-join')).status,403);
  restrictions=[{userId:'a',kind:'temporary',until:new Date(Date.now()-1).toISOString()}];
  assert.equal((await check('/ABC123/request-join')).passed,true);
  assert.equal((await check('/ABC123/suggest')).status,403);
});
