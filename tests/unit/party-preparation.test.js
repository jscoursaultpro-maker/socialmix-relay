import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import preparationRouter from '../../routes/party-preparation.js';

const hostID='aaaaaaaaaaaaaaaaaaaaaaaa', friendID='bbbbbbbbbbbbbbbbbbbbbbbb';
const secret='host-secret-test-123456789';
const future=()=>new Date(Date.now()+86400000).toISOString();

test('preparation ownership, invitation and registration lifecycle',async()=>{
  const docs=new Map(),ram=new Map(),events=[];
  const doc=data=>Object.assign({participants:[],pendingGuests:[],preApprovedGuests:[],scheduledInvitations:[],sessionTokens:{},endedAt:null,save:async function(){docs.set(this.code,this);}},data);
  const PartyModel={
    create:async data=>{if(docs.has(data.code))throw Object.assign(new Error('duplicate'),{code:11000});const p=doc(data);docs.set(p.code,p);return p;},
    findOne:async({code})=>docs.get(code)||null,
    find:()=>({sort:()=>({limit:()=>({lean:async()=>[...docs.values()].filter(p=>p.isPreParty)})})})
  };
  const UserModel={findById:()=>({select:()=>({lean:async()=>({friends:[{userId:friendID}]})})}),find:()=>({select:()=>({lean:async()=>[{_id:friendID,profile:{firstName:'Léa',photoURL:'https://example.com/lea.jpg'}}]})})};
  const FriendshipModel={find:()=>({lean:async()=>[]})};
  const io={sockets:{sockets:new Map()},to:()=>({emit:(...args)=>events.push(args)})};
  const app=express();app.use('/api/party',preparationRouter({parties:ram,io,PartyModel,UserModel,FriendshipModel,authenticate:async token=>{if(token!=='host')throw new Error('invalid');return {_id:hostID,profile:{firstName:'Jean-Sébastien'}};}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/party`;
  const call=async(path,method='GET',body,auth='host',withSecret=false)=>{
    const headers={'Content-Type':'application/json'};if(auth)headers.Authorization=`Bearer ${auth}`;if(withSecret)headers['X-Host-Secret']=secret;
    const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};
  };
  try {
    const create={code:'ABC123',hostSecret:secret,partyName:'Samedi chez nous',scheduledFor:future(),welcomeText:'Ensemble'};
    assert.equal((await call('/schedule','POST',create)).status,201);
    const p=docs.get('ABC123');assert.equal(p.isPreParty,true);assert.equal(p.lifecycle.status,'scheduled');assert.equal(p.hostUserId,hostID);
    assert.equal((await call('/schedule','POST',create)).status,409);
    assert.equal((await call('/schedule','POST',{...create,code:'XYZ123',scheduledFor:'invalid'})).status,400);
    assert.equal((await call('/ABC123/preparation','GET',null,null)).status,403);
    assert.equal((await call('/ABC123/preparation','GET',null,'wrong')).status,401);
    assert.equal((await call('/ABC123/preparation','GET',null,null,true)).status,200);
    assert.equal((await call('/ABC123/preparation/friends','POST',{userIds:['cccccccccccccccccccccccc']})).status,403);
    assert.equal((await call('/ABC123/preparation/friends','POST',{userIds:[friendID]})).status,200);
    assert.equal(p.participants.length,0,'invitation does not pretend attendance');assert.equal(p.scheduledInvitations[0].name,'Léa');assert.equal(String(p.preApprovedGuests[0]),friendID);
    await call('/ABC123/preparation/friends','POST',{userIds:[friendID]});assert.equal(p.scheduledInvitations.length,1,'idempotent invite');
    p.pendingGuests.push({userId:friendID,firstName:'Léa',photoURL:'https://example.com/lea.jpg',socketId:'guest-socket'});ram.set(p.code,{...p});
    io.sockets.sockets.set('guest-socket',{leave:()=>{},join:()=>{},emit:(...args)=>events.push(args)});
    assert.equal((await call(`/ABC123/preparation/requests/${friendID}`,'POST',{action:'accept'})).status,200);
    assert.equal(p.participants.length,1);assert.equal(p.pendingGuests.length,0);assert.equal(ram.get(p.code).participants.length,1);assert.equal(p.isPreParty,true);
    assert.equal(events.find(e=>e[0]==='guest:approved')[1].partyState.isPreParty,true);
    const details=(await call('/ABC123/preparation')).data;assert.equal(details.invited.length,0);assert.equal(details.participants[0].photoURL,'https://example.com/lea.jpg');
    assert.equal((await call(`/ABC123/preparation/requests/${friendID}`,'POST',{action:'accept'})).status,404);
    assert.equal((await call('/ABC123/preparation','PATCH',{...create,partyName:'Nouveau nom'})).status,200);assert.equal(p.partyName,'Nouveau nom');assert.equal(p.isPreParty,true);
    p.isPreParty=false;assert.equal((await call('/ABC123/preparation')).status,409);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
