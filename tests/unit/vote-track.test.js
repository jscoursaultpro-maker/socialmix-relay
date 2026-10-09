import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVoteTrackTitle } from '../../lib/vote-track.js';
test('iOS titles and web IDs preserve distinct fire vote keys', () => {
  const party = {currentTrack:{id:'2',title:'Second'},trackHistory:[{id:'1',title:'First'}]};
  assert.equal(resolveVoteTrackTitle(party,{trackTitle:'First'}),'First');
  assert.equal(resolveVoteTrackTitle(party,{trackId:'2'}),'Second');
  assert.equal(resolveVoteTrackTitle(party,{trackId:'current'}),'Second');
  assert.equal(resolveVoteTrackTitle({},{}),null);
  const votes={};
  for(const title of ['First','Second']) votes[resolveVoteTrackTitle(party,{trackTitle:title})]='fire';
  assert.deepEqual(Object.keys(votes),['First','Second']);
});
