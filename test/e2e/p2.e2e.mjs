// Spec §6 P2 against real Chrome: compare two cookie sets, copy cookies to another
// store (normal <-> incognito), explain a cookie. Plus zero network across it.
//   node --test test/e2e/p2.e2e.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, loadExtension, prepareExtension } from './cdp.mjs';
import { createDriver, enableIncognito, sleep } from './driver.mjs';
import { startFixtures, CHROME_ARGS } from './fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fx; let browser; let ext; let id; let helper; let openTab; let openUi; let tab;
const scratch = mkdtempSync(join(tmpdir(), 'cookiedesk-p2-'));
const requests = [];

before(async () => {
  fx = await startFixtures();
  browser = await launchChrome({ args: CHROME_ARGS });
  ext = await prepareExtension(root, { hosts: ['*://*.a.test/*', '*://*.b.test/*'] });
  id = await loadExtension(browser.cdp, ext.dir);
  helper = await enableIncognito(browser, id);
  ({ openTab, openUi } = createDriver(browser, helper));
  tab = await openTab(fx.url('a.test/a'));
  browser.cdp.listeners.add((m) => {
    if (m.method === 'Network.requestWillBeSent' && m.params.request.url.startsWith('http')) requests.push(m.params.request.url);
  });
});

after(async () => {
  await browser?.close();
  await ext?.cleanup();
  fx?.close();
  rmSync(scratch, { recursive: true, force: true });
});

/** Poll until fn() is truthy; a timeout fails the test. */
async function until(fn, ms = 6000) {
  for (let t = 0; t < ms; t += 100) { const v = await fn(); if (v) return v; await sleep(100); }
  const v = await fn();
  if (!v) throw new Error(`timed out after ${ms} ms waiting for: ${fn.toString().slice(0, 140)}`);
  return v;
}
const dialogReady = (u, re) => until(() => u.run((src) => {
  const d = document.querySelector('[data-testid=confirm]');
  return d.open && new RegExp(src).test(d.querySelector('[data-testid=confirm-message]').textContent) && !d.querySelector('[data-testid=confirm-ok]').disabled;
}, re.source));
async function ui(tabId = tab) {
  const u = await openUi(id, tabId);
  await browser.cdp.send('Network.enable', {}, u.page.sessionId);
  await u.waitState('ready');
  return u;
}
async function pickFiles(u, testid, files) {
  const { root: doc } = await browser.cdp.send('DOM.getDocument', {}, u.page.sessionId);
  const { nodeId } = await browser.cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector: `[data-testid=${testid}]` }, u.page.sessionId);
  await browser.cdp.send('DOM.setFileInputFiles', { files, nodeId }, u.page.sessionId);
}
async function saveSet(u, dir, name) {
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  const before = new Set(readdirSync(dir));
  await u.click('save-set');
  await dialogReady(u, /password/i);
  await u.run((n) => { document.querySelector('[data-testid=set-name]').value = n; }, name);
  await u.click('confirm-ok');
  const f = await until(() => readdirSync(dir).find((x) => x.endsWith('.json') && !before.has(x)));
  return join(dir, f);
}
const texts = (u, testid) => u.run((t) => [...document.querySelectorAll(`[data-testid=${t}] .diff-item`)].map((x) => x.dataset.name).sort(), testid);

test('P2-1: compare a saved set with now — what a "login" added, removed and changed', async () => {
  const dl = mkdtempSync(join(scratch, 'dl-'));
  const u = await ui();
  const beforeLogin = await saveSet(u, dl, 'before login');
  // "Log in": the site sets a session, changes a value and a flag, drops a cookie, refreshes an expiry.
  await helper.run(async () => {
    await chrome.cookies.set({ url: 'https://a.test/', name: 'sid', value: 'session-123', secure: true, httpOnly: true, sameSite: 'lax' });
    await chrome.cookies.set({ url: 'https://a.test/', name: 'a_plain', value: 'logged-in', secure: true, sameSite: 'strict', expirationDate: Date.now() / 1000 + 7200 });
    await chrome.cookies.remove({ url: 'https://a.test/', name: 'a_session' });
    const [h] = await chrome.cookies.getAll({ name: 'a_http' });
    await chrome.cookies.set({ url: 'https://a.test/', name: 'a_http', value: h.value, secure: true, httpOnly: true, sameSite: 'strict', expirationDate: h.expirationDate + 600 });
  });
  await until(async () => (await u.rows()).includes('sid'));

  await pickFiles(u, 'compare-file', [beforeLogin]);
  await until(() => u.count('diff-view'));
  assert.match(await u.run(() => document.querySelector('.diff-sides').textContent), /"before login".*→.*a\.test now/);
  assert.deepEqual(await texts(u, 'diff-added'), ['sid']);
  assert.deepEqual(await texts(u, 'diff-removed'), ['a_session']);
  assert.deepEqual(await texts(u, 'diff-changed'), ['a_plain']);
  assert.match(await u.run(() => document.querySelector('[data-testid=diff-changed]').textContent), /Changed: value, expiry, sameSite.*one → logged-in/);
  assert.deepEqual(await texts(u, 'diff-expiry'), ['a_http']);
  assert.match(await u.text('diff-summary'), /1 added, 1 removed, 2 changed/);

  // Back to the list with Esc.
  await u.run(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await until(async () => !(await u.count('diff-view')));

  // Two set files compare with each other, older first, whatever order they are picked in.
  const afterLogin = await saveSet(u, dl, 'after login');
  await pickFiles(u, 'compare-file', [afterLogin, beforeLogin]);
  await until(() => u.count('diff-view'));
  assert.match(await u.run(() => document.querySelector('.diff-sides').textContent), /"before login".*→.*"after login"/);
  assert.deepEqual(await texts(u, 'diff-added'), ['sid']);
  await u.close();
});

test('P2-2: copy shown cookies from the normal store to incognito, and undo the copy there', async () => {
  const win = await helper.run(async (url) => {
    const w = await chrome.windows.create({ incognito: true, url });
    return { windowId: w.id, tabId: w.tabs[0].id };
  }, fx.url('a.test/c-none'));
  await sleep(800);
  const stores = await helper.run(() => chrome.cookies.getAllCookieStores());
  const incog = stores.find((s) => s.tabIds.includes(win.tabId)).id;
  const inIncog = () => helper.run(async (s) => (await chrome.cookies.getAll({ storeId: s, domain: 'a.test', partitionKey: {} })).map((c) => `${c.name}=${c.value}${c.partitionKey ? '*' : ''}`).sort(), incog);
  assert.deepEqual(await inIncog(), []);
  // The incognito store has its own a_plain, protected: the copy must leave it alone.
  await helper.run(async (st) => {
    await chrome.cookies.set({ url: 'https://a.test/', name: 'a_plain', value: 'incog-own', secure: true, sameSite: 'lax', storeId: st });
    await chrome.storage.session.set({ protected: [`${st}||a.test|/|a_plain`] });
  }, incog);

  const u = await ui();
  await until(() => u.run(() => !document.querySelector('[data-testid=copy-store]').hidden));
  await u.search('a_');
  await u.click('copy-store');
  await dialogReady(u, /From the Default store/);
  assert.equal(await u.run(() => document.querySelector('[data-testid=copy-target]').value), incog);
  const listed = await u.run(() => [...document.querySelectorAll('[data-testid=copy-list] li')].map((x) => x.textContent).sort());
  assert.ok(listed.includes('a_plain') && listed.includes('a_http') && !listed.includes('sid'), listed.join(','));
  await u.click('confirm-ok');
  const copied = await until(async () => { const j = await inIncog(); return j.length === 3 && j; }).catch(async (e) => { throw new Error(`${e.message} | toast: ${await u.text('toast')} | dialog open: ${await u.run(() => document.querySelector('[data-testid=confirm]').open)}`); });
  // a_http copied, a_part copied with its partition, the protected a_plain untouched.
  assert.deepEqual(copied, ['a_http=secret', 'a_part=p*', 'a_plain=incog-own']);
  const normal = await helper.run(async () => (await chrome.cookies.getAll({ storeId: '0', name: 'a_plain' }))[0]?.value);
  assert.equal(normal, 'logged-in', 'the normal store is unchanged');

  await until(() => u.count('toast-undo'));
  assert.match(await u.text('toast'), /Copied 2 cookies to Incognito\. 1 protected cookie there left as it was\. Undo it here/);
  await u.click('toast-undo');
  await until(async () => JSON.stringify(await inIncog()) === JSON.stringify(['a_plain=incog-own']));
  await u.close();
  await helper.run((w) => chrome.windows.remove(w), win.windowId);
});

test('P2-3: the editor explains the cookie in plain words, read-only', async () => {
  const u = await ui();
  await u.openRow('a_http');
  const topics = await u.run(() => Object.fromEntries([...document.querySelectorAll('[data-testid=explain] li')].map((li) => [li.dataset.topic, li.textContent])));
  assert.match(topics.httpOnly, /not visible to page JavaScript/);
  assert.match(topics.sameSite, /Strict/);
  assert.match(topics.secure, /HTTPS/);
  assert.match(topics.scope, /only to a\.test itself/);
  assert.ok(topics.size && topics.expiry && topics.path);
  await u.click('editor-cancel');
  await until(async () => !(await u.count('editor')));

  await u.openRow('a_part');
  assert.match(await u.run(() => document.querySelector('[data-testid=explain] [data-topic=partition]').textContent), /Partitioned \(CHIPS\).*while a\.test is the site in the address bar/);
  await u.click('editor-cancel');
  await u.close();
});

test('P2 session made zero network requests from the extension', () => {
  assert.deepEqual(requests, []);
});
