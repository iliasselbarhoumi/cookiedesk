// Phase 3 robustness against real Chrome: incognito stores (test 16), service
// worker death (test 17), the popup dying mid-transaction, hostile cookie content
// and hostile import files through the UI, and a big cookie jar.
//   node --test test/e2e/robustness.e2e.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, loadExtension, openExtensionPage, prepareExtension, killServiceWorker, serviceWorkerTargets } from './cdp.mjs';
import { startFixtures, CHROME_ARGS } from './fixtures.mjs';
import { createDriver, sleep } from './driver.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fx; let browser; let ext; let id; let helper; let d; let tabA;
const scratch = mkdtempSync(join(tmpdir(), 'cookiedesk-robust-'));

/** All cookies of a store, canonicalised for comparison. */
const jar = (storeId = '0') => helper.run(async (s) => {
  const canon = (v) => (v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  return (await chrome.cookies.getAll({ storeId: s, partitionKey: {} })).map((c) => JSON.stringify(canon(c))).sort();
}, storeId);

async function devPrivate(code) {
  const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'chrome://extensions' });
  const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await sleep(800);
  const r = await browser.cdp.send('Runtime.evaluate', { expression: `(async () => { try { await (${code}); return 'ok'; } catch (e) { return 'ERROR: ' + e.message; } })()`, awaitPromise: true, returnByValue: true }, sessionId);
  await browser.cdp.send('Target.closeTarget', { targetId });
  return r.result.value;
}

before(async () => {
  fx = await startFixtures();
  browser = await launchChrome({ args: CHROME_ARGS });
  ext = await prepareExtension(root, { hosts: ['*://*.a.test/*', '*://*.b.test/*'] });
  id = await loadExtension(browser.cdp, ext.dir);
  // "Allow in Incognito" (test 16) — what the user toggles in chrome://extensions. It reloads the extension.
  assert.equal(await devPrivate(`chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${JSON.stringify(id)}, incognitoAccess: true })`), 'ok');
  // Branded Chrome disables a CDP-loaded unpacked extension when it reloads
  // ("unsupportedDeveloperExtension"); switching it back on keeps the incognito setting.
  await sleep(500);
  assert.equal(await devPrivate(`chrome.management.setEnabled(${JSON.stringify(id)}, true)`), 'ok');
  // Wait until a page from the reloaded extension sees incognito access.
  for (let i = 0; ; i++) {
    await sleep(500);
    helper = await openExtensionPage(browser.cdp, `chrome-extension://${id}/e2e/harness.html`);
    // (chrome.extension.isAllowedIncognitoAccess is gone in MV3; opening an incognito window is the real test.)
    const ok = await helper.run(async () => { const w = await chrome.windows.create({ incognito: true, url: 'about:blank' }); await chrome.windows.remove(w.id); return true; }).catch(() => false);
    if (ok) break;
    await browser.cdp.send('Target.closeTarget', { targetId: helper.targetId }).catch(() => {});
    if (i > 20) throw new Error('extension did not come back with incognito access');
  }
  d = createDriver(browser, helper);
  tabA = await d.openTab(fx.url('a.test/a'));
});

after(async () => {
  await browser?.close();
  await ext?.cleanup();
  fx?.close();
  rmSync(scratch, { recursive: true, force: true });
});

test('test 16: an incognito window has its own cookie store; the UI shows and edits only that store', async () => {
  const win = await helper.run(async (u) => {
    const w = await chrome.windows.create({ incognito: true, url: u });
    return { windowId: w.id, tabId: w.tabs[0].id };
  }, fx.url('a.test/a'));
  await sleep(1500);
  const stores = await helper.run(() => chrome.cookies.getAllCookieStores());
  const incog = stores.find((s) => s.tabIds.includes(win.tabId));
  assert.ok(incog && incog.id !== '0', `incognito tab has its own store (${JSON.stringify(stores)})`);

  // Make the two stores disagree about a_plain.
  await helper.run((s) => chrome.cookies.set({ url: 'https://a.test/', name: 'a_plain', value: 'incognito-value', secure: true, sameSite: 'lax', storeId: s }), incog.id);
  const ui = await d.openUi(id, win.tabId);
  await ui.waitState('ready');
  const sel = await ui.run(() => { const s = document.querySelector('[data-testid=store-select]'); return { hidden: s.hidden, value: s.value, label: s.selectedOptions[0]?.textContent }; });
  assert.equal(sel.hidden, false, 'store selector shown when there are two stores');
  assert.equal(sel.value, incog.id);
  assert.match(sel.label, /incognito/i);
  assert.equal(await ui.run(() => document.querySelector('[data-testid=cookie-row][data-name=a_plain] .value')?.textContent), 'incognito-value');

  // Edit and add through the UI: only the incognito store changes.
  const normalBefore = await jar('0');
  await ui.openRow('a_plain');
  await ui.field('value', 'edited-incognito');
  await ui.click('editor-save');
  await sleep(600);
  await ui.click('add-cookie');
  await sleep(200);
  await ui.field('name', 'incog_only');
  await ui.field('value', 'v');
  await ui.click('editor-save');
  await sleep(600);
  assert.deepEqual(await jar('0'), normalBefore, 'normal store untouched');
  const inIncog = await helper.run(async (s) => (await chrome.cookies.getAll({ storeId: s, name: 'incog_only' })).length + ':' + (await chrome.cookies.getAll({ storeId: s, name: 'a_plain' }))[0].value, incog.id);
  assert.equal(inIncog, '1:edited-incognito');

  // Switching the selector to the normal store shows the normal value.
  await ui.run(() => { const s = document.querySelector('[data-testid=store-select]'); s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(500);
  assert.equal(await ui.run(() => document.querySelector('[data-testid=cookie-row][data-name=a_plain] .value')?.textContent), 'one');
  await ui.close();

  // Closing the incognito window ends its undo copies (no incognito values left in memory).
  assert.ok((await helper.run(() => chrome.storage.session.get(null).then((all) => JSON.stringify(all)))).includes('edited-incognito'));
  await helper.run((w) => chrome.windows.remove(w), win.windowId);
  let leaked = true;
  for (let i = 0; i < 30 && leaked; i++) {
    await sleep(200);
    leaked = (await helper.run(() => chrome.storage.session.get(null).then((all) => JSON.stringify(all)))).includes('incognito-value');
  }
  assert.ok(!leaked, 'incognito cookie values purged from the undo journal');
});

test('test 17: service worker killed mid-session — UI keeps working, grants and undo intact, settings still applied', async () => {
  const ui = await d.openUi(id, tabA);
  await ui.waitState('ready');
  const permsBefore = await helper.run(() => chrome.permissions.getAll());
  // Wake the worker (it may be asleep), then kill it.
  await helper.run(() => chrome.storage.local.set({ ping: Date.now() }));
  for (let i = 0; i < 30 && !(await serviceWorkerTargets(browser.cdp, id)).length; i++) await sleep(100);
  await killServiceWorker(browser.cdp, id);

  await ui.openRow('a_plain');
  await ui.field('value', 'after-worker-death');
  await ui.click('editor-save');
  await sleep(600);
  assert.equal(await helper.run(async () => (await chrome.cookies.getAll({ name: 'a_plain', storeId: '0' }))[0].value), 'after-worker-death');
  assert.ok(!(await ui.run(() => document.querySelector('[data-testid=undo-last]').disabled)));
  await ui.click('undo-last');
  await sleep(600);
  assert.equal(await helper.run(async () => (await chrome.cookies.getAll({ name: 'a_plain', storeId: '0' }))[0].value), 'one');
  assert.deepEqual(await helper.run(() => chrome.permissions.getAll()), permsBefore);

  // The surface setting is applied by a restarted worker (storage.onChanged wakes it).
  await killServiceWorker(browser.cdp, id).catch(() => {});
  await helper.run(() => chrome.storage.local.set({ surface: 'sidepanel' }));
  let popup;
  for (let i = 0; i < 30; i++) { await sleep(150); popup = await helper.run(() => chrome.action.getPopup({})); if (popup === '') break; }
  assert.equal(popup, '', 'toolbar button opens the side panel');
  await helper.run(() => chrome.storage.local.set({ surface: 'popup' }));
  for (let i = 0; i < 30; i++) { await sleep(150); popup = await helper.run(() => chrome.action.getPopup({})); if (popup.endsWith('src/popup/popup.html')) break; }
  assert.match(popup, /src\/popup\/popup\.html$/);
  await ui.close();
});

test('the popup closing in the middle of an import still leaves an undo that restores the store exactly', async () => {
  const before = await jar();
  const ui = await d.openUi(id, tabA, { surface: 'popup', width: 460, height: 580 });
  await ui.waitState('ready');
  // The import runs in an extension page that we then close mid-way, as a popup closes on blur.
  const victim = await openExtensionPage(browser.cdp, `chrome-extension://${id}/e2e/harness.html`);
  await victim.run(() => {
    const drafts = Array.from({ length: 150 }, (_, i) => ({ name: `bulk_${i}`, value: `v${i}`, domain: 'a.test', hostOnly: true, path: '/', secure: true }));
    drafts.unshift({ name: 'a_plain', value: 'clobbered', domain: 'a.test', hostOnly: true, path: '/', secure: true, sameSite: 'lax' });
    engine.importDrafts(drafts, { storeId: '0' });
  });
  await sleep(150);
  await browser.cdp.send('Target.closeTarget', { targetId: victim.targetId });
  await sleep(300);
  const midway = await helper.run(async () => (await chrome.cookies.getAll({ storeId: '0' })).filter((c) => c.name.startsWith('bulk_')).length);
  assert.ok(midway > 0 && midway < 150, `the transaction really was cut off part-way (${midway}/150 written)`);
  await ui.close();

  const ui2 = await d.openUi(id, tabA, { surface: 'popup', width: 460, height: 580 });
  await ui2.waitState('ready');
  assert.match(await ui2.run(() => document.querySelector('[data-testid=undo-last]').title), /Undo interrupted: Imported 151/);
  await ui2.click('undo-last');
  await sleep(1500);
  assert.deepEqual(await jar(), before, 'store back exactly as before the interrupted import');
  await ui2.close();
});

test('hostile cookie content renders as inert text: no markup, no requests, no dialogs', async () => {
  const evil = {
    // Chrome refuses '=' and ';' in names and ';' in values; these are what it accepts.
    name: '<script>alert(1)</script><b>x</b>',
    value: '"><svg onload=alert(2)><img src=https://evil.test/v onerror=alert(3)>',
    path: '/"><img src=https://evil.test/p>',
  };
  await helper.run((e) => chrome.cookies.set({ url: 'https://a.test/', name: e.name, value: e.value, secure: true }), evil);
  await helper.run((e) => chrome.cookies.set({ url: 'https://a.test/', name: 'evilpath', value: e.value, path: e.path, secure: true }), evil);
  const ui = await d.openUi(id, tabA);
  const requests = [];
  const dialogs = [];
  browser.cdp.listeners.add((m) => {
    if (m.sessionId !== ui.page.sessionId) return;
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
    if (m.method === 'Page.javascriptDialogOpening') dialogs.push(m.params.message);
  });
  await browser.cdp.send('Network.enable', {}, ui.page.sessionId);
  await browser.cdp.send('Page.enable', {}, ui.page.sessionId);
  await ui.run(() => location.reload());
  await sleep(300);
  await ui.waitState('ready');
  await ui.openRow('evilpath');
  await sleep(300);
  const r = await ui.run(() => ({
    injected: document.querySelectorAll('main img, main svg:not([data-icon]) script, main script, [onerror], [onload]').length,
    names: [...document.querySelectorAll('[data-testid=cookie-row]')].map((x) => x.dataset.name).filter((n) => n.includes('<')),
  }));
  assert.equal(r.injected, 0);
  assert.equal(r.names.length, 1, 'the evil name is shown, as text');
  assert.deepEqual(requests.filter((u) => !/^(chrome-extension|data|blob):/.test(u)), []);
  assert.deepEqual(dialogs, []);
  await ui.close();
  await helper.run(async () => {
    for (const c of await chrome.cookies.getAll({ domain: 'a.test' })) if (c.name.includes('<') || c.name === 'evilpath') await chrome.cookies.set({ url: `https://a.test${c.path}`, name: c.name, value: '', path: c.path, secure: true, expirationDate: 1 });
  });
});

test('test 19 (UI): a hostile import file is refused with a specific message and writes nothing', async () => {
  const files = {
    'not-json.json': '{"cookies": [',
    'pollute.json': JSON.stringify([{ name: 'ok', value: '1', domain: 'a.test', path: '/', secure: true, __proto__: { polluted: true } }, { name: 'bad', value: '1', domain: 'a.test', path: '/', secure: false, sameSite: 'no_restriction' }]).replace('"name":"ok"', '"__proto__":{"polluted":true},"name":"ok"'),
    'suffix.json': JSON.stringify([{ name: 'x', value: '1', domain: '.test', hostOnly: false, path: '/', secure: true }]),
  };
  const before = await jar();
  const ui = await d.openUi(id, tabA);
  await ui.waitState('ready');
  const { root: docRoot } = await browser.cdp.send('DOM.getDocument', {}, ui.page.sessionId);
  for (const [name, content] of Object.entries(files)) {
    const path = join(scratch, name);
    writeFileSync(path, content);
    const { nodeId } = await browser.cdp.send('DOM.querySelector', { nodeId: docRoot.nodeId, selector: '[data-testid=import-file]' }, ui.page.sessionId);
    await browser.cdp.send('DOM.setFileInputFiles', { files: [path], nodeId }, ui.page.sessionId);
    await sleep(500);
    const msg = await ui.text('confirm-message');
    assert.ok(msg && msg.length > 10, `${name}: a specific message is shown (${msg})`);
    assert.doesNotMatch(msg, /undefined|\[object/i);
    await ui.run(() => document.querySelector('[data-testid=confirm-cancel], [data-testid=confirm-ok]').click());
    await sleep(200);
  }
  assert.deepEqual(await jar(), before, 'nothing written');
  assert.equal(await ui.run(() => ({}).polluted), undefined);
  await ui.close();
});

test('a full jar (Chrome keeps ~180 cookies per site; 1 KB values) renders and searches quickly', async () => {
  // Chrome evicts beyond ~180 cookies per registrable domain, so a full jar is the realistic worst case.
  await helper.run(async () => {
    const jobs = [];
    for (let s = 0; s < 4; s++) for (let i = 0; i < 60; i++) jobs.push(chrome.cookies.set({ url: `https://s${s}.a.test/`, name: `big_${s}_${i}`, value: `value-${s}-${i}-${'x'.repeat(1000)}`, secure: true }));
    await Promise.all(jobs);
  });
  // What the list should hold: the site's cookies plus third parties partitioned under it.
  const kept = await helper.run(async () => {
    const own = await chrome.cookies.getAll({ domain: 'a.test', partitionKey: {} });
    const embedded = (await chrome.cookies.getAll({ partitionKey: { topLevelSite: 'https://a.test' } })).filter((c) => !/(^|\.)a\.test$/.test(c.domain.replace(/^\./, '')));
    return own.length + embedded.length;
  });
  const t0 = Date.now();
  const ui = await d.openUi(id, tabA);
  await ui.waitState('ready', 15000);
  const shown = (await ui.rows()).length;
  const loadMs = Date.now() - t0;
  assert.equal(shown, kept, `every cookie Chrome kept is listed (${shown}/${kept})`);
  assert.ok(kept >= 150, `jar is full (${kept})`);
  assert.ok(loadMs < 3000, `opened in ${loadMs} ms`);
  const target = (await ui.rows()).find((n) => n.startsWith('big_3_'));
  const t1 = Date.now();
  await ui.search(target);
  const searchMs = Date.now() - t1;
  assert.ok((await ui.rows()).includes(target));
  assert.ok(searchMs < 1000, `search in ${searchMs} ms`);
  await ui.close();
});

