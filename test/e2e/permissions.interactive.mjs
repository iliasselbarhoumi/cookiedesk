// Spec §9 tests 13–15 with REAL runtime grants. Automation can't press Chrome's
// native "Allow", so this opens a visible Chrome and asks you to. Everything
// else (clicking CookieDesk's own buttons, checking results) is automatic.
//   node test/e2e/permissions.interactive.mjs
// Screenshots of the two prompts land in test/e2e/screens/.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { launchChrome, loadExtension, openExtensionPage, prepareExtension } from './cdp.mjs';
import { startFixtures, CHROME_ARGS } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const screens = join(here, 'screens');
mkdirSync(screens, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => console.error(`\n>>> ${s}`);
const results = [];
const check = (name, fn) => results.push([name, fn]);

const fx = await startFixtures();
const browser = await launchChrome({ headless: false, args: CHROME_ARGS });
const ext = await prepareExtension(root);
try {
  const id = await loadExtension(browser.cdp, ext.dir);
  const helper = await openExtensionPage(browser.cdp, `chrome-extension://${id}/e2e/harness.html`);
  const tab = await helper.run(async (u) => (await chrome.tabs.create({ url: u })).id, fx.url('a.test/a'));
  await sleep(1500);
  // Press the toolbar button on that tab, as a user would. Without it (no `tabs`
  // permission) CookieDesk can't see the tab's URL and only says "click the toolbar button".
  const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const siteTarget = targetInfos.find((t) => t.url.startsWith(fx.url('a.test/a')));
  await browser.cdp.send('Extensions.triggerAction', { id, targetId: siteTarget.targetId });
  await sleep(800);
  for (const t of (await browser.cdp.send('Target.getTargets')).targetInfos.filter((x) => x.url.includes(`${id}/src/popup/popup.html`))) {
    await browser.cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
  }
  const page = await openExtensionPage(browser.cdp, `chrome-extension://${id}/src/ui/panel.html?tab=${tab}`);
  const { windowId } = await browser.cdp.send('Browser.getWindowForTarget', { targetId: page.targetId });
  await browser.cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 60, top: 60, width: 900, height: 760, windowState: 'normal' } });
  await browser.cdp.send('Target.activateTarget', { targetId: page.targetId });
  await browser.cdp.send('Page.bringToFront', {}, page.sessionId);
  const run = page.run.bind(page);
  const state = () => run(() => document.querySelector('[data-testid=state]')?.dataset.state);
  async function waitState(kind, ms) {
    for (let t = 0; t < ms; t += 200) { if (await state() === kind) return true; await sleep(200); }
    return false;
  }
  /** A trusted mouse click (a real user gesture, which permissions.request requires). */
  async function realClick(selector) {
    const box = await run((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await browser.cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 }, page.sessionId);
    }
  }
  function shot(name) {
    try { execFileSync('screencapture', ['-x', '-R', '60,60,900,760', join(screens, name)]); } catch { /* no screen-recording access */ }
  }

  // ---- test 13: grant one site --------------------------------------------------------
  if (!(await waitState('no-access', 8000))) {
    const msg = await run(() => document.querySelector('[data-testid=state-message]')?.textContent ?? '');
    throw new Error(`CookieDesk should offer "Allow on a.test" but is in state "${await state()}": ${msg}`);
  }
  say('Starting test 13. A Chrome permission prompt will appear in the CookieDesk window in a moment.');
  await realClick('[data-testid=grant-site]');
  await sleep(1200);
  shot('prompt-site.png');
  say('Chrome is asking to "Read and change your data on all a.test sites". Click ALLOW.');
  const grantedSite = await waitState('ready', 120000);
  check('13 grant one site → list appears', () => assert.ok(grantedSite));
  const perms = await helper.run(() => chrome.permissions.getAll());
  check('13 granted pattern is exactly *://*.a.test/*', () => assert.deepEqual(perms.origins, ['*://*.a.test/*']));
  const rw = await helper.run(async () => {
    const out = {};
    try { out.setA = !!(await chrome.cookies.set({ url: 'https://a.test/', name: 'rt', value: 'x', secure: true })); } catch (e) { out.setA = e.message; }
    try { await chrome.cookies.set({ url: 'https://b.test/', name: 'rt', value: 'x', secure: true }); out.setB = 'allowed'; } catch (e) { out.setB = 'refused'; }
    return out;
  });
  check('13 readable/writable on a.test, nowhere else', () => { assert.equal(rw.setA, true); assert.equal(rw.setB, 'refused'); });

  // ---- test 14: revoke ----------------------------------------------------------------
  await run(() => document.querySelector('[data-testid=open-access]').click());
  await sleep(300);
  await run(() => document.querySelector('[data-testid=grant-row][data-site="a.test"] [data-testid=revoke]').click());
  await sleep(500);
  const afterRevoke = await helper.run(() => chrome.permissions.getAll());
  check('14 revoke removes the grant', () => assert.deepEqual(afterRevoke.origins, []));
  await run(() => document.querySelector('[data-testid=access-close]').click());
  const back = await waitState('no-access', 5000);
  check('14 list empties with the no-access explanation', () => assert.ok(back));

  // ---- test 15: all sites -------------------------------------------------------------
  await run(() => document.querySelector('[data-testid=open-access]').click());
  await sleep(300);
  await realClick('[data-testid=grant-all]');
  await sleep(1200);
  shot('prompt-all.png');
  say('Chrome is asking to "Read and change all your data on all websites". Click ALLOW.');
  let all = false;
  for (let t = 0; t < 120000 && !all; t += 300) { all = (await helper.run(() => chrome.permissions.contains({ origins: ['<all_urls>'] }))); await sleep(300); }
  check('15 all-sites grant works', () => assert.ok(all));
  const reflected = await run(() => !!document.querySelector('[data-testid=revoke-all]'));
  check('15 Access view reflects all-sites', () => assert.ok(reflected));
  const bOk = await helper.run(async () => (await chrome.cookies.getAll({ domain: 'b.test', partitionKey: {} })).length);
  check('15 other sites now readable (b.test)', () => assert.ok(bOk > 0));
  await run(() => document.querySelector('[data-testid=revoke-all]').click());
  await sleep(500);
  const end = await helper.run(() => chrome.permissions.getAll());
  check('15 turning all-sites off returns to per-site', () => assert.deepEqual(end.origins, []));
} finally {
  let failed = 0;
  for (const [name, fn] of results) {
    try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
  }
  console.log(`\n${results.length - failed}/${results.length} passed. Prompt screenshots (if screen recording is allowed): test/e2e/screens/`);
  await browser.close();
  await ext.cleanup();
  fx.close();
  process.exitCode = failed ? 1 : 0;
}
