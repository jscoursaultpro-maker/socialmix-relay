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

test('unauthenticated onboarding routes to SSO after web choice', async () => {
  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('async function showOnboarding(code) {');
  const fn = app.slice(start, app.indexOf('\n}', start) + 2);
  for (const modal of [false, true]) {
    let destination; let continuation;
    const context = { URL, initSupabaseSSO:async()=>{}, getProfileJwt:async()=>null, _sessionCallbackHandled:false, state:{chantier5:{}}, window:{location:{href:'https://join.ahouai.com/guest?code=KL64CE',replace:url=>destination=url}},
      document:{querySelector:()=>modal,addEventListener:(name,fn)=>{assert.equal(name,'guest:web-continue');continuation=fn;}} };
    await runInNewContext(fn + '; showOnboarding("kl64ce");', context);
    if (modal) { assert.equal(destination,undefined); await continuation(); }
    const login = new URL(destination);
    assert.equal(login.pathname, '/login');
    assert.equal(login.searchParams.get('redirect'), 'https://join.ahouai.com/guest?code=KL64CE&sb=1');
    assert.ok(!destination.includes('/join/'));
  }
});

const appSource = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
function appFunction(name) {
  const start = appSource.indexOf(`async function ${name}(`);
  return appSource.slice(start, appSource.indexOf('\n}', start) + 2);
}
test('SSO return joins without redirecting and missing shared session stops instead of looping', async () => {
  for (const authenticated of [true, false]) {
    let joins = 0; let notices = 0;
    const session = {access_token:'test'};
    const context = {URL, state:{chantier5:{}},
      window:{location:{href:'https://join.ahouai.com/guest?code=ABC123&sb=1',replace:()=>assert.fail('login loop')}},
      document:{querySelector:()=>null}, initSupabaseSSO:async()=>{},
      getProfileJwt:async()=>authenticated?'test':null, _sessionCallbackHandled:false,
      _supabaseClient:{auth:{getSession:async()=>({data:{session}})}},
      handleSupabaseSession:async()=>{joins++;}, showToast:()=>{notices++;}};
    await runInNewContext(appFunction('showOnboarding')+'; showOnboarding("ABC123");',context);
    assert.equal(joins, authenticated ? 1 : 0);
    assert.equal(notices, authenticated ? 0 : 1);
  }
});
test('admission ACK controls entry: pending waits, approved enters', async () => {
  for (const status of ['pending','approved']) {
    let entered=0; let waiting=0;
    const context={state:{partyCode:'ABC123'}, getProfileJwt:async()=>'verified', window:{}, $:()=>null, console,
      socket:{emit:(event,payload,ack)=>{
        assert.equal(event,'guest:requestJoin'); assert.equal(payload.code,'ABC123');
        assert.equal(payload.accessToken,'verified'); assert.equal(payload.firstName,'Daphné');
        ack({ok:true,status});}}, enterCockpitFromOnboarding:()=>entered++,showWaitingRoom:()=>waiting++};
    await runInNewContext(appFunction('_emitRequestJoin')+'; _emitRequestJoin("Daphné","Test","test@example.com");',context);
    assert.equal(entered,status==='approved'?1:0); assert.equal(waiting,status==='pending'?1:0);
  }
});
