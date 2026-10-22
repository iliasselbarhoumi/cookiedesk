// Phase 0 probe runner (BUILD_SPEC_COOKIE.md §12 Phase 0).
//
// Launches a throwaway Chrome profile, loads phase0/probe, serves real HTTPS
// origins (a.test embeds an iframe from b.test; c.test is a plain site) and
// records what the cookies and permissions APIs actually do. Cookie values
// here are dummy test strings.
//
//   node phase0/run.mjs                 automated, headless (stdout: JSON)
//   node phase0/run.mjs --interactive   visible Chrome; YOU click "Allow" on the
//                                       real permission prompts (runtime grants,
//                                       revoke, all-sites). Screenshots the prompts.
//
// Automation cannot click Chrome's native permission prompt, so the automated
// run grants hosts by loading a copy of the probe with them in host_permissions
// (the same stand-in JSToggle's e2e uses). The cookies API checks the
// extension's active host permissions either way; --interactive proves it
// with a genuine runtime grant.

import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, openExtensionPage } from './cdp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const interactive = process.argv.includes('--interactive');
const headless = !interactive && !process.argv.includes('--headful');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
const record = (key, value) => { results[key] = value; console.error(`· ${key}\n${JSON.stringify(value, null, 1)}`); };
const temps = [];

// ---- HTTPS fixture ---------------------------------------------------------------
const certDir = mkdtempSync(join(tmpdir(), 'cookiedesk-cert-'));
temps.push(certDir);
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=a.test',
  '-addext', 'subjectAltName=DNS:a.test,DNS:www.a.test,DNS:b.test,DNS:c.test',
  '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem'),
], { stdio: 'ignore' });

let port;
const server = createServer({
  key: readFileSync(join(certDir, 'key.pem')),
  cert: readFileSync(join(certDir, 'cert.pem')),
}, (req, res) => {
  const host = req.headers.host.split(':')[0];
  if (host === 'a.test' && req.url === '/a') {
    res.setHeader('Set-Cookie', [
      'a_plain=one; Secure; SameSite=Lax; Path=/; Max-Age=3600',
      'a_http=secret; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600',
      'a_session=s; Path=/',
      'a_part=p; Secure; SameSite=None; Partitioned; Path=/; Max-Age=3600',
    ]);
    res.end(`<!doctype html><title>a</title><iframe src="https://b.test:${port}/frame"></iframe>`);
  } else if (host === 'b.test' && req.url === '/frame') {
    res.setHeader('Set-Cookie', [
      'b_part=p; Secure; SameSite=None; Partitioned; Path=/; Max-Age=3600',
      'b_3p=u; Secure; SameSite=None; Path=/; Max-Age=3600',
    ]);
    res.end('<!doctype html><title>frame</title>b');
  } else if (host === 'www.a.test' && req.url === '/www') {
    res.setHeader('Set-Cookie', [
      'www_only=w; Secure; Path=/; Max-Age=3600',
      'parent_dom=d; Domain=a.test; Secure; Path=/; Max-Age=3600',
    ]);
    res.end('<!doctype html><title>www</title>www');
  } else if (host === 'c.test' && req.url === '/c') {
    res.setHeader('Set-Cookie', ['c_cookie=c; Secure; Path=/; Max-Age=3600']);
    res.end('<!doctype html><title>c</title>c');
  } else {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
port = server.address().port;

// ---- Chrome ------------------------------------------------------------------------
const { cdp, product, close } = await launchChrome({
  headless,
  args: ['--host-resolver-rules=MAP *.test 127.0.0.1', '--ignore-certificate-errors'],
});
record('chrome', product);

/** Load a copy of the probe; `hosts` become required host_permissions (grant stand-in). */
async function loadProbe(hosts = []) {
  const dir = mkdtempSync(join(tmpdir(), 'cookiedesk-probe-'));
  temps.push(dir);
  cpSync(join(here, 'probe'), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (hosts.length) manifest.host_permissions = hosts;
  manifest.name += hosts.length ? ` [${hosts.join(' ')}]` : ' [no hosts]';
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: dir });
  const page = await openExtensionPage(cdp, `chrome-extension://${id}/page.html`);
  return { id, page, run: page.run.bind(page) };
}

// Ground truth straight from the browser's cookie store, bypassing extension permissions.
async function truth() {
  const { cookies } = await cdp.send('Storage.getCookies');
  return cookies
    .filter((c) => c.domain.endsWith('.test') || /^[abc]\.test$/.test(c.domain))
    .map((c) => `${c.name}@${c.domain}${c.partitionKey ? ` [part ${JSON.stringify(c.partitionKey)}]` : ''}`)
    .sort();
}

const listings = (run) => run(async () => {
  const fmt = (list) => list.map((c) => `${c.name}@${c.domain}${c.partitionKey ? ` [part ${JSON.stringify(c.partitionKey)}]` : ''}`).sort();
  const safe = async (fn) => { try { return fmt(await fn()); } catch (e) { return `ERROR: ${e.message}`; } };
  return {
    'getAll({})': await safe(() => chrome.cookies.getAll({})),
    'getAll({partitionKey:{}})': await safe(() => chrome.cookies.getAll({ partitionKey: {} })),
    "getAll({url:'https://a.test/'})": await safe(() => chrome.cookies.getAll({ url: 'https://a.test/' })),
    "getAll({url:'https://a.test/', partitionKey:{}})": await safe(() => chrome.cookies.getAll({ url: 'https://a.test/', partitionKey: {} })),
    "getAll({partitionKey:{topLevelSite:'https://a.test'}})": await safe(() => chrome.cookies.getAll({ partitionKey: { topLevelSite: 'https://a.test' } })),
    "getAll({partitionKey:{topLevelSite:'https://a.test', hasCrossSiteAncestor:false}})": await safe(() => chrome.cookies.getAll({ partitionKey: { topLevelSite: 'https://a.test', hasCrossSiteAncestor: false } })),
    "getAll({partitionKey:{topLevelSite:'https://a.test', hasCrossSiteAncestor:true}})": await safe(() => chrome.cookies.getAll({ partitionKey: { topLevelSite: 'https://a.test', hasCrossSiteAncestor: true } })),
    "getAll({domain:'b.test', partitionKey:{}})": await safe(() => chrome.cookies.getAll({ domain: 'b.test', partitionKey: {} })),
  };
});

const p0 = await loadProbe();
const tabA = await p0.run(async (url) => (await chrome.tabs.create({ url, active: true })).id, `https://a.test:${port}/a`);
await p0.run(async (url) => (await chrome.tabs.create({ url, active: false })).id, `https://www.a.test:${port}/www`);
await sleep(1500);
record('fixture truth (Storage.getCookies, all)', await truth());

if (interactive) await interactiveRun(p0);
else await automatedRun(p0);

console.log(JSON.stringify(results, null, 2));
await close();
server.close();
for (const d of temps) rmSync(d, { recursive: true, force: true });

// =====================================================================================
async function automatedRun({ id: extId, run }) {
  // ---- E0: permission warnings Chrome shows (install + request) ------------------
  record('E0 warnings', await run(async () => {
    const base = { manifest_version: 3, name: 'x', version: '1' };
    const safe = async (extra) => {
      try { return await chrome.management.getPermissionWarningsByManifest(JSON.stringify({ ...base, ...extra })); } catch (e) { return `ERROR: ${e.message}`; }
    };
    return {
      'install: cookies+storage+optional <all_urls>': await safe({ permissions: ['cookies', 'storage'], optional_host_permissions: ['<all_urls>'] }),
      'install: + activeTab + sidePanel': await safe({ permissions: ['cookies', 'storage', 'activeTab', 'sidePanel'], optional_host_permissions: ['<all_urls>'] }),
      'host https://example.com/*': await safe({ permissions: ['cookies'], host_permissions: ['https://example.com/*'] }),
      'host http+https example.com': await safe({ permissions: ['cookies'], host_permissions: ['https://example.com/*', 'http://example.com/*'] }),
      'host *://*.example.com/*': await safe({ permissions: ['cookies'], host_permissions: ['*://*.example.com/*'] }),
      'host <all_urls>': await safe({ permissions: ['cookies'], host_permissions: ['<all_urls>'] }),
      'tabs (comparison)': await safe({ permissions: ['tabs'] }),
    };
  }));

  // ---- E1: no grant ----------------------------------------------------------------
  record('E1.0 permissions.getAll at install', await run(() => chrome.permissions.getAll()));
  record('E1.1 listings, no host grant', await listings(run));
  record('E1.2 tabs.get without grant (no tabs permission)', await run(async (id) => { const t = await chrome.tabs.get(id); return { url: t.url ?? null, title: t.title ?? null }; }, tabA));
  record('E1.3 set on a.test without grant', await run(async () => {
    try { return await chrome.cookies.set({ url: 'https://a.test/', name: 'nogrant', value: 'x' }); } catch (e) { return `ERROR: ${e.message}`; }
  }));
  record('E1.4 getPartitionKey availability + no-grant call', await run(async (tabId) => {
    const out = { typeof: typeof chrome.cookies.getPartitionKey };
    try { out.top = await chrome.cookies.getPartitionKey({ tabId, frameId: 0 }); } catch (e) { out.top = `ERROR: ${e.message}`; }
    return out;
  }, tabA));
  record('E1.5 permissions.request without gesture', await run(async () => {
    try { return await chrome.permissions.request({ origins: ['https://a.test/*'] }); } catch (e) { return `ERROR: ${e.message}`; }
  }));

  // ---- activeTab: does an action click let chrome.cookies touch that tab's site? ----
  {
    const tabC = await run(async (url) => (await chrome.tabs.create({ url, active: true })).id, `https://c.test:${port}/c`);
    await sleep(1000);
    let out;
    try {
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
      const tab = targetInfos.find((t) => t.url.includes('c.test'));
      await cdp.send('Extensions.triggerAction', { id: extId, targetId: tab.targetId });
      await sleep(500);
      out = await run(async (tabId) => {
        const { clicked } = await chrome.storage.session.get('clicked');
        const t = await chrome.tabs.get(tabId);
        let cookies;
        try { cookies = (await chrome.cookies.getAll({ url: 'https://c.test/' })).map((c) => c.name); } catch (e) { cookies = `ERROR: ${e.message}`; }
        let set;
        try { set = (await chrome.cookies.set({ url: 'https://c.test/', name: 'via_activetab', value: 'x', secure: true })) ? 'ok' : 'null'; } catch (e) { set = `ERROR: ${e.message}`; }
        return { clickedTabUrl: clicked?.url ?? null, tabsGetUrlAfterClick: t.url ?? null, cookiesGetAll: cookies, cookiesSet: set };
      }, tabC);
    } catch (e) { out = `ERROR: ${e.message}`; }
    record('E1.6 activeTab after toolbar click (Extensions.triggerAction) on c.test', out);
  }

  // ---- E2: only a.test granted -------------------------------------------------------
  const pa = await loadProbe(['https://a.test/*']);
  record('E2.0 permissions.getAll (a.test granted)', await pa.run(() => chrome.permissions.getAll()));
  record('E2.1 listings with only a.test granted', await listings(pa.run));
  record('E2.2 getPartitionKey per frame (a.test granted, b.test not)', await pa.run(async (tabId) => {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const out = {};
    for (const f of frames) {
      const label = `frame ${f.frameId} ${new URL(f.url).host}`;
      try { out[label] = await chrome.cookies.getPartitionKey({ tabId, frameId: f.frameId }); } catch (e) { out[label] = `ERROR: ${e.message}`; }
    }
    return out;
  }, tabA));
  record('E2.3 tabs.get url with a.test granted', await pa.run(async (id) => (await chrome.tabs.get(id)).url ?? null, tabA));
  record('E2.4 set/remove on b.test while only a.test granted', await pa.run(async () => {
    const out = {};
    try { out.set = await chrome.cookies.set({ url: 'https://b.test/', name: 'x', value: 'x', secure: true }); } catch (e) { out.set = `ERROR: ${e.message}`; }
    try { out.remove = await chrome.cookies.remove({ url: 'https://b.test/', name: 'b_3p' }); } catch (e) { out.remove = `ERROR: ${e.message}`; }
    return out;
  }));
  record('E2.5 set/remove on a.test (granted)', await pa.run(async () => {
    const out = {};
    try { out.set = !!(await chrome.cookies.set({ url: 'https://a.test/', name: 'granted_set', value: 'x', secure: true })); } catch (e) { out.set = `ERROR: ${e.message}`; }
    try { out.remove = await chrome.cookies.remove({ url: 'https://a.test/', name: 'granted_set' }); } catch (e) { out.remove = `ERROR: ${e.message}`; }
    out.goneAfter = !(await chrome.cookies.get({ url: 'https://a.test/', name: 'granted_set' }));
    return out;
  }));

  // ---- E2.6: which grant pattern sees which cookies ------------------------------------
  const patterns = {};
  for (const hosts of [['*://a.test/*'], ['*://www.a.test/*'], ['*://*.a.test/*']]) {
    const p = await loadProbe(hosts);
    patterns[hosts.join(' ')] = await p.run(async () => {
      const fmt = (list) => list.map((c) => `${c.name}@${c.domain}${c.partitionKey ? ' [part]' : ''}`).sort();
      return {
        "getAll({partitionKey:{}})": fmt(await chrome.cookies.getAll({ partitionKey: {} })),
        "getAll({domain:'a.test', partitionKey:{}})": fmt(await chrome.cookies.getAll({ domain: 'a.test', partitionKey: {} })),
        "getAll({url:'https://www.a.test/'})": fmt(await chrome.cookies.getAll({ url: 'https://www.a.test/' })),
      };
    });
  }
  record('E2.5b grant pattern vs visible cookies', patterns);

  const pab = await loadProbe(['*://*.a.test/*', '*://*.b.test/*']);
  const run2 = pab.run;
  record('E2.6 listings with a.test + b.test granted', await listings(run2));
  record('E2.7 getPartitionKey per frame (both granted)', await run2(async (tabId) => {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const out = {};
    for (const f of frames) {
      const label = `frame ${f.frameId} ${new URL(f.url).host}`;
      try { out[label] = await chrome.cookies.getPartitionKey({ tabId, frameId: f.frameId }); } catch (e) { out[label] = `ERROR: ${e.message}`; }
    }
    return out;
  }, tabA));

  // ---- E3: partitioned cookies written through the API --------------------------------
  record('E3 partitioned set via API', await run2(async () => {
    const fmt = (c) => c && `${c.name}@${c.domain} ${JSON.stringify(c.partitionKey ?? null)}`;
    const out = {};
    const attempt = async (label, details) => {
      try { out[label] = fmt(await chrome.cookies.set(details)); } catch (e) { out[label] = `ERROR: ${e.message}`; }
    };
    await attempt('a.test under a.test (hasCrossSiteAncestor omitted)', { url: 'https://a.test/', name: 'api_part', value: 'v', secure: true, partitionKey: { topLevelSite: 'https://a.test' } });
    await attempt('a.test under a.test, hasCrossSiteAncestor:true', { url: 'https://a.test/', name: 'api_part_x', value: 'v', secure: true, partitionKey: { topLevelSite: 'https://a.test', hasCrossSiteAncestor: true } });
    await attempt('b.test under a.test, hasCrossSiteAncestor omitted', { url: 'https://b.test/', name: 'api_b_omit', value: 'v', secure: true, partitionKey: { topLevelSite: 'https://a.test' } });
    await attempt('b.test under a.test, hasCrossSiteAncestor:false', { url: 'https://b.test/', name: 'api_b_false', value: 'v', secure: true, partitionKey: { topLevelSite: 'https://a.test', hasCrossSiteAncestor: false } });
    await attempt('b.test under a.test, hasCrossSiteAncestor:true', { url: 'https://b.test/', name: 'api_b_true', value: 'v', secure: true, partitionKey: { topLevelSite: 'https://a.test', hasCrossSiteAncestor: true } });
    await attempt('partitioned but secure:false', { url: 'https://a.test/', name: 'api_part_insecure', value: 'v', secure: false, partitionKey: { topLevelSite: 'https://a.test' } });
    await attempt('partitioned, topLevelSite with port/path', { url: 'https://a.test/', name: 'api_part_port', value: 'v', secure: true, partitionKey: { topLevelSite: 'https://a.test:8443/x' } });
    out.visibleWithoutPartitionKey = (await chrome.cookies.getAll({ name: 'api_part' })).length;
    out.visibleWithEmptyPartitionKey = (await chrome.cookies.getAll({ name: 'api_part', partitionKey: {} })).length;
    out.visibleWithItsPartitionKey = (await chrome.cookies.getAll({ name: 'api_part', partitionKey: { topLevelSite: 'https://a.test' } })).length;
    out.getWithoutPartitionKey = fmt(await chrome.cookies.get({ url: 'https://a.test/', name: 'api_part' })) ?? null;
    out.getWithPartitionKey = fmt(await chrome.cookies.get({ url: 'https://a.test/', name: 'api_part', partitionKey: { topLevelSite: 'https://a.test' } })) ?? null;
    out.removeWithoutPartitionKey = await chrome.cookies.remove({ url: 'https://a.test/', name: 'api_part' }) ?? null;
    out.stillThereAfterUnpartitionedRemove = !!(await chrome.cookies.get({ url: 'https://a.test/', name: 'api_part', partitionKey: { topLevelSite: 'https://a.test' } }));
    return out;
  }));

  // ---- E4: onChanged on edits, failures, deletes ---------------------------------------
  async function scenario(label, fn) {
    await run2(() => { window.events.length = 0; });
    const ret = await run2(fn);
    await sleep(300);
    const events = await run2(() => window.events.map(({ t, partitionKey, ...e }) => e));
    record(`E4 ${label}`, { ret, events });
  }
  await scenario('value edit via set() on the same key', async () => {
    const c = await chrome.cookies.set({ url: 'https://a.test/', name: 'a_plain', value: 'two', secure: true, sameSite: 'lax', expirationDate: Date.now() / 1000 + 3600 });
    return c && { valueLength: c.value.length };
  });
  await scenario('flag edit via set(): httpOnly false→true', async () => {
    const c = await chrome.cookies.set({ url: 'https://a.test/', name: 'a_plain', value: 'two', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: Date.now() / 1000 + 3600 });
    return c && { httpOnly: c.httpOnly };
  });
  await scenario('illegal set (secure:false + no_restriction) over existing a_plain', async () => {
    let err = null;
    try { await chrome.cookies.set({ url: 'https://a.test/', name: 'a_plain', value: 'three', secure: false, sameSite: 'no_restriction' }); } catch (e) { err = e.message; }
    const still = await chrome.cookies.get({ url: 'https://a.test/', name: 'a_plain' });
    return { err, originalStillThere: !!still, valueLength: still?.value.length };
  });
  await scenario('illegal set: secure:true on http:// url over existing a_session', async () => {
    let err = null;
    try { await chrome.cookies.set({ url: 'http://a.test/', name: 'a_session', value: 'zz', secure: true }); } catch (e) { err = e.message; }
    const still = await chrome.cookies.get({ url: 'https://a.test/', name: 'a_session' });
    return { err, originalStillThere: !!still, valueLength: still?.value.length, secure: still?.secure };
  });
  await scenario('remove() then set() (the spec\'s order, same key)', async () => {
    await chrome.cookies.remove({ url: 'https://a.test/', name: 'a_plain' });
    return !!(await chrome.cookies.set({ url: 'https://a.test/', name: 'a_plain', value: 'four', secure: true, sameSite: 'lax' }));
  });
  await scenario('rename (key change): set new first, then remove old', async () => {
    await chrome.cookies.set({ url: 'https://a.test/', name: 'a_renamed', value: 'four', secure: true });
    return chrome.cookies.remove({ url: 'https://a.test/', name: 'a_plain' });
  });
  await scenario('expiry in the past via set()', async () => {
    try { return await chrome.cookies.set({ url: 'https://a.test/', name: 'a_renamed', value: 'x', secure: true, expirationDate: 1 }) ?? null; } catch (e) { return `ERROR: ${e.message}`; }
  });
  await scenario('remove() a cookie that does not exist', async () => {
    try { return await chrome.cookies.remove({ url: 'https://a.test/', name: 'nope' }) ?? null; } catch (e) { return `ERROR: ${e.message}`; }
  });
  await scenario('set() invalid __Host- (domain given)', async () => {
    try { return !!(await chrome.cookies.set({ url: 'https://a.test/', name: '__Host-x', value: 'v', secure: true, domain: 'a.test' })); } catch (e) { return `ERROR: ${e.message}`; }
  });
  await scenario('set() valid __Host- (host-only, path /, secure)', async () => {
    try { return !!(await chrome.cookies.set({ url: 'https://a.test/', name: '__Host-y', value: 'v', secure: true, path: '/' })); } catch (e) { return `ERROR: ${e.message}`; }
  });
  await scenario('set() __Secure- without secure', async () => {
    try { return !!(await chrome.cookies.set({ url: 'https://a.test/', name: '__Secure-z', value: 'v' })); } catch (e) { return `ERROR: ${e.message}`; }
  });
  await scenario('set() 4096-byte value; then 5000-byte value', async () => {
    const out = {};
    try { out.v4096 = (await chrome.cookies.set({ url: 'https://a.test/', name: 'big', value: 'x'.repeat(4096 - 3), secure: true }))?.value.length ?? null; } catch (e) { out.v4096 = `ERROR: ${e.message}`; }
    try { out.v5000 = (await chrome.cookies.set({ url: 'https://a.test/', name: 'big2', value: 'x'.repeat(5000), secure: true }))?.value.length ?? null; } catch (e) { out.v5000 = `ERROR: ${e.message}`; }
    return out;
  });

  // ---- E5: delete + undo round trip is byte-identical ------------------------------------
  record('E5 round trips (remove, then re-set from the captured cookie)', await run2(async () => {
    const toDetails = (c) => {
      const host = c.domain.replace(/^\./, '');
      const d = {
        url: `${c.secure ? 'https' : 'http'}://${host}${c.path}`,
        name: c.name, value: c.value, path: c.path,
        secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, storeId: c.storeId,
      };
      if (!c.hostOnly) d.domain = c.domain;
      if (!c.session) d.expirationDate = c.expirationDate;
      if (c.partitionKey) d.partitionKey = c.partitionKey;
      return d;
    };
    const canon = (c) => c && JSON.stringify(c, Object.keys(c).sort());
    await chrome.cookies.set({ url: 'https://a.test/x', name: 'dom', value: 'v', domain: 'a.test', path: '/x', secure: true, sameSite: 'strict', expirationDate: 1900000000.123456 });
    await chrome.cookies.set({ url: 'http://a.test/', name: 'insecure_unspec', value: 'v', sameSite: 'unspecified' });
    const all = await chrome.cookies.getAll({ partitionKey: {} });
    const out = {};
    for (const c of all) {
      const key = `${c.name}@${c.domain}${c.path}${c.partitionKey ? ' (partitioned)' : ''}`;
      const removed = await chrome.cookies.remove({ url: toDetails(c).url, name: c.name, storeId: c.storeId, ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}) });
      let after;
      try { after = canon(await chrome.cookies.set(toDetails(c))); } catch (e) { after = `ERROR: ${e.message}`; }
      out[key] = { removed: !!removed, identical: canon(c) === after, ...(canon(c) === after ? {} : { before: canon(c), after }) };
    }
    return out;
  }));
  record('E5.1 remove() return shape (names only)', await run2(async () => {
    await chrome.cookies.set({ url: 'https://a.test/', name: 'shape', value: 'v', secure: true, partitionKey: { topLevelSite: 'https://a.test' } });
    const r = await chrome.cookies.remove({ url: 'https://a.test/', name: 'shape', partitionKey: { topLevelSite: 'https://a.test' } });
    return r;
  }));

  record('E7 cookie stores', await run2(() => chrome.cookies.getAllCookieStores()));
  record('E8 permissions.remove of a required host (stand-in caveat)', await run2(async () => {
    try { return await chrome.permissions.remove({ origins: ['https://a.test/*'] }); } catch (e) { return `ERROR: ${e.message}`; }
  }));
}

// =====================================================================================
async function interactiveRun({ run, page }) {
  const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget', { targetId: page.targetId });
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 80, top: 80, width: 1000, height: 760, windowState: 'normal' } });
  await cdp.send('Target.activateTarget', { targetId: page.targetId });

  async function request(label, origins, shot) {
    console.error(`\n>>> ${label}: Chrome is showing a permission prompt. Click "Allow".`);
    const t0 = Date.now();
    const expression = `chrome.permissions.request({ origins: ${JSON.stringify(origins)} }).then(String, (e) => 'ERROR: ' + e.message)`;
    const pending = cdp.send('Runtime.evaluate', { expression, awaitPromise: true, userGesture: true, returnByValue: true }, page.sessionId);
    await sleep(1500);
    if (shot) {
      try {
        execFileSync('screencapture', ['-x', '-R', '80,80,1000,760', join(here, shot)]);
      } catch (e) { console.error(`screenshot failed: ${e.message}`); }
    }
    const value = await Promise.race([pending.then((r) => r.result.value), sleep(120000).then(() => 'TIMEOUT (nobody clicked)')]);
    record(`I ${label}`, { result: value, ms: Date.now() - t0, screenshot: shot ? `phase0/${shot}` : null, perms: await run(() => chrome.permissions.getAll()) });
  }

  await request('request a.test only', ['https://a.test/*'], 'prompt-narrow.png');
  record('I listings after real runtime grant of a.test', await listings(run));
  record('I set/remove: a.test (granted) vs b.test (not)', await run(async () => {
    const out = {};
    try { out.setA = !!(await chrome.cookies.set({ url: 'https://a.test/', name: 'rt', value: 'x', secure: true })); } catch (e) { out.setA = `ERROR: ${e.message}`; }
    try { out.removeA = !!(await chrome.cookies.remove({ url: 'https://a.test/', name: 'rt' })); } catch (e) { out.removeA = `ERROR: ${e.message}`; }
    try { out.setB = !!(await chrome.cookies.set({ url: 'https://b.test/', name: 'rt', value: 'x', secure: true })); } catch (e) { out.setB = `ERROR: ${e.message}`; }
    return out;
  }));
  record('I revoke a.test', await run(async () => ({
    removed: await chrome.permissions.remove({ origins: ['https://a.test/*'] }),
    perms: await chrome.permissions.getAll(),
    aTest: (await chrome.cookies.getAll({ url: 'https://a.test/', partitionKey: {} })).map((c) => c.name),
  })));
  await request('re-request a.test after revoke (silent if fast)', ['https://a.test/*'], null);
  await request('request all sites', ['<all_urls>'], 'prompt-all.png');
  record('I listings under <all_urls>', await listings(run));
  record('I remove a.test while <all_urls> granted', await run(async () => {
    let r;
    try { r = await chrome.permissions.remove({ origins: ['https://a.test/*'] }); } catch (e) { r = `ERROR: ${e.message}`; }
    return { r, perms: await chrome.permissions.getAll(), aTestCount: (await chrome.cookies.getAll({ url: 'https://a.test/' })).length };
  }));
  record('I remove <all_urls>', await run(async () => {
    let r;
    try { r = await chrome.permissions.remove({ origins: ['<all_urls>'] }); } catch (e) { r = `ERROR: ${e.message}`; }
    return { r, perms: await chrome.permissions.getAll(), aTestCount: (await chrome.cookies.getAll({ url: 'https://a.test/' })).length };
  }));
}
