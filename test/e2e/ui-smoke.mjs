// Visual smoke run of the popup and side panel against the HTTPS fixtures.
// Not a test suite: it drives the UI into each state and saves screenshots.
//   node test/e2e/ui-smoke.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchChrome, loadExtension, openExtensionPage, prepareExtension } from './cdp.mjs';
import { startFixtures, CHROME_ARGS } from './fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(process.argv[2] ?? join(tmpdir(), 'cookiedesk-screens'));
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fx = await startFixtures();
const browser = await launchChrome({ args: CHROME_ARGS });
const granted = await prepareExtension(root, { hosts: ['*://*.a.test/*', '*://*.b.test/*'] });
const ungranted = await prepareExtension(root);
const report = [];

try {
  const gId = await loadExtension(browser.cdp, granted.dir);
  const uId = await loadExtension(browser.cdp, ungranted.dir);
  const helper = await openExtensionPage(browser.cdp, `chrome-extension://${gId}/e2e/harness.html`);

  async function openTab(url) {
    const id = await helper.run(async (u) => (await chrome.tabs.create({ url: u, active: true })).id, url);
    for (let i = 0; i < 100; i++) {
      if (await helper.run(async (t) => (await chrome.tabs.get(t)).status === 'complete', id)) break;
      await sleep(100);
    }
    await sleep(400);
    return id;
  }

  async function open(extId, tabId, { surface = 'panel', width = 380, height = 800, dark = false } = {}) {
    const path = surface === 'popup' ? 'src/popup/popup.html' : 'src/ui/panel.html';
    const page = await openExtensionPage(browser.cdp, `chrome-extension://${extId}/${path}?tab=${tabId}`);
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }, page.sessionId);
    await browser.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] }, page.sessionId);
    const errors = [];
    browser.cdp.listeners.add((m) => {
      if (m.sessionId === page.sessionId && (m.method === 'Runtime.exceptionThrown')) errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (m.sessionId === page.sessionId && m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
    for (let i = 0; i < 80; i++) {
      const s = await page.run(() => document.querySelector('[data-testid=state]')?.dataset.state);
      if (s && s !== 'loading') break;
      await sleep(100);
    }
    await sleep(250);
    return {
      page,
      errors,
      run: page.run.bind(page),
      async shot(name) {
        await sleep(150);
        const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
        writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'));
        const state = await page.run(() => document.querySelector('[data-testid=state]').dataset.state);
        const overflow = await page.run(() => document.documentElement.scrollWidth - innerWidth);
        report.push(`${name}: state=${state} overflow=${overflow}${errors.length ? ` ERRORS=${errors.join(' | ')}` : ''}`);
      },
      close: () => browser.cdp.send('Target.closeTarget', { targetId: page.targetId }),
    };
  }

  async function tabTarget(host) {
    const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    return targetInfos.find((x) => new URL(x.url).hostname === host)?.targetId;
  }

  await openTab(fx.url('www.a.test/www'));
  const tabA = await openTab(fx.url('a.test/a'));
  await helper.run(() => chrome.cookies.set({ url: 'https://a.test/', name: 'jwt', value: `eyJhbGciOiJIUzI1NiJ9.${'QUJD'.repeat(1000)}`, secure: true, httpOnly: true, sameSite: 'strict', expirationDate: Date.now() / 1000 + 86400 * 20 }));
  await helper.run(() => chrome.cookies.set({ url: 'https://a.test/account/settings', name: 'a_very_long_cookie_name_for_layout_checks_and_more', value: 'x', path: '/account/settings', secure: true, sameSite: 'no_restriction', domain: 'a.test' }));
  await sleep(200);

  for (const dark of [false, true]) {
    const t = dark ? '-dark' : '';
    let ui = await open(gId, tabA, { surface: 'popup', width: 460, height: 580, dark });
    await ui.shot(`popup-ready${t}`);
    await ui.run(() => { const r = document.querySelector('[data-testid=cookie-row][data-name=jwt]'); r.focus(); });
    await ui.shot(`popup-row-focus${t}`);
    await ui.run(() => document.querySelector('[data-testid=cookie-row][data-name=jwt]').click());
    await ui.shot(`popup-editor-jwt${t}`);
    await ui.run(() => {
      const f = document.querySelector('[data-testid=editor]');
      f.elements.sameSite.value = 'no_restriction'; f.elements.secure.checked = false;
      f.elements.session.checked = false; f.elements.expires.value = '2001-01-01T00:00';
      f.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await ui.shot(`popup-editor-issues${t}`);
    await ui.run(() => document.querySelector('[data-testid=editor-cancel]').click());
    await ui.run(() => document.querySelector('[data-testid=add-cookie]').click());
    await ui.shot(`popup-add${t}`);
    await ui.run(() => document.querySelector('[data-testid=editor-cancel]').click());
    await ui.run(() => document.querySelector('[data-testid=menu]').click());
    await ui.shot(`popup-menu${t}`);
    await ui.run(() => document.querySelector('[data-testid=open-access]').click());
    await sleep(300);
    await ui.shot(`popup-access${t}`);
    await ui.run(() => document.querySelector('[data-testid=access-close]').click());
    await ui.run(() => document.querySelector('[data-testid=export-json]').click());
    await ui.shot(`popup-export-dialog${t}`);
    await ui.run(() => document.querySelector('[data-testid=confirm-cancel]').click());
    await ui.run(() => { const s = document.querySelector('[data-testid=search]'); s.value = 'a_'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await ui.shot(`popup-search${t}`);
    await ui.close();

    ui = await open(gId, tabA, { surface: 'panel', width: 380, height: 800, dark });
    await ui.shot(`panel-ready${t}`);
    await ui.run(() => document.querySelector('[data-testid=cookie-row][data-name=a_session] [data-testid=row-delete]')?.click());
    await sleep(500);
    await ui.shot(`panel-deleted-toast${t}`);
    report.push(`  toast: ${await ui.run(() => document.querySelector('[data-testid=toast]')?.textContent)}`);
    await ui.run(() => document.querySelector('[data-testid=toast-undo]')?.click());
    await sleep(600);
    report.push(`  after undo: ${await ui.run(() => document.querySelector('[data-testid=toast]')?.textContent)} | dialog=${await ui.run(() => document.querySelector('[data-testid=confirm]').open && document.querySelector('[data-testid=confirm-message]').textContent)}`);
    await ui.close();

    ui = await open(gId, tabA, { surface: 'panel', width: 640, height: 600, dark });
    await ui.shot(`panel-wide${t}`);
    await ui.close();

    // The toolbar click's activeTab is what lets the popup name an ungranted site.
    await browser.cdp.send('Target.activateTarget', { targetId: await tabTarget('a.test') });
    await browser.cdp.send('Extensions.triggerAction', { id: uId, targetId: await tabTarget('a.test') });
    await sleep(400);
    ui = await open(uId, tabA, { surface: 'popup', width: 460, height: 580, dark });
    await ui.shot(`popup-no-access${t}`);
    await ui.close();
  }

  // Import preview: one cookie on a granted site, one on a site without access.
  const importPath = join(out, 'import-sample.json');
  writeFileSync(importPath, JSON.stringify([
    { name: 'imp_a', value: '1', domain: 'a.test', hostOnly: true, path: '/', secure: true, httpOnly: false, sameSite: 'lax', session: true },
    { name: 'imp_c', value: '2', domain: '.c.test', hostOnly: false, path: '/', secure: true, httpOnly: false, sameSite: 'lax', session: true },
  ]));
  let ui = await open(gId, tabA, { surface: 'popup', width: 460, height: 580 });
  await browser.cdp.send('DOM.enable', {}, ui.page.sessionId);
  const { root: docRoot } = await browser.cdp.send('DOM.getDocument', {}, ui.page.sessionId);
  const { nodeId } = await browser.cdp.send('DOM.querySelector', { nodeId: docRoot.nodeId, selector: '[data-testid=import-file]' }, ui.page.sessionId);
  await browser.cdp.send('DOM.setFileInputFiles', { nodeId, files: [importPath] }, ui.page.sessionId);
  await sleep(500);
  await ui.shot('popup-import-preview');
  report.push(`  import ok disabled: ${await ui.run(() => document.querySelector('[data-testid=confirm-ok]').disabled)}`);
  await ui.run(() => document.querySelector('[data-testid=confirm-cancel]').click());
  await ui.close();

  const ext = await openTab('chrome://extensions/');
  const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const t = targetInfos.find((x) => x.url.startsWith('chrome://extensions'));
  await browser.cdp.send('Extensions.triggerAction', { id: gId, targetId: t.targetId });
  await sleep(500);
  ui = await open(gId, ext, { surface: 'popup', width: 460, height: 580 });
  await ui.shot('popup-restricted');
  await ui.close();

  const c = await openTab(fx.url('c.test/c'));
  ui = await open(gId, c, { surface: 'panel', width: 380, height: 500 });
  await ui.shot('panel-unknown');
  await ui.close();
} finally {
  await browser.close();
  await granted.cleanup();
  await ungranted.cleanup();
  fx.close();
  console.log(`screens in ${out}\n${report.join('\n')}`);
}
