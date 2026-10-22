// Chrome Web Store images, captured from the real extension UI:
//   store/screenshots/1-5.png (1280x800), store/promo-small.png (440x280) and
//   store/promo-marquee.png (1400x560).
// The demo site is shop.example (a reserved, fictitious domain) served locally
// with made-up cookie values. Dev-only, no network: npm run store-screens
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, openExtensionPage, prepareExtension } from '../test/e2e/cdp.mjs';
import { createDriver, sleep } from '../test/e2e/driver.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'store');
mkdirSync(join(out, 'screenshots'), { recursive: true });

// ---- demo site --------------------------------------------------------------------
const certDir = mkdtempSync(join(tmpdir(), 'cookiedesk-store-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=shop.example',
  '-addext', 'subjectAltName=DNS:shop.example,DNS:www.shop.example,DNS:chat.example',
  '-keyout', join(certDir, 'k.pem'), '-out', join(certDir, 'c.pem')], { stdio: 'ignore' });
const fakeJwt = [{ alg: 'HS256', typ: 'JWT' }, { sub: 'demo-user-1042', scope: 'cart checkout', exp: 1893456000 }]
  .map((p) => Buffer.from(JSON.stringify(p)).toString('base64url')).join('.') + '.c2lnbmF0dXJlLW5vdC1yZWFs';
const DAY = 86400;
let port;
const server = createServer({ key: readFileSync(join(certDir, 'k.pem')), cert: readFileSync(join(certDir, 'c.pem')) }, (req, res) => {
  const host = req.headers.host.split(':')[0];
  res.setHeader('Content-Type', 'text/html');
  if (host === 'www.shop.example') {
    res.setHeader('Set-Cookie', [
      'session_id=8f3c2a91d4e64b7f9a05c1e2d3b4a596; HttpOnly; Secure; SameSite=Lax; Path=/',
      `auth_token=${fakeJwt}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * DAY}`,
      `csrf_token=Kx9vQ2mN7pL4rT8wY1zB; Secure; SameSite=Strict; Path=/; Max-Age=${DAY}`,
      `cart_items=3; Domain=shop.example; Secure; SameSite=Lax; Path=/; Max-Age=${30 * DAY}`,
      `currency=EUR; Domain=shop.example; Secure; SameSite=Lax; Path=/; Max-Age=${365 * DAY}`,
      `theme=dark; Secure; SameSite=Lax; Path=/; Max-Age=${365 * DAY}`,
      `consent=analytics:no|ads:no; Domain=shop.example; Secure; SameSite=Lax; Path=/; Max-Age=${180 * DAY}`,
      `__Host-checkout=step2; Secure; SameSite=Strict; Path=/; Max-Age=${DAY}`,
    ]);
    res.end(`<!doctype html><title>Shop</title><iframe src="https://chat.example:${port}/widget"></iframe>`);
  } else if (host === 'chat.example') {
    res.setHeader('Set-Cookie', [`chat_visitor=v_51f0c8; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${90 * DAY}`]);
    res.end('<!doctype html>chat');
  } else {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
port = server.address().port;
const url = (h) => `https://${h}:${port}/`;

// ---- capture ----------------------------------------------------------------------
const browser = await launchChrome({ args: ['--host-resolver-rules=MAP *.example 127.0.0.1', '--ignore-certificate-errors'] });
const ext = await prepareExtension(root, { hosts: ['*://*.shop.example/*', '*://*.chat.example/*'] });
const raw = {};
try {
  const { id } = await browser.cdp.send('Extensions.loadUnpacked', { path: ext.dir });
  const helper = await openExtensionPage(browser.cdp, `chrome-extension://${id}/e2e/harness.html`);
  const { openTab, openUi } = createDriver(browser, helper);
  const tab = await openTab(url('www.shop.example'));

  async function ui({ surface = 'popup', width = 460, height = 580, dark = false } = {}) {
    const u = await openUi(id, tab, { surface, width, height });
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }, u.page.sessionId);
    await browser.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] }, u.page.sessionId);
    await u.waitState('ready');
    u.shot = async (name) => {
      await sleep(300);
      const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, u.page.sessionId);
      raw[name] = { data, width, height };
    };
    return u;
  }

  let u = await ui();
  await u.shot('list');
  await u.close();

  // The editor with "What this cookie does" open.
  u = await ui({ surface: 'panel', width: 420, height: 760 });
  await u.openRow('auth_token');
  await u.run(() => { document.querySelector('[data-testid=explain]').open = true; });
  await u.run(() => document.activeElement?.blur());
  await u.shot('editor');
  await u.close();

  u = await ui();
  await u.click('open-access');
  for (let i = 0; i < 30 && !(await u.count('access-view')); i++) await sleep(100);
  await u.run(() => document.activeElement?.blur());
  await u.shot('access');
  await u.close();

  u = await ui();
  await u.run(() => document.querySelector('[data-testid=cookie-row][data-name=theme] [data-testid=row-delete]').click());
  for (let i = 0; i < 30 && !(await u.count('toast')); i++) await sleep(100);
  await u.shot('undo');
  await u.click('toast-undo');
  await sleep(500);
  await u.close();

  // Compare: a set saved "before login" against the cookies after it, in a dark side panel.
  const setText = await helper.run(async () => core.io.exportJson(await engine.list({ site: 'shop.example', storeId: '0' }),
    { site: 'shop.example', storeId: '0', now: Date.now() - 20 * 60_000, setName: 'before login' }));
  const setFile = join(certDir, 'before-login.json');
  writeFileSync(setFile, setText);
  await helper.run(async () => {
    const at = Date.now() / 1000;
    await chrome.cookies.set({ url: 'https://www.shop.example/', name: 'session_id', value: 'c41d07e2b9a84f1d8e3a5b6c7d8e9f01', secure: true, httpOnly: true, sameSite: 'lax' });
    await chrome.cookies.set({ url: 'https://www.shop.example/', name: 'remember_me', value: 'u1042.Zk3pQ8vL', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: at + 30 * 86400 });
    await chrome.cookies.set({ url: 'https://shop.example/', domain: 'shop.example', name: 'cart_items', value: '0', secure: true, sameSite: 'lax', expirationDate: at + 30 * 86400 });
    await chrome.cookies.remove({ url: 'https://www.shop.example/', name: '__Host-checkout' });
  });
  u = await ui({ surface: 'panel', width: 420, height: 680, dark: true });
  const { root: doc } = await browser.cdp.send('DOM.getDocument', {}, u.page.sessionId);
  const { nodeId } = await browser.cdp.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '[data-testid=compare-file]' }, u.page.sessionId);
  await browser.cdp.send('DOM.setFileInputFiles', { files: [setFile], nodeId }, u.page.sessionId);
  for (let i = 0; i < 30 && !(await u.count('diff-view')); i++) await sleep(100);
  await u.run(() => document.activeElement?.blur());
  await u.shot('compare');
  await u.close();

  // ---- compose ----------------------------------------------------------------------
  const page = await openExtensionPage(browser.cdp, 'about:blank');
  const icon = readFileSync(join(root, 'assets/icon.svg'), 'utf8');
  async function render(html, width, height, file) {
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    await page.run((h) => { document.open(); document.write(h); document.close(); }, html);
    await sleep(400);
    const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } }, page.sessionId);
    writeFileSync(join(out, file), Buffer.from(data, 'base64'));
    console.log(join('store', file));
  }
  const font = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const slides = [
    ['list', 'Every cookie, partitioned ones included', 'Normal and partitioned (CHIPS) cookies in one list, with HttpOnly, Secure, session and partition badges. Live search by name, value or domain.'],
    ['editor', 'Every flag, explained in plain words', 'Edit any field. Illegal combinations are blocked before Chrome sees them, with the rule spelled out.'],
    ['undo', 'Undo on every change', 'Edits, deletes, imports and set restores are journaled first and verified after. One click puts a cookie back exactly.'],
    ['compare', 'See what a login changed', 'Save the cookies as a set, then compare: what was added, removed and changed. Popup or side panel, light or dark.'],
    ['access', 'Access one site at a time', 'No "all your data on all websites" prompt at install. No ads, no tracking, no network requests. Open source.'],
  ];
  for (const [i, [key, title, sub]] of slides.entries()) {
    const shot = raw[key];
    await render(`<!doctype html><style>
      body{margin:0;width:1280px;height:800px;display:flex;align-items:center;gap:64px;padding:0 80px;box-sizing:border-box;
        font-family:${font};background:linear-gradient(135deg,#eef3fd,#f8f9fb 60%);color:#1b1f24;overflow:hidden}
      .copy{flex:1}.brand{display:flex;align-items:center;gap:10px;font-weight:600;color:#2557c7;font-size:20px;margin-bottom:28px}
      .brand svg{width:36px;height:36px}h1{font-size:46px;line-height:1.12;margin:0 0 20px;letter-spacing:-.02em}
      p{font-size:22px;line-height:1.45;color:#4b5563;margin:0;max-width:520px}
      img{width:${shot.width}px;height:${shot.height}px;border-radius:12px;box-shadow:0 24px 60px rgb(15 23 42/.18),0 2px 6px rgb(15 23 42/.08)}
    </style><div class="copy"><div class="brand">${icon}CookieDesk</div><h1>${title}</h1><p>${sub}</p></div>
    <img src="data:image/png;base64,${shot.data}">`, 1280, 800, `screenshots/${i + 1}-${key}.png`);
  }
  await render(`<!doctype html><style>
    body{margin:0;width:440px;height:280px;box-sizing:border-box;padding:36px;font-family:${font};
      background:linear-gradient(135deg,#2557c7,#1d3f8f);color:#fff;display:flex;flex-direction:column;justify-content:center}
    .row{display:flex;align-items:center;gap:14px}svg{width:64px;height:64px;background:#fff;border-radius:16px;padding:6px}
    h1{font-size:30px;margin:0;letter-spacing:-.01em}p{margin:18px 0 0;font-size:17px;line-height:1.4;opacity:.92}
  </style><div class="row">${icon}<h1>Cookie Editor</h1></div>
  <p>View, edit &amp; delete cookies.<br>Partitioned cookies · Undo · No ads</p>`, 440, 280, 'promo-small.png');
  // Marquee (1400x560): headline left, the real list right.
  const list = raw.list;
  await render(`<!doctype html><style>
    body{margin:0;width:1400px;height:560px;box-sizing:border-box;padding:0 90px;font-family:${font};overflow:hidden;
      background:linear-gradient(120deg,#2557c7,#1d3f8f 70%);color:#fff;display:flex;align-items:center;gap:70px}
    .copy{flex:1}.row{display:flex;align-items:center;gap:14px;margin-bottom:26px}
    .row svg{width:56px;height:56px;background:#fff;border-radius:14px;padding:5px}.row b{font-size:26px}
    h1{font-size:50px;line-height:1.1;margin:0 0 18px;letter-spacing:-.02em}p{font-size:22px;line-height:1.45;margin:0;opacity:.92}
    img{width:${list.width * 0.9}px;height:${list.height * 0.9}px;border-radius:12px;box-shadow:0 30px 70px rgb(0 0 0/.35);align-self:flex-end;margin-bottom:-40px}
  </style><div class="copy"><div class="row">${icon}<b>CookieDesk</b></div>
  <h1>The cookie editor that shows partitioned cookies and undoes every change</h1>
  <p>Per-site access · No ads · No tracking · Open source</p></div>
  <img src="data:image/png;base64,${list.data}">`, 1400, 560, 'promo-marquee.png');
} finally {
  await browser.close();
  await ext.cleanup();
  server.close();
  rmSync(certDir, { recursive: true, force: true });
}
