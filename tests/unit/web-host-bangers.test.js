import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../public/app.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function loadMyData()'),source.indexOf('// Exclude tracks already played'));
const calls=[];const c={window:{AhOuaiHostEngine:{getCode:()=> 'ABC123'}},state:{partyCode:'ABC123'},_myDataLoaded:false,myDataError:null,MY_SUGS_MAX:15,v2SuggestionSource:'bangers',getProfileJwt:async()=> 'test-jwt',fetch:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({items:[{title:'Song',artist:'Artist',artworkUrl:'cover',count:3}]})}},isPlayedInCurrentParty:()=>false,renderMyTops(){},renderMySugs(){},renderV2Bangers(){}};
vm.createContext(c);vm.runInContext(fn,c);
(async()=>{await c.loadMyData();assert.equal(calls.length,2);assert.equal(calls[0].opts.headers.Authorization,'Bearer test-jwt');assert.equal(c.myTopsData[0].coverURL,'cover');assert.equal(c.myTopsData[0].myFireCount,3);assert.equal(c.myDataError,null);await c.loadMyData();assert.equal(calls.length,2);c._myDataLoaded=false;c.fetch=async()=>({ok:false});await c.loadMyData();assert.equal(c._myDataLoaded,false);assert.ok(c.myDataError);console.log('PASS host Bangers without socket, authenticated history, artwork/counts, retry');})();
