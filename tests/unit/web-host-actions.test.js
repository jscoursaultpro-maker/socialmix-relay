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
