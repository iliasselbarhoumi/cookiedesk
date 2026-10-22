// The popup / side panel UI against real Chrome (spec §9 tests 1–4, 6, 7, 9, 10, 12, 18, 20, 21).
// Drives the DOM contract in docs/ui-brief.md.
//   node --test test/e2e/ui.e2e.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, loadExtension, openExtensionPage, prepareExtension } from './cdp.mjs';
import { createDriver, sleep } from './driver.mjs';
import { startFixtures, CHROME_ARGS } from './fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fx; let browser; let granted; let ungranted; let gId; let uId; let helper;
let openTab; let openUi; let clickToolbar;
const dlScratch = mkdtempSync(join(tmpdir(), 'cookiedesk-ui-'));


before(async () => {
  fx = await startFixtures();
  browser = await launchChrome({ args: CHROME_ARGS });
  granted = await prepareExtension(root, { hosts: ['*://*.a.test/*', '*://*.b.test/*'] });
  ungranted = await prepareExtension(root);
  gId = await loadExtension(browser.cdp, granted.dir);
  uId = await loadExtension(browser.cdp, ungranted.dir);
  helper = await openExtensionPage(browser.cdp, `chrome-extension://${gId}/e2e/harness.html`);
  ({ openTab, openUi, clickToolbar } = createDriver(browser, helper));
});

after(async () => {
  await browser?.close();
  await granted?.cleanup();
  await ungranted?.cleanup();
  fx?.close();
  rmSync(dlScratch, { recursive: true, force: true });
});

test('test 12: the install asks for nothing scary — no permission warnings at all', async () => {
  const shipped = readFileSync(join(root, 'manifest.json'), 'utf8');
  const warnings = await helper.run((m) => chrome.management.getPermissionWarningsByManifest(m), shipped);
  assert.deepEqual(warnings, []);
});


test('test 2: a site without a grant says so and offers the grant, never a bare empty list', async () => {
  const tab = await openTab(fx.url('a.test/a'));
  await clickToolbar(uId, fx.url('a.test/a'));
  const ui = await openUi(uId, tab, { surface: 'popup', width: 460, height: 580 });
  await ui.waitState('no-access');
  assert.match(await ui.text('state-message'), /a\.test/);
  assert.equal(await ui.count('grant-site'), 1);
  assert.equal(await ui.count('cookie-row'), 0);
  await ui.close();
});

test('test 3: chrome://extensions is explained, not apparently broken', async () => {
  const tab = await openTab('chrome://extensions/');
  await clickToolbar(gId, 'chrome://extensions');
  const ui = await openUi(gId, tab, { surface: 'popup', width: 460, height: 580 });
  await ui.waitState('restricted');
  assert.match(await ui.text('state-message'), /Chrome/);
  await ui.close();
});

test('the side panel on a tab it cannot see asks for a toolbar click instead of showing nothing', async () => {
  const tab = await openTab(fx.url('c.test/c'));
  const ui = await openUi(gId, tab);
  await ui.waitState('unknown');
  assert.match(await ui.text('state-message'), /toolbar/i);
  await ui.close();
});

let tabA;
test('test 1 (UI): normal and partitioned cookies listed; partitioned ones labelled with their key; HttpOnly called out', async () => {
  tabA = await openTab(fx.url('a.test/a'));
  await openTab(fx.url('www.a.test/www'));
  const ui = await openUi(gId, tabA);
  await ui.waitState('ready');
  const rows = await ui.rows();
  for (const n of ['a_plain', 'a_http', 'a_session', 'a_part', 'b_part', 'www_only', 'parent_dom']) assert.ok(rows.includes(n), `${n} listed`);
  const part = await ui.run(() => {
    const row = document.querySelector('[data-testid=cookie-row][data-name=b_part]');
    const badge = row.querySelector('[data-testid=badge-partitioned]');
    return { flag: row.dataset.partitioned, label: `${badge?.title ?? ''} ${badge?.getAttribute('aria-label') ?? ''} ${badge?.textContent ?? ''}` };
  });
  assert.equal(part.flag, 'true');
  assert.match(part.label, /a\.test|this site/);
  const http = await ui.run(() => {
    const b = document.querySelector('[data-testid=cookie-row][data-name=a_http] [data-testid=badge-httponly]');
    return `${b?.title ?? ''} ${b?.getAttribute('aria-label') ?? ''}`;
  });
  assert.match(http, /not visible to page JavaScript/i);
  assert.match(await ui.text('count'), /\d+ cookies/);
  assert.equal(await ui.count('note'), 1, 'third-party note shown for a per-site grant');
  await ui.close();
});

test('test 4: 45+ cookies — search filters live by name, value and domain', async () => {
  await openTab(fx.url('a.test/many'));
  const ui = await openUi(gId, tabA);
  await ui.waitState('ready');
  assert.ok((await ui.rows()).length >= 45);
  await ui.search('many_1');
  assert.deepEqual((await ui.rows()).sort(), Array.from({ length: 10 }, (_, i) => `many_1${i}`));
  await ui.search('val_44');
  assert.deepEqual(await ui.rows(), ['many_44']);
  await ui.search('www.a');
  assert.deepEqual(await ui.rows(), ['www_only']);
  await ui.search('');
  assert.ok((await ui.rows()).length >= 45);
  await ui.close();
});

test('test 6 (UI): editing a value changes one row in place — no duplicate, other rows not rebuilt', async () => {
  const ui = await openUi(gId, tabA);
  await ui.waitState('ready');
  await ui.run(() => { document.querySelectorAll('[data-testid=cookie-row]').forEach((r) => { r.__mark = r.dataset.name; }); });
  await ui.openRow('a_plain');
  await ui.field('value', 'edited-in-ui');
  await ui.click('editor-save');
  await sleep(600);
  await ui.waitState('ready');
  const r = await ui.run(() => {
    const rows = [...document.querySelectorAll('[data-testid=cookie-row]')];
    return {
      plain: rows.filter((x) => x.dataset.name === 'a_plain').length,
      keptNodes: rows.filter((x) => x.__mark === x.dataset.name && x.dataset.name !== 'a_plain').length,
      total: rows.length,
    };
  });
  assert.equal(r.plain, 1);
  assert.equal(r.keptNodes, r.total - 1, 'unchanged rows keep their DOM nodes (no flicker)');
  assert.equal(await helper.run(async () => (await chrome.cookies.getAll({ name: 'a_plain' }))[0].value), 'edited-in-ui');
  assert.equal(await ui.count('toast'), 1);
  await ui.close();
});

test('test 7 (UI): SameSite=None without Secure is blocked in the editor with the rule explained', async () => {
  const ui = await openUi(gId, tabA);
  await ui.waitState('ready');
  await ui.openRow('a_plain');
  await ui.field('sameSite', 'no_restriction');
  await ui.field('secure', false);
  const r = await ui.run(() => ({
    issues: [...document.querySelectorAll('[data-testid=editor-issues] [data-code]')].map((e) => ({ code: e.dataset.code, sev: e.dataset.severity, text: e.textContent })),
    disabled: document.querySelector('[data-testid=editor-save]').disabled,
  }));
  const issue = r.issues.find((i) => i.code === 'samesite_none_insecure');
  assert.equal(issue?.sev, 'error');
  assert.match(issue.text, /Secure/);
  assert.ok(r.disabled);
  await ui.click('editor-cancel');
  assert.equal(await helper.run(async () => (await chrome.cookies.getAll({ name: 'a_plain' }))[0].sameSite), 'lax');
  await ui.close();
});

test('test 9 (UI): an expiry in the past is stated plainly as a delete', async () => {
  const ui = await openUi(gId, tabA);
  await ui.waitState('ready');
  await ui.openRow('a_session');
  await ui.field('session', false);
  await ui.field('expires', '2001-01-01T00:00');
  const w = await ui.run(() => document.querySelector('[data-testid=editor-issues] [data-code=expired_deletes]')?.textContent ?? '');
  assert.match(w, /deletes this cookie/i);
  await ui.click('editor-cancel');
  await ui.close();
});

test('test 10 (UI): delete from the row, undo from the toast — the cookie comes back identical', async () => {
  const before = await helper.run(async () => (await chrome.cookies.getAll({ name: 'a_http' }))[0]);
  const ui = await openUi(gId, tabA);
  await ui.waitState('ready');
  await ui.click('row-delete', '[data-testid=cookie-row][data-name=a_http]');
  await sleep(500);
  assert.ok(!(await ui.rows()).includes('a_http'));
  await ui.click('toast-undo');
  await sleep(600);
  assert.ok((await ui.rows()).includes('a_http'));
  const after_ = await helper.run(async () => (await chrome.cookies.getAll({ name: 'a_http' }))[0]);
  assert.deepEqual(after_, before);
  await ui.close();
});

test('undo is still available after the popup closes and reopens', async () => {
  let ui = await openUi(gId, tabA, { surface: 'popup', width: 460, height: 580 });
  await ui.waitState('ready');
  await ui.click('row-delete', '[data-testid=cookie-row][data-name=a_session]');
  await sleep(400);
  await ui.close();
  ui = await openUi(gId, tabA, { surface: 'popup', width: 460, height: 580 });
  await ui.waitState('ready');
  assert.ok(!(await ui.run(() => document.querySelector('[data-testid=undo-last]').disabled)));
  await ui.click('undo-last');
  await sleep(600);
  assert.ok((await ui.rows()).includes('a_session'));
  await ui.close();
});

test('test 20 (UI): a 4 KB value renders without breaking the layout, and opens in the editor', async () => {
  await helper.run(() => chrome.cookies.set({ url: 'https://a.test/', name: 'jwt', value: `eyJ${'A'.repeat(4000)}`, secure: true }));
  for (const [surface, width] of [['popup', 460], ['panel', 320]]) {
    const ui = await openUi(gId, tabA, { surface, width, height: 700 });
    await ui.waitState('ready');
    const r = await ui.run(() => {
      const row = document.querySelector('[data-testid=cookie-row][data-name=jwt]');
      return { rowOverflow: row.scrollWidth - row.clientWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth, rowHeight: row.getBoundingClientRect().height };
    });
    assert.ok(r.pageOverflow <= 0, `${surface}: no horizontal page scroll (${r.pageOverflow})`);
    assert.ok(r.rowHeight < 120, `${surface}: row stays compact (${r.rowHeight}px)`);
    await ui.openRow('jwt');
    assert.equal((await ui.run(() => document.querySelector('[data-testid=editor] [name=value]').value)).length, 4003);
    assert.match(await ui.text('byte-count'), /4006 \/ 4096/);
    await ui.close();
  }
});

test('test 18 (UI): export warns that the file is a live credential, then downloads it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cookiedesk-dl-'));
  try {
    await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
    const ui = await openUi(gId, tabA);
    await ui.waitState('ready');
    await ui.click('export-json');
    await sleep(200);
    assert.match(await ui.text('confirm-message'), /password/i);
    await ui.click('confirm-ok');
    let files = [];
    for (let i = 0; i < 50 && !files.some((f) => f.endsWith('.json')); i++) { await sleep(100); files = readdirSync(dir); }
    const file = files.find((f) => f.endsWith('.json'));
    assert.ok(file, 'a .json file was downloaded');
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    assert.equal(data.format, 'cookiedesk');
    assert.ok(data.cookies.some((c) => c.name === 'a_part' && c.partitionKey));
    await ui.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an import that writes to other sites lists every one of them and needs explicit consent', async () => {
  const drafts = [
    ...Array.from({ length: 9 }, (_, i) => ({ name: `own_${i}`, value: 'v', domain: 'a.test', path: '/', secure: true })),
    { name: 'planted', value: 'attacker-session', domain: '.b.test', hostOnly: false, path: '/', secure: true },
  ];
  const path = join(dlScratch, 'mixed.json');
  writeFileSync(path, JSON.stringify(drafts));
  const ui = await openUi(gId, tabA);
  await ui.waitState('ready');
  const { root: docRoot } = await browser.cdp.send('DOM.getDocument', {}, ui.page.sessionId);
  const { nodeId } = await browser.cdp.send('DOM.querySelector', { nodeId: docRoot.nodeId, selector: '[data-testid=import-file]' }, ui.page.sessionId);
  await browser.cdp.send('DOM.setFileInputFiles', { files: [path], nodeId }, ui.page.sessionId);
  await sleep(800);
  const r = await ui.run(() => ({
    others: document.querySelector('[data-testid=import-others]')?.textContent ?? '',
    disabled: document.querySelector('[data-testid=confirm-ok]').disabled,
  }));
  assert.match(r.others, /b\.test/, 'the other site is named');
  assert.ok(r.disabled, 'Import stays disabled without consent');
  await ui.run(() => { const c = document.querySelector('[data-testid=import-other-sites]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await ui.run(() => document.querySelector('[data-testid=confirm-ok]').disabled), false);
  await ui.click('confirm-ok');
  const planted = () => helper.run(async () => (await chrome.cookies.getAll({ domain: 'b.test', name: 'planted' })).length);
  for (let i = 0; i < 80 && !(await planted()); i++) await sleep(100);
  assert.equal(await planted(), 1);
  await ui.close();
});

test('test 21: a full session in the UI makes zero network requests', async () => {
  const ui = await openUi(gId, tabA);
  const requests = [];
  browser.cdp.listeners.add((m) => {
    if (m.sessionId === ui.page.sessionId && m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  await browser.cdp.send('Network.enable', {}, ui.page.sessionId);
  await ui.run(() => location.reload());
  await sleep(300);
  await ui.waitState('ready');
  await ui.search('a_');
  await ui.search('');
  await ui.openRow('a_plain');
  await ui.field('value', 'net-check');
  await ui.click('editor-save');
  await sleep(500);
  await ui.click('undo-last');
  await sleep(500);
  await ui.click('open-access');
  await sleep(300);
  const remote = requests.filter((u) => !/^(chrome-extension|data|blob):/.test(u));
  assert.deepEqual(remote, []);
  await ui.close();
});
