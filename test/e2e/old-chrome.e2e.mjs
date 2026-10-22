// Spec §9 test 5: Chrome older than the partition APIs → feature-detected, no crash.
// Runs the real UI on Chrome for Testing builds from before each API landed
// (download them first: npm run get-old-chrome).
// Below 119 the cookies API returns partitioned cookies without a partitionKey,
// indistinguishable from normal ones, and an edit writes an unpartitioned twin
// (FINDINGS §8). No correct editor is possible there, so minimum_chrome_version
// is 119 and Chrome 116 must refuse to load the extension at all.
//   node --test test/e2e/old-chrome.e2e.mjs
// These builds predate Extensions.loadUnpacked, so the extension goes in with
// --load-extension (Chrome for Testing still honours it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, openExtensionPage, prepareExtension } from './cdp.mjs';
import { createDriver, sleep } from './driver.mjs';
import { startFixtures, CHROME_ARGS } from './fixtures.mjs';
import { OLD_VERSIONS, oldChromePath } from '../../scripts/get-old-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const screens = join(root, 'test/e2e/screens');

async function extensionId(cdp, tries = 100) {
  for (let i = 0; i < tries; i++) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
    if (sw) return new URL(sw.url).host;
    await sleep(100);
  }
  return null;
}

for (const version of OLD_VERSIONS) {
  const major = Number(version.split('.')[0]);
  const executable = oldChromePath(version);
  test(`test 5: Chrome ${major}`, { skip: !executable && `Chrome ${version} not downloaded (npm run get-old-chrome)` }, async () => {
    const fx = await startFixtures();
    const ext = await prepareExtension(root, { hosts: ['*://*.a.test/*', '*://*.b.test/*'] });
    const browser = await launchChrome({
      executable,
      // Chrome for Testing on macOS otherwise blocks on a Keychain prompt at startup.
      args: [...CHROME_ARGS, '--use-mock-keychain', `--disable-extensions-except=${ext.dir}`, `--load-extension=${ext.dir}`],
    });
    try {
      assert.match(browser.product, new RegExp(`/${major}\\.`));
      const id = await extensionId(browser.cdp, major < 119 ? 50 : 100);
      if (major < 119) {
        assert.equal(id, null, 'Chrome below minimum_chrome_version must not load the extension');
        return;
      }
      assert.ok(id, 'extension service worker started');
      const helper = await openExtensionPage(browser.cdp, `chrome-extension://${id}/e2e/harness.html`);
      const { openTab, openUi } = createDriver(browser, helper);

      const tab = await openTab(fx.url('a.test/a'));
      // Ground truth from the browser itself: the page did set its partitioned cookie.
      const { cookies: truth } = await browser.cdp.send('Storage.getCookies');
      assert.ok(truth.some((c) => c.name === 'a_part'), 'fixture set a partitioned cookie');

      const ui = await openUi(id, tab, { surface: 'popup', width: 460, height: 600 });
      const errors = [];
      browser.cdp.listeners.add((m) => {
        if (m.sessionId === ui.page.sessionId && m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      });
      await ui.waitState('ready');
      const rows = await ui.rows();
      for (const n of ['a_plain', 'a_http', 'a_session']) assert.ok(rows.includes(n), `${n} listed`);
      const notes = await ui.run(() => [...document.querySelectorAll('[data-testid=note]')].map((n) => n.dataset.note));

      assert.ok(!notes.includes('no-partitions'));
      assert.ok(rows.includes('a_part') && rows.includes('b_part'), 'partitioned cookies listed');
      assert.equal(rows.filter((n) => n === 'a_part').length, 1, 'no unpartitioned twin');
      const label = await ui.run(() => document.querySelector('[data-testid=cookie-row][data-name=a_part] [data-testid=badge-partitioned]')?.getAttribute('aria-label'));
      assert.match(label, /^Partitioned under this site/);

      // Editing still works, with undo, on the old API surface.
      await ui.openRow('a_plain');
      await ui.field('value', 'edited');
      await ui.click('editor-save');
      for (let i = 0; i < 50 && !(await ui.count('toast')); i++) await sleep(100);
      assert.equal(await helper.run(async () => (await chrome.cookies.getAll({ name: 'a_plain' }))[0]?.value), 'edited');
      await ui.click('toast-undo');
      for (let i = 0; i < 50; i++) {
        if (await helper.run(async () => (await chrome.cookies.getAll({ name: 'a_plain' }))[0]?.value) === 'one') break;
        await sleep(100);
      }
      assert.equal(await helper.run(async () => (await chrome.cookies.getAll({ name: 'a_plain' }))[0]?.value), 'one');

      // Editing a partitioned cookie changes it in place: no unpartitioned twin appears.
      await ui.click('editor-cancel').catch(() => {});
      await ui.openRow('a_part');
      await ui.field('value', 'edited');
      await ui.click('editor-save');
      for (let i = 0; i < 50; i++) {
        if ((await browser.cdp.send('Storage.getCookies')).cookies.some((c) => c.name === 'a_part' && c.value === 'edited')) break;
        await sleep(100);
      }
      const parts = (await browser.cdp.send('Storage.getCookies')).cookies.filter((c) => c.name === 'a_part');
      assert.deepEqual(parts.map((c) => [c.value, !!c.partitionKey]), [['edited', true]]);

      mkdirSync(screens, { recursive: true });
      const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, ui.page.sessionId);
      writeFileSync(join(screens, `chrome-${major}.png`), Buffer.from(data, 'base64'));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await ext.cleanup();
      fx.close();
    }
  });
}
