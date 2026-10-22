// Phase 5 (spec §6 P1) against real Chrome: protect, bulk delete, cookie sets,
// keyboard, live view, document.cookie snippet. Plus zero network across all of it.
//   node --test test/e2e/p1.e2e.mjs
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, loadExtension, openExtensionPage, prepareExtension } from './cdp.mjs';
import { createDriver, sleep } from './driver.mjs';
import { startFixtures, CHROME_ARGS } from './fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fx; let browser; let ext; let id; let helper; let openTab; let openUi; let tab;
const scratch = mkdtempSync(join(tmpdir(), 'cookiedesk-p1-'));
const requests = [];

before(async () => {
  fx = await startFixtures();
  browser = await launchChrome({ args: CHROME_ARGS });
  ext = await prepareExtension(root, { hosts: ['*://*.a.test/*', '*://*.b.test/*'] });
  id = await loadExtension(browser.cdp, ext.dir);
  helper = await openExtensionPage(browser.cdp, `chrome-extension://${id}/e2e/harness.html`);
  ({ openTab, openUi } = createDriver(browser, helper));
  tab = await openTab(fx.url('a.test/a'));
  // Every extension page and the worker: any request at all fails the last test.
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

/** Fresh cookie jar for a.test (as the fixture sets it) and no protections. */
beforeEach(async () => {
  await browser.cdp.send('Storage.clearCookies');
  await helper.run(() => Promise.all([chrome.storage.local.remove('protected'), chrome.storage.session.remove('protected')]));
  await helper.run(async (t, u) => { await chrome.tabs.update(t, { url: u }); }, tab, fx.url('a.test/a'));
  for (let i = 0; i < 50; i++) {
    const n = await helper.run(async () => (await chrome.cookies.getAll({ domain: 'a.test', partitionKey: {} })).length);
    if (n >= 4) break;
    await sleep(100);
  }
});

async function ui() {
  const u = await openUi(id, tab);
  await browser.cdp.send('Network.enable', {}, u.page.sessionId);
  await u.waitState('ready');
  return u;
}
const jar = () => helper.run(async () => (await chrome.cookies.getAll({ domain: 'a.test', partitionKey: {} }))
  .map((c) => `${c.name}=${c.value}`).sort());
/** Poll until fn() is truthy and return it; a timeout fails the test (never a silent pass). */
async function until(fn, ms = 5000) {
  for (let t = 0; t < ms; t += 100) { const v = await fn(); if (v) return v; await sleep(100); }
  const v = await fn();
  if (!v) throw new Error(`timed out after ${ms} ms waiting for: ${fn.toString().slice(0, 140)}`);
  return v;
}
/** The confirm dialog is open with a message matching `re` and its OK button enabled. */
const dialogReady = (u, re) => until(() => u.run((src) => {
  const d = document.querySelector('[data-testid=confirm]');
  return d.open && new RegExp(src).test(d.querySelector('[data-testid=confirm-message]').textContent)
    && !d.querySelector('[data-testid=confirm-ok]').disabled;
}, re.source));
const key = (u, k, opts = {}) => u.run((k2, o) => {
  const t = document.activeElement ?? document.body;
  t.dispatchEvent(new KeyboardEvent('keydown', { key: k2, bubbles: true, cancelable: true, ...o }));
}, k, opts);
async function pickFile(u, testid, path) {
  const { root: doc } = await browser.cdp.send('DOM.getDocument', {}, u.page.sessionId);
  const { nodeId } = await browser.cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector: `[data-testid=${testid}]` }, u.page.sessionId);
  await browser.cdp.send('DOM.setFileInputFiles', { files: [path], nodeId }, u.page.sessionId);
}

test('P1-1 + P1-2: protect a cookie; bulk delete lists what dies, skips it, and undoes in one step', async () => {
  const u = await ui();
  const start = await jar();
  await u.run(() => document.querySelector('[data-testid=cookie-row][data-name=a_plain] [data-testid=row-protect]').click());
  await until(() => u.run(() => document.querySelector('[data-testid=cookie-row][data-name=a_plain]').dataset.protected === 'true'));
  assert.equal(await u.count('badge-protected'), 1);
  // Stored by identity only: the value never reaches storage.local.
  const stored = JSON.stringify(await helper.run(() => chrome.storage.local.get(null)));
  assert.match(stored, /a_plain/);
  assert.ok(!stored.includes('"one"') && !stored.includes('one"'), 'no cookie value in storage.local');

  await u.search('a_');
  await u.click('bulk-delete');
  await dialogReady(u, /^These cookies match/);
  const listed = await u.run(() => [...document.querySelectorAll('[data-testid=bulk-list] li .mono')].map((x) => x.textContent).sort());
  assert.deepEqual(listed, ['a_http', 'a_part', 'a_session']);
  assert.match(await u.run(() => document.querySelector('[data-testid=confirm]').textContent), /1 protected cookie will be kept/);
  await u.click('confirm-ok');
  await until(async () => (await jar()).length === start.length - 3);
  assert.deepEqual((await jar()).filter((x) => x.startsWith('a_')), ['a_plain=one']);

  await until(() => u.count('toast-undo'));
  await u.click('toast-undo');
  await until(async () => (await jar()).length === start.length);
  assert.deepEqual(await jar(), start);
  await u.close();
});

test('P1-1: a protected cookie asks before a single delete, and import leaves it alone', async () => {
  const u = await ui();
  await u.run(() => document.querySelector('[data-testid=cookie-row][data-name=a_plain] [data-testid=row-protect]').click());
  await until(() => u.count('badge-protected'));
  await u.run(() => document.querySelector('[data-testid=cookie-row][data-name=a_plain] [data-testid=row-delete]').click());
  await dialogReady(u, /protected/);
  await u.click('confirm-cancel');
  assert.ok((await jar()).includes('a_plain=one'));

  const path = join(scratch, 'overwrite.json');
  writeFileSync(path, JSON.stringify([
    { name: 'a_plain', value: 'attacker', domain: 'a.test', path: '/', secure: true, sameSite: 'lax' },
    { name: 'imported', value: 'x', domain: 'a.test', path: '/', secure: true },
  ]));
  await until(() => u.run(() => !document.querySelector('[data-testid=confirm]').open));
  await pickFile(u, 'import-file', path);
  await dialogReady(u, /^Import 2 cookies/);
  await u.click('confirm-ok');
  await until(async () => (await jar()).includes('imported=x'));
  assert.ok((await jar()).includes('a_plain=one'), 'protected cookie not overwritten');
  const toast = await until(async () => { const t = await u.text('toast'); return /^Imported/.test(t ?? '') && t; });
  assert.match(toast || `toast now: ${await u.text('toast')} | dialog open: ${await u.run(() => document.querySelector('[data-testid=confirm]').open)} | msg: ${await u.text('confirm-message')}`, /1 protected cookie left as it was: a_plain/);
  await u.close();
});

test('P1-3: save a set to a file, change things, restore it exactly, undo the restore', async () => {
  const dl = mkdtempSync(join(scratch, 'dl-'));
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  const u = await ui();
  const saved = await jar();
  await u.click('save-set');
  await dialogReady(u, /password/i);
  await u.run(() => { document.querySelector('[data-testid=set-name]').value = 'logged in as admin'; });
  await u.click('confirm-ok');
  const file = await until(() => readdirSync(dl).find((f) => f.endsWith('.json')));
  assert.equal(file, 'cookieset-logged_in_as_admin-a.test.json');
  const data = JSON.parse(readFileSync(join(dl, file), 'utf8'));
  assert.equal(data.set, 'logged in as admin');
  assert.equal(data.site, 'a.test');
  // Nothing about the set was kept inside the extension.
  assert.ok(!JSON.stringify(await helper.run(() => chrome.storage.local.get(null))).includes('admin'));

  // Change the jar: edit one, add one, delete one, and protect another.
  await helper.run(async () => {
    await chrome.cookies.set({ url: 'https://a.test/', name: 'a_plain', value: 'changed', secure: true, sameSite: 'lax' });
    await chrome.cookies.set({ url: 'https://a.test/', name: 'extra', value: 'e', secure: true });
    await chrome.cookies.remove({ url: 'https://a.test/', name: 'a_session' });
  });
  await sleep(400);
  const changed = await jar();
  await u.run(() => document.querySelector('[data-testid=cookie-row][data-name=a_http] [data-testid=row-protect]').click());
  await until(() => u.count('badge-protected'));

  await pickFile(u, 'restore-file', join(dl, file));
  await until(() => u.count('restore-plan'));
  await dialogReady(u, /will be replaced/);
  const plan = await u.run(() => Object.fromEntries(['restore-write', 'restore-delete', 'restore-skipped'].map((t) => [t, [...document.querySelectorAll(`[data-testid=${t}] li`)].map((x) => x.textContent).sort()])));
  assert.deepEqual(plan['restore-write'], ['a_plain', 'a_session']);
  assert.deepEqual(plan['restore-delete'], ['extra']);
  assert.deepEqual(plan['restore-skipped'], ['a_http']);
  await u.click('confirm-ok');
  await until(async () => JSON.stringify(await jar()) === JSON.stringify(saved));
  assert.deepEqual(await jar(), saved);

  await until(() => u.count('toast-undo'));
  assert.match(await u.text('toast'), /Restored "logged in as admin"/);
  await u.click('toast-undo');
  await until(async () => JSON.stringify(await jar()) === JSON.stringify(changed));
  assert.deepEqual(await jar(), changed);
  await u.close();
});

test('P1-3: a set saved for another site is refused, and nothing changes', async () => {
  const u = await ui();
  const start = await jar();
  const path = join(scratch, 'other.json');
  writeFileSync(path, JSON.stringify({ format: 'cookiedesk', version: 1, site: 'c.test', set: 'x', cookies: [{ name: 'k', value: 'v', domain: 'c.test', hostOnly: true, path: '/', secure: true, httpOnly: false, sameSite: 'lax', session: true }] }));
  await pickFile(u, 'restore-file', path);
  await until(() => u.run(() => document.querySelector('[data-testid=confirm]').open));
  assert.match(await u.text('confirm-message'), /saved for c\.test/);
  await u.click('confirm-ok');
  assert.deepEqual(await jar(), start);
  await u.close();
});

test('P1-4: keyboard-first — search, move, protect, copy, delete, undo, add, shortcuts', async () => {
  const u = await ui();
  await u.run(() => { window.__clip = null; navigator.clipboard.writeText = async (t) => { window.__clip = t; }; });
  await u.run(() => document.body.focus());
  await key(u, '/');
  assert.equal(await u.run(() => document.activeElement.dataset.testid), 'search');
  await key(u, 'ArrowDown');
  const first = await u.run(() => document.activeElement.dataset.name);
  assert.ok(first);
  await key(u, 'End');
  const last = await u.run(() => document.activeElement.dataset.name);
  assert.notEqual(last, first);
  await key(u, 'Home');
  assert.equal(await u.run(() => document.activeElement.dataset.name), first);

  await key(u, 'c');
  assert.equal(await until(() => u.run(() => window.__clip)), await helper.run(async (n) => (await chrome.cookies.getAll({ name: n, partitionKey: {} }))[0].value, first));
  await key(u, 'p');
  await until(() => u.run((n) => document.querySelector(`[data-testid=cookie-row][data-name="${n}"]`).dataset.protected === 'true', first));

  // Delete the a_session row by keyboard, then undo with Ctrl+Z.
  await u.run(() => document.querySelector('[data-testid=cookie-row][data-name=a_session]').focus());
  await key(u, 'Delete');
  await until(async () => !(await jar()).includes('a_session=s'));
  await u.run(() => document.body.focus());
  await until(() => u.run(() => !document.querySelector('[data-testid=undo-last]').disabled));
  await key(u, 'z', { ctrlKey: true });
  await until(async () => (await jar()).includes('a_session=s'));
  assert.ok((await jar()).includes('a_session=s'));

  await u.run(() => document.body.focus());
  await key(u, 'n');
  await until(() => u.count('editor'));
  assert.equal(await u.run(() => document.activeElement.getAttribute('name')), 'name');
  await key(u, 'Escape');
  await until(async () => !(await u.count('editor')));

  await u.run(() => document.body.focus());
  await key(u, '?');
  await until(() => u.count('shortcut-list'));
  assert.match(await u.text('shortcut-list'), /Protect/);
  await u.click('confirm-ok');
  await u.close();
});

test('P1-5: live view — what the site changes is highlighted and named; CookieDesk\'s own edits are not reported', async () => {
  const u = await ui();
  await helper.run(async () => {
    await chrome.cookies.set({ url: 'https://a.test/', name: 'a_plain', value: 'site-changed', secure: true, sameSite: 'lax' });
    await chrome.cookies.set({ url: 'https://a.test/', name: 'live_new', value: '1', secure: true });
  });
  const line = await until(() => u.text('live-activity'));
  assert.match(line, /a_plain changed/);
  assert.match(line, /live_new added/);
  const marks = await u.run(() => [...document.querySelectorAll('[data-testid=cookie-row].fresh')].map((r) => `${r.dataset.name}:${r.dataset.change}`).sort());
  assert.deepEqual(marks, ['a_plain:changed', 'live_new:added']);

  // Our own edit: highlighted maybe, but never announced as the site's doing.
  await until(async () => !(await u.count('live-activity')), 12000);
  await u.openRow('a_session');
  await u.field('value', 'mine');
  await u.click('editor-save');
  await until(async () => (await jar()).includes('a_session=mine'));
  await sleep(800);
  assert.equal(await u.count('live-activity'), 0);
  await u.close();
});

test('P1-6: Copy as document.cookie warns, leaves HttpOnly out, and the snippet sets the cookies', async () => {
  const u = await ui();
  await u.run(() => { window.__clip = null; navigator.clipboard.writeText = async (t) => { window.__clip = t; }; });
  await u.click('export-snippet');
  await dialogReady(u, /password/i);
  assert.match(await u.run(() => document.querySelector('[data-testid=confirm]').textContent), /1 HttpOnly cookie left out/);
  await u.click('confirm-ok');
  const snippet = await until(() => u.run(() => window.__clip));
  assert.match(snippet, /document\.cookie = "a_plain=one; Path=\/; Expires=.*; Secure; SameSite=Lax";/);
  assert.ok(!/a_http=/.test(snippet), 'HttpOnly cookie not in the snippet');

  // Run it on the site itself: the cookies it sets match.
  await browser.cdp.send('Storage.clearCookies');
  const { targetInfos } = await browser.cdp.send('Target.getTargets');
  const site = targetInfos.find((t) => t.type === 'page' && t.url.startsWith(fx.url('a.test/a')));
  const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId: site.targetId, flatten: true });
  await browser.cdp.send('Runtime.evaluate', { expression: snippet }, sessionId);
  // document.cookie reaches the browser's cookie store asynchronously.
  await until(async () => { const got = await jar(); return got.includes('a_plain=one') && got.includes('a_session=s') && got.includes('a_part=p'); });
  const part = await helper.run(async () => (await chrome.cookies.getAll({ name: 'a_part', partitionKey: {} }))[0]?.partitionKey?.topLevelSite);
  assert.equal(part, 'https://a.test');
  await browser.cdp.send('Target.detachFromTarget', { sessionId });
  await u.close();
});

test('P1 session made zero network requests from the extension', () => {
  assert.deepEqual(requests, []);
});
