import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestionResponse } from '../../routes/user-last-suggestions.js';

test('Bangers retain suggestions without a Deezer identifier', () => {
  const result = suggestionResponse({ suggestion: { title: 'Apple song', artist: 'Artist', eventId: 'event-1' }, partyCode: 'ABC123' });
  assert.equal(result.title, 'Apple song');
  assert.equal(result.deezerID, null);
  assert.equal(result.id, 'event-1');
});
test('Bangers retain Deezer metadata and stable fallback identity', () => {
  const result = suggestionResponse({ suggestion: { title: 'One More Time', artist: 'Daft Punk', deezerID: 123, coverURL: 'https://example.com/cover.jpg' } });
  assert.equal(result.deezerID, 123);
  assert.equal(result.coverURL, 'https://example.com/cover.jpg');
  assert.equal(result.id, 'one_more_time_daft_punk');
});
