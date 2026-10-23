// "Support me" and the rating ask, against real Chrome: successful changes are
// counted, the Ko-fi card appears only at a milestone and backs off, the heart
// opens Ko-fi, "Yes, I did" makes a supporter, and an unpacked build never asks
// for a rating. Opening a tab is stubbed so the test makes no network requests.
//   node --test test/e2e/thanks.e2e.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, loadExtension, openExtensionPage, prepareExtension } from './cdp.mjs';
import { createDriver, sleep } from './driver.mjs';
import { startFixtures, CHROME_ARGS } from './fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let fx; let browser; let ext; let id; let helper; let openTab; let openUi; let tab;
const DAY = 24 * 60 * 60 * 1000;

before(async () => {
  fx = await startFixtures();
  browser = await launchChrome({ args: CHROME_ARGS });
  ext = await prepareExtension(root, { hosts: ['*://*.a.test/*'] });
  id = await loadExtension(browser.cdp, ext.dir);
  helper = await openExtensionPage(browser.cdp, `chrome-extension://${id}/e2e/harness.html`);
  ({ openTab, openUi } = createDriver(browser, helper));
  tab = await openTab(fx.url('a.test/a'));
});

after(async () => {
  await browser?.close();
  await ext?.cleanup();
  fx?.close();
});

async function until(fn, ms = 6000) {
  for (let t = 0; t < ms; t += 100) { const v = await fn(); if (v) return v; await sleep(100); }
  const v = await fn();
  if (!v) throw new Error(`timed out after ${ms} ms waiting for: ${fn.toString().slice(0, 140)}`);
  return v;
}
const store = (keys) => helper.run((k) => chrome.storage.local.get(k), keys);
const setStore = (items) => helper.run((i) => chrome.storage.local.set(i), items);
async function ui() {
  const u = await openUi(id, tab);
  await u.waitState('ready');
  // Record instead of opening real tabs (Ko-fi, the store): no network in tests.
  await u.run(() => { window.__opened = []; chrome.tabs.create = async (o) => { window.__opened.push(o.url); return {}; }; });
  return u;
}

test('successful changes are counted; errors are noted as trouble; no card before the first milestone', async () => {
  await setStore({ usage: {}, support: {} });
  const u = await ui();
  await u.run(() => document.querySelector('[data-testid=cookie-row][data-name=a_session] [data-testid=row-delete]').click());
  await until(async () => (await store('usage')).usage?.wins === 1);
  const { usage } = await store('usage');
  assert.equal(usage.activeDays, 1);
  assert.ok(usage.installedAt <= Date.now());
  assert.deepEqual(Object.keys(usage).sort(), ['activeDays', 'installedAt', 'lastDay', 'lastWinAt', 'wins'], 'counts and times only');
  await u.click('toast-undo');
  await until(async () => (await u.rows()).includes('a_session'));
  assert.equal(await u.count('ask-support'), 0);
  await u.close();
});

test('the Ko-fi card appears at a milestone, opens Ko-fi, then asks "did you?" and makes a supporter', async () => {
  await setStore({ usage: { installedAt: Date.now() - DAY, wins: 10, activeDays: 1 }, support: {} });
  let u = await ui();
  await until(() => u.count('ask-support'));
  assert.match(await u.text('ask-support'), /10 changes made with CookieDesk/);
  await u.click('ask-kofi');
  assert.deepEqual(await u.run(() => window.__opened), ['https://ko-fi.com/buildwithiliass']);
  await until(async () => !(await u.count('ask-support')));
  const { support } = await store('support');
  assert.equal(support.lastMilestone, 10);
  assert.ok(support.kofiClickedAt);
  await u.close();

  // Back a few minutes later: one "did you?".
  await setStore({ support: { ...support, kofiClickedAt: Date.now() - 5 * 60 * 1000 } });
  u = await ui();
  await until(() => u.count('ask-support'));
  assert.match(await u.text('ask-support'), /Did you buy me a coffee/);
  await u.click('ask-yes');
  await until(async () => (await store('support')).support.supporter === true);
  assert.ok(await u.run(() => document.querySelector('[data-testid=support-heart]').classList.contains('supporter')));
  await u.close();

  // Supporters are never asked again.
  await setStore({ usage: { installedAt: Date.now() - DAY, wins: 5000, activeDays: 9 } });
  u = await ui();
  await sleep(600);
  assert.equal(await u.count('ask-support'), 0);
  await u.close();
});

test('"Later" snoozes the card; the heart and the menu open Ko-fi any time', async () => {
  await setStore({ usage: { installedAt: Date.now() - DAY, wins: 40, activeDays: 2 }, support: { lastMilestone: 10 } });
  let u = await ui();
  await until(() => u.count('ask-support'));
  await u.click('ask-later');
  await until(async () => (await store('support')).support.dismissals === 1);
  const { support } = await store('support');
  assert.equal(support.lastMilestone, 40);
  assert.ok(support.nextAskAt > Date.now() + 6 * DAY);
  await u.close();

  u = await ui();
  await sleep(600);
  assert.equal(await u.count('ask-support'), 0, 'snoozed');
  await u.click('support-heart');
  await u.click('menu-support');
  assert.deepEqual(await u.run(() => window.__opened), ['https://ko-fi.com/buildwithiliass', 'https://ko-fi.com/buildwithiliass']);
  await u.close();
});

test('an unpacked build never asks for a rating, even for an eligible user', async () => {
  const now = Date.now();
  await setStore({ usage: { installedAt: now - 10 * DAY, wins: 50, activeDays: 8, lastWinAt: now - 1000 }, rateAsk: {}, support: { supporter: true } });
  const u = await ui();
  await sleep(600);
  assert.equal(await u.count('ask-rate'), 0);
  assert.ok(await u.run(() => document.querySelector('[data-testid=menu-rate]').hidden));
  await u.close();
});
