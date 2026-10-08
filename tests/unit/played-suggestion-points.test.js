import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../server.js',import.meta.url),'utf8');
test('played suggestion earns twenty once and only for its suggester',()=>{
 const start=source.indexOf("      if (requestedBy.source === 'suggestion' && requestedBy.guestId)");
 const end=source.indexOf('// ★ Fresh Rotation',start);
 const credits=[];
 const ctx={party:{code:'LOCAL',suggestions:[{id:'one',title:'Song',guestName:'Guest'}]},requestedBy:{source:'suggestion',guestId:'guest-one',guestName:'Guest'},track:{title:'Song'},addPoints:(...args)=>credits.push(args),Party:{findOneAndUpdate:()=>Promise.resolve()},console};
 vm.createContext(ctx);
 vm.runInContext(source.slice(start,end),ctx);
 vm.runInContext(source.slice(start,end),ctx);
 assert.equal(credits.length,1);assert.equal(credits[0][1],'guest-one');assert.equal(credits[0][3],20);
 assert.ok(ctx.party.suggestions[0].scoredAt);
});
