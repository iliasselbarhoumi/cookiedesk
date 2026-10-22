// Shared e2e drivers for the CookieDesk UI. `browser` is from launchChrome(),
// `helper` an extension page (e.g. the harness) used to call chrome.* APIs.
import { openExtensionPage } from './cdp.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createDriver(browser, helper) {
  /** Open a real tab from an extension page (so we know its tab id) and wait for it to load. */
  async function openTab(url) {
    const id = await helper.run(async (u) => (await chrome.tabs.create({ url: u, active: true })).id, url);
    for (let i = 0; i < 100; i++) {
      if (await helper.run(async (t) => (await chrome.tabs.get(t)).status === 'complete', id)) break;
      await sleep(100);
    }
    await sleep(300); // iframes and their Set-Cookie
    return id;
  }

  /** Open the UI (side panel page or popup host) for a tab and return a small driver. */
  async function openUi(extId, tabId, { surface = 'panel', width = 400, height = 800 } = {}) {
    const path = surface === 'popup' ? 'src/popup/popup.html' : 'src/ui/panel.html';
    const page = await openExtensionPage(browser.cdp, `chrome-extension://${extId}/${path}?tab=${tabId}`);
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    // A real popup or side panel is visible; a hidden test page has its queued tasks
    // (e.g. a <dialog>'s close event) held back by Chrome.
    await browser.cdp.send('Page.bringToFront', {}, page.sessionId);
    const ui = {
      page,
      run: page.run.bind(page),
      state: () => page.run(() => document.querySelector('[data-testid=state]')?.dataset.state ?? null),
      async waitState(kind, ms = 8000) {
        for (let t = 0; t < ms; t += 100) {
          if (await ui.state() === kind) return;
          await sleep(100);
        }
        throw new Error(`state never became ${kind} (is ${await ui.state()})`);
      },
      count: (id) => page.run((s) => document.querySelectorAll(`[data-testid=${s}]`).length, id),
      rows: () => page.run(() => [...document.querySelectorAll('[data-testid=cookie-row]')].map((r) => r.dataset.name)),
      text: (id) => page.run((s) => document.querySelector(`[data-testid=${s}]`)?.textContent.trim() ?? null, id),
      // Headless Chrome can re-focus an older window a moment after a new one opens,
      // which hides this page; a real popup is always the visible window.
      click: async (id, within) => (await browser.cdp.send('Page.bringToFront', {}, page.sessionId), page.run((s, w) => {
        const scope = w ? document.querySelector(w) : document;
        const el = scope?.querySelector(`[data-testid=${s}]`);
        if (!el) throw new Error(`no [data-testid=${s}]`);
        el.click();
      }, id, within ?? null)),
      /** Set a form field in the editor and fire the events a user would. */
      field: (name, value) => page.run((n, v) => {
        const el = document.querySelector(`[data-testid=editor] [name=${n}]`);
        if (!el) throw new Error(`no editor field ${n}`);
        if (el.type === 'checkbox') el.checked = v; else el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, name, value),
      async search(q) {
        await page.run((v) => {
          const el = document.querySelector('[data-testid=search]');
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, q);
        await sleep(150);
      },
      async openRow(name) {
        await page.run((n) => document.querySelector(`[data-testid=cookie-row][data-name="${n}"]`).click(), name);
        for (let i = 0; i < 30 && !(await ui.count('editor')); i++) await sleep(100);
      },
      close: () => browser.cdp.send('Target.closeTarget', { targetId: page.targetId }),
    };
    return ui;
  }

  /** What a toolbar click does: grants activeTab, so the UI can see the tab's URL. */
  async function clickToolbar(extId, urlPrefix) {
    const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const t = targetInfos.find((x) => x.url.startsWith(urlPrefix));
    await browser.cdp.send('Extensions.triggerAction', { id: extId, targetId: t.targetId });
    await sleep(500);
    // The click opened the real popup; close it so it doesn't hold focus.
    const popups = (await browser.cdp.send('Target.getTargets')).targetInfos.filter((x) => x.url.includes(`${extId}/src/popup/popup.html`));
    for (const p of popups) await browser.cdp.send('Target.closeTarget', { targetId: p.targetId }).catch(() => {});
  }


  return { openTab, openUi, clickToolbar };
}

/** Run code in a chrome://extensions page (developerPrivate / management live there). */
export async function inExtensionsPage(browser, code) {
  const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'chrome://extensions' });
  const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await sleep(800);
  const r = await browser.cdp.send('Runtime.evaluate', { expression: `(async () => { try { await (${code}); return 'ok'; } catch (e) { return 'ERROR: ' + e.message; } })()`, awaitPromise: true, returnByValue: true }, sessionId);
  await browser.cdp.send('Target.closeTarget', { targetId });
  return r.result.value;
}

/**
 * Turn on "Allow in Incognito" as a user would in chrome://extensions. That reloads
 * the extension, and branded Chrome then disables a CDP-loaded unpacked one
 * ("unsupportedDeveloperExtension"), so switch it back on. Returns a fresh helper
 * page once an incognito window can really be opened (chrome.extension's
 * isAllowedIncognitoAccess is gone in MV3).
 */
export async function enableIncognito(browser, id) {
  const ok = await inExtensionsPage(browser, `chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${JSON.stringify(id)}, incognitoAccess: true })`);
  if (ok !== 'ok') throw new Error(`incognito toggle: ${ok}`);
  await sleep(500);
  const on = await inExtensionsPage(browser, `chrome.management.setEnabled(${JSON.stringify(id)}, true)`);
  if (on !== 'ok') throw new Error(`re-enable: ${on}`);
  for (let i = 0; ; i++) {
    await sleep(500);
    const helper = await openExtensionPage(browser.cdp, `chrome-extension://${id}/e2e/harness.html`);
    const works = await helper.run(async () => { const w = await chrome.windows.create({ incognito: true, url: 'about:blank' }); await chrome.windows.remove(w.id); return true; }).catch(() => false);
    if (works) return helper;
    await browser.cdp.send('Target.closeTarget', { targetId: helper.targetId }).catch(() => {});
    if (i > 20) throw new Error('extension did not come back with incognito access');
  }
}
