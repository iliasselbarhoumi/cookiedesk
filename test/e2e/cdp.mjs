// Zero-dependency Chrome DevTools Protocol driver for end-to-end tests (from JSToggle).
//
// Launches a throwaway Chrome profile with --remote-debugging-pipe and loads
// the unpacked extension via Extensions.loadUnpacked (branded Chrome 137+
// ignores --load-extension). Nothing here ships in the extension.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = DEFAULT_CHROME_PATHS.find((p) => existsSync(p));
  if (!found) throw new Error('Chrome not found; set CHROME_PATH');
  return found;
}

class Cdp {
  constructor(proc) {
    this.proc = proc;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.buffer = '';
    proc.stdio[4].on('data', (chunk) => this.#onData(chunk));
  }

  #onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let end;
    while ((end = this.buffer.indexOf('\0')) !== -1) {
      const raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      const msg = JSON.parse(raw);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      } else {
        for (const l of this.listeners) l(msg);
      }
    }
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.proc.stdio[3].write(JSON.stringify(msg) + '\0');
    });
  }

  waitFor(predicate, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error('waitFor timed out'));
      }, timeoutMs);
      const listener = (msg) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(msg);
        }
      };
      this.listeners.add(listener);
    });
  }
}

/** `profile`: reuse this user-data dir and keep it on close (restart experiments). */
/** `executable`: a specific Chrome binary (e.g. an old Chrome for Testing for test 5). */
export async function launchChrome({ headless = true, screenInfo, lang = 'en-US', profile, executable, args: extra = [] } = {}) {
  const userDataDir = profile ?? await mkdtemp(join(tmpdir(), 'cookiedesk-p0-'));
  const args = [
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    ...(headless ? ['--headless=new'] : []),
    // UI language, so assertions on English text hold on any machine. macOS
    // ignores --lang and reads AppleLanguages instead.
    `--lang=${lang}`,
    // Virtual monitors (headless only, Chrome 138+): '{0,0 1600x1000}{1600,0 1200x900 devicePixelRatio=2}'
    ...(headless && screenInfo ? [`--screen-info=${screenInfo}`] : []),
    ...extra,
    // Cocoa reads "-AppleLanguages (xx)"; Chrome also takes "(xx)" as a URL,
    // so it stands in for about:blank (headless allows only one start page).
    ...(process.platform === 'darwin' ? ['-AppleLanguages', `(${lang})`] : ['about:blank']),
  ];
  const proc = spawn(executable ?? findChrome(), args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', () => {}); // Chrome is chatty; drain so it never blocks.
  const cdp = new Cdp(proc);
  const { product } = await cdp.send('Browser.getVersion');

  async function close() {
    try { await cdp.send('Browser.close'); } catch { /* already gone */ }
    await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)));
    if (!profile) await rm(userDataDir, { recursive: true, force: true });
  }

  return { cdp, product, close, userDataDir };
}

export async function loadExtension(cdp, path) {
  const { id } = await cdp.send('Extensions.loadUnpacked', { path });
  return id;
}

/** Open an extension page in its own window and return an evaluator bound to it. */
export async function openExtensionPage(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url, newWindow: true });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Runtime.enable', {}, sessionId);
  // Wait until the page's chrome.* bindings exist.
  for (let i = 0; i < 50; i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'typeof chrome !== "undefined" && !!chrome.tabs && document.readyState === "complete" && (window.ready === true || !document.querySelector("script[src=\'harness.js\']"))',
      returnByValue: true,
    }, sessionId);
    if (r.result.value) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  return {
    targetId,
    sessionId,
    /** Run fn(...args) inside the page; fn must be self-contained. */
    async run(fn, ...args) {
      const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
      const r = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      }, sessionId);
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error(d.exception?.description || d.text);
      }
      return r.result.value;
    },
  };
}

export async function serviceWorkerTargets(cdp, extensionId) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  return targetInfos.filter(
    (t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extensionId}/`),
  );
}

/** Simulate MV3 service-worker termination (acceptance test 4). */
export async function killServiceWorker(cdp, extensionId) {
  const targets = await serviceWorkerTargets(cdp, extensionId);
  for (const t of targets) await cdp.send('Target.closeTarget', { targetId: t.targetId });
  for (let i = 0; i < 50; i++) {
    if ((await serviceWorkerTargets(cdp, extensionId)).length === 0) return targets.length;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('service worker did not terminate');
}

/**
 * Copy the shippable extension plus the e2e harness page to a temp dir.
 * `hosts` become required host_permissions — a stand-in for the user clicking
 * "Allow" on the optional-permission prompt, which automation can't do.
 */
export async function prepareExtension(root, { hosts = [] } = {}) {
  const { cp, readFile, writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'cookiedesk-ext-'));
  await cp(join(root, 'manifest.json'), join(dir, 'manifest.json'));
  await cp(join(root, 'src'), join(dir, 'src'), { recursive: true });
  for (const extra of ['_locales', 'icons']) {
    if (existsSync(join(root, extra))) await cp(join(root, extra), join(dir, extra), { recursive: true });
  }
  await cp(join(root, 'test/e2e/harness'), join(dir, 'e2e'), { recursive: true });
  if (hosts.length) {
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    manifest.host_permissions = hosts;
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
