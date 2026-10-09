import test from 'node:test';
import assert from 'node:assert/strict';
import { sameSuggestedTrack, reconcilePlayedSuggestions } from '../../lib/suggestion-playback.js';
test('played suggestion cannot reappear as boostable after stale queued state', () => {
  const p = { suggestions: [{ title: 'Allons Voir', artist: 'Feu! Chatterton', status: 'queued' }], trackHistory: [{ title: 'ALLONS VOIR', artist: 'Feu Chatterton', playedAt: '2026-10-09T08:00:00Z' }] };
  assert.equal(reconcilePlayedSuggestions(p), true);
  assert.equal(p.suggestions[0].status, 'played');
  assert.equal(p.suggestions[0].playedAt, p.trackHistory[0].playedAt);
  assert.equal(reconcilePlayedSuggestions(p), false);
});
test('recording match preserves distinct artists/remixes and marks current playback', () => {
  assert.equal(sameSuggestedTrack({title:'One',artist:'A'}, {title:'One',artist:'B'}), false);
  assert.equal(sameSuggestedTrack({title:'One',artist:'A'}, {title:'One Remix',artist:'A'}), false);
  assert.equal(sameSuggestedTrack({title:'One'}, {title:'One'}), false);
  const p = {suggestions:[{title:'Localized',isrc:'ABC',status:'pending'}],currentTrack:{title:'Other',isrc:'abc'}};
  reconcilePlayedSuggestions(p);
  assert.equal(p.suggestions[0].status,'played');
});
