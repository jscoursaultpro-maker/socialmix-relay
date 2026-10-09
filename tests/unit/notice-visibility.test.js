import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
test('New notices cancel old dismissal and allow at least six seconds to read', () => {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
  const w = dom.window; const timers = new Map(); let id = 0;
  w.setTimeout = (callback, delay) => { timers.set(++id, { callback, delay }); return id; };
  w.clearTimeout = key => timers.delete(key);
  w.eval(source.slice(source.indexOf('function showToast('), source.indexOf('function updateSuggestionBadge(')));
  for (const fn of [() => w.showToast('Information', 1000), () => w.showSuggestionToast('Ton titre passe !', 'played'), () => w.showFriendActionToast('Invitation reçue', 'user')]) {
    timers.clear(); fn(); fn();
    assert.equal(timers.size, 1);
    assert.ok([...timers.values()][0].delay >= 6000);
  }
  for (const notice of w.document.querySelectorAll('.ahouai-notice')) {
    assert.equal(notice.getAttribute('role'), 'status');
    assert.equal(notice.getAttribute('aria-live'), 'polite');
  }
  w.close();
});
