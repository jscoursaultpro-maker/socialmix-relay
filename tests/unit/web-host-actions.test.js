import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../public/shared/ui/host-engine.js',import.meta.url),'utf8');
const emit=source.slice(source.indexOf('  function emitHost('),source.indexOf('  // Retire un titre'));
const commands=source.slice(source.indexOf('  function approveGuest('),source.indexOf('  function normKey('));
test('every host admission and polling command carries the party credential',()=>{
  const sent=[];
  const context={party:{hostSecret:'local-only-secret'},sock:()=>({emit:(...args)=>sent.push(args)})};
  vm.createContext(context);vm.runInContext(emit+commands,context);
  context.approveGuest('participant');context.denyGuest('participant');context.setApprovalMode(true);
  for(let i=0;i<10;i++)context.requestHostState();
  assert.equal(sent.length,13);
  for(const [event,payload] of sent){assert.ok(event.startsWith('host:'));assert.equal(payload.hostSecret,'local-only-secret');}
  context.party=null;assert.equal(context.requestHostState(),false);assert.equal(sent.length,13);
});
const server=readFileSync(new URL('../../server.js',import.meta.url),'utf8');
test('shared actions accept the bound host and reject unapproved or spoofed participants',()=>{
  const start=server.indexOf('function getApprovedGuest('),end=server.indexOf('// ★ Chantier 5: resolve stable userId',start);
  const ctx={activeRestriction:()=>false};vm.createContext(ctx);vm.runInContext(server.slice(start,end),ctx);
  const socket={id:'host-socket',emit(){}};
  const party={hostSocketId:'host-socket',participants:[{id:'host-socket',isHost:true,connected:true}]};
  assert.equal(ctx.requireApprovedParticipant(party,socket).isHost,true);
  party.hostSocketId='different-socket';assert.equal(ctx.requireApprovedParticipant(party,socket),null);
  party.participants=[];assert.equal(ctx.requireApprovedParticipant(party,{id:'pending',emit(){}}),null);
});

test('reconnect resumes the server binding even with a party already in memory',()=>{
  const start=source.indexOf('  function resume() {');
  const end=source.indexOf('  // ── Task #67',start);
  const sent=[];
  const ctx={tracks:[{title:'Live queue'}],idx:0,autoAdvance:true,party:{code:'LOCAL1',hostSecret:'local-secret'},loadPersistedParty:()=>({code:'LOCAL1',hostSecret:'local-secret',provider:'youtube',tracks:[{title:'Old queue'}]}),sock:()=>({once(){},emit:(...args)=>sent.push(args)}),window:{},appState:()=>({guestName:'QA'}),log(){}};
  vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
  assert.equal(ctx.resume(),true);
  assert.equal(sent[0][0],'host:resumeParty');
  assert.equal(sent[0][1].hostSecret,'local-secret');
  assert.equal(ctx.tracks[0].title,'Live queue');
});

test('reload restores queue order, artwork, suggestion attribution and auto setting',()=>{
  const start=source.indexOf('  function resume() {'),end=source.indexOf('  // ── Task #67',start);
  const saved={code:'LOCAL2',hostSecret:'local-secret',tracks:[{trackId:'current',title:'Current'},{trackId:'next',title:'Next',coverArtURL:'https://example.test/cover.jpg',_guestName:'QA',_suggested:true}],index:0,autoAdvance:false};
  const ctx={tracks:[],idx:0,autoAdvance:true,party:null,loadPersistedParty:()=>saved,sock:()=>({once(){},emit(){}}),window:{},appState:()=>({guestName:'QA'}),log(){}};
  vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);ctx.resume();
  assert.equal(ctx.tracks[ctx.idx+1].title,'Next');
  assert.equal(ctx.tracks[1].coverArtURL,saved.tracks[1].coverArtURL);
  assert.equal(ctx.tracks[1]._guestName,'QA');
  assert.equal(ctx.autoAdvance,false);
});
