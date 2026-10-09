import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../../public/guest-app-choice.js', import.meta.url), 'utf8');
function page(path = '/guest?code=ABC123&sb=1', ios = true) {
  const dom = new JSDOM('<body></body>', { url: `https://join.ahouai.com${path}`, runScripts: 'outside-only' });
  Object.defineProperty(dom.window.navigator, 'userAgent', { value: ios ? 'iPhone' : 'Android' });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.eval(source);
  return dom;
}
test('Web arrival presents choice without navigating; refuse stays and suppresses repeat', () => {
  const dom = page(); const w = dom.window;
  assert.ok(w.document.querySelector('dialog').open);
  assert.equal(w.location.pathname, '/guest');
  assert.equal(w.document.querySelector('.guest-choice-download').disabled, true);
  assert.equal(w.document.querySelector('.guest-choice-soon').textContent, 'COMING SOON');
  assert.equal(w.document.querySelector('.guest-choice-store a').href, 'ahouai://join?code=ABC123');
  w.document.querySelector('button').click();
  assert.equal(w.document.querySelector('dialog'), null);
  assert.equal(w.location.pathname, '/guest');
  w.eval(source);
  assert.equal(w.document.querySelector('dialog'), null);
  w.close();
});
test('Escape dismisses without opening app; acceptance is a user-activated link', () => {
  const dom = page(); const w = dom.window;
  const link = w.document.querySelector('a');
  link.addEventListener('click', e => e.preventDefault()); // Avoid invoking a real app in tests.
  link.click();
  assert.equal(w.document.querySelector('dialog'), null);
  assert.equal(w.location.href, 'https://join.ahouai.com/guest?code=ABC123&sb=1');
  assert.equal(w.sessionStorage.getItem('ahouai:app-choice:ABC123'), 'chosen');
  w.sessionStorage.clear(); w.eval(source);
  w.document.querySelector('dialog').dispatchEvent(new w.Event('cancel', { cancelable: true }));
  assert.equal(w.document.querySelector('dialog'), null);
  w.close();
});
test('No prompt for desktop/Android, host entry or invalid party code', () => {
  for (const [path, ios] of [['/guest?code=ABC123', false], ['/?code=ABC123', true], ['/guest?code=bad!', true]]) {
    const dom = page(path, ios);
    assert.equal(dom.window.document.querySelector('dialog'), null);
    dom.window.close();
  }
});
test('Guest web path cannot match an associated app route', () => {
  const aasa = JSON.parse(readFileSync(new URL('../../public/.well-known/apple-app-site-association', import.meta.url)));
  assert.deepEqual(aasa.applinks.details[0].components[0]['exclude'], true);
  assert.equal(aasa.applinks.details[0].components[0]['/'], '/guest');
  assert.ok(aasa.applinks.details[0].components.every(route => route.exclude === true));
});

test('retired onboarding always routes to SSO with the party code, after web choice', () => {
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function showOnboarding(code) {');
  const fn = app.slice(start, app.indexOf('\n}', start) + 2);
  for (const modal of [false, true]) {
    let destination; let continuation;
    const context = { state:{chantier5:{}}, window:{location:{replace:url=>destination=url}},
      document:{querySelector:()=>modal,addEventListener:(name,fn)=>{assert.equal(name,'guest:web-continue');continuation=fn;}} };
    runInNewContext(fn + '; showOnboarding("kl64ce");', context);
    if (modal) { assert.equal(destination,undefined); continuation(); }
    assert.equal(destination,'https://ahouai.com/join/KL64CE/auth');
  }
});
