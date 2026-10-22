// Core engine against real Chrome (spec §9 tests 1, 6–11, 18–20).
//   node test/e2e/engine.e2e.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, loadExtension, openExtensionPage, prepareExtension } from './cdp.mjs';
import { startFixtures, CHROME_ARGS } from './fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fx; let chrome; let ext; let page; let run;

async function visit(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  // The target starts on about:blank, which is already "complete"; wait for the real page.
  const host = new URL(url).host;
  for (let i = 0; i < 100; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: 'location.host + " " + document.readyState', returnByValue: true }, sessionId);
    if (r.result.value === `${host} complete`) break;
    await sleep(100);
  }
  await sleep(300); // iframes and their Set-Cookie
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, sessionId);
  await cdp.send('Target.closeTarget', { targetId });
  return result.value;
}

/** Ground truth from the browser's store, bypassing extension permissions. */
async function truth(cdp) {
  return (await cdp.send('Storage.getCookies')).cookies;
}

before(async () => {
  fx = await startFixtures();
  chrome = await launchChrome({ args: CHROME_ARGS });
  ext = await prepareExtension(root, { hosts: ['*://*.a.test/*', '*://*.b.test/*'] });
  const id = await loadExtension(chrome.cdp, ext.dir);
  await visit(chrome.cdp, fx.url('a.test/a'));
  await visit(chrome.cdp, fx.url('www.a.test/www'));
  // Wait for the fixtures' cookies (incl. the iframe's) rather than trusting a fixed delay.
  const want = ['a_plain', 'a_http', 'a_session', 'a_part', 'b_part', 'b_3p', 'www_only', 'parent_dom'];
  for (let i = 0; ; i++) {
    const have = new Set((await truth(chrome.cdp)).map((c) => c.name));
    if (want.every((n) => have.has(n))) break;
    if (i > 100) throw new Error(`fixture cookies missing: ${want.filter((n) => !have.has(n))}`);
    await sleep(100);
  }
  page = await openExtensionPage(chrome.cdp, `chrome-extension://${id}/e2e/harness.html`);
  run = page.run.bind(page);
});

after(async () => {
  await chrome?.close();
  await ext?.cleanup();
  fx?.close();
});

test('test 1: list shows unpartitioned and partitioned cookies (first and third party) for the site', async () => {
  const listed = await run(async () => (await engine.list({ site: 'a.test', storeId: '0' })).map((c) => `${c.name}${c.partitionKey ? '*' : ''}`));
  for (const name of ['a_plain', 'a_http', 'a_session', 'a_part*', 'b_part*', 'parent_dom', 'www_only']) assert.ok(listed.includes(name), `${name} listed`);
  assert.ok(!listed.includes('b_3p'), 'b.test unpartitioned cookies belong to b.test, not a.test');
  // Nothing in the store that belongs to the site is missing.
  const expected = (await truth(chrome.cdp)).filter((c) => /(^|\.)a\.test$/.test(c.domain.replace(/^\./, '')) || c.partitionKey?.topLevelSite === 'https://a.test');
  assert.equal(listed.length, expected.length);
});

test('test 6: a value edit is one logical change; Chrome\'s overwrite+explicit pair is absorbed', async () => {
  const r = await run(async () => {
    const c = (await engine.list({ site: 'a.test', storeId: '0' })).find((x) => x.name === 'a_plain');
    window.events.length = 0; window.changes = 0;
    await engine.save(c, { ...c, value: 'two' });
    await new Promise((res) => setTimeout(res, 200));
    return { events: window.events.map((e) => `${e.removed ? '-' : '+'}${e.cause}`), changes: window.changes, value: (await engine.findExact(c)).value.length };
  });
  assert.deepEqual(r.events, ['-overwrite', '+explicit']);
  assert.equal(r.changes, 1);
  assert.equal(r.value, 3);
});

test('test 7: SameSite=None without Secure is blocked before writing; original intact', async () => {
  const r = await run(async () => {
    const c = (await engine.list({ site: 'a.test', storeId: '0' })).find((x) => x.name === 'a_plain');
    window.events.length = 0;
    let err;
    try { await engine.save(c, { ...c, secure: false, sameSite: 'no_restriction' }); } catch (e) { err = { code: e.code, message: e.message }; }
    return { err, events: window.events.length, still: core.model.sameCookie(await engine.findExact(c), c) };
  });
  assert.equal(r.err.code, 'invalid');
  assert.match(r.err.message, /Secure/);
  assert.equal(r.events, 0);
  assert.ok(r.still);
});

test('test 8: Chrome rejects the new half of a rename -> nothing lost, user told why', async () => {
  const r = await run(async () => {
    // A non-Secure cookie can't take the name of a Secure one on an overlapping domain; only Chrome knows.
    await chrome.cookies.set({ url: 'http://a.test/', name: 'loose', value: 'l' });
    const c = await engine.findExact({ name: 'loose', domain: 'a.test', path: '/', storeId: '0' });
    const before = await chrome.cookies.getAll({ partitionKey: {} });
    let err;
    try { await engine.save(c, { ...c, name: 'parent_dom' }); } catch (e) { err = { code: e.code, rolledBack: e.rolledBack, message: e.message }; }
    const after = await chrome.cookies.getAll({ partitionKey: {} });
    const same = before.length === after.length && before.every((b) => after.some((a) => core.model.sameCookie(a, b)));
    return { err, same };
  });
  assert.equal(r.err.code, 'secure_shadow');
  assert.equal(r.err.rolledBack, true);
  assert.ok(r.same, 'store unchanged');
});

test('test 9: an expiry in the past deletes (validator warns first), undo restores it', async () => {
  const r = await run(async () => {
    const c = (await engine.list({ site: 'a.test', storeId: '0' })).find((x) => x.name === 'a_http');
    const draft = { ...c, session: false, expirationDate: Date.now() / 1000 - 60 };
    const warnings = core.validate.validateCookie(draft, { now: Date.now() }).warnings.map((w) => w.code);
    const { undoId } = await engine.save(c, draft);
    const gone = !(await engine.findExact(c));
    await engine.undo(undoId);
    return { warnings, gone, back: core.model.sameCookie(await engine.findExact(c), c) };
  });
  assert.ok(r.warnings.includes('expired_deletes'));
  assert.ok(r.gone);
  assert.ok(r.back);
});

test('test 10: deleting each cookie and undoing restores it byte-identically (httpOnly, sameSite, path, expiry, partition)', async () => {
  const r = await run(async () => {
    const all = await engine.list({ site: 'a.test', storeId: '0' });
    const out = {};
    for (const c of all) {
      const { undoId } = await engine.remove([c]);
      const others = (await engine.list({ site: 'a.test', storeId: '0' })).length;
      await engine.undo(undoId);
      out[`${c.name}${c.partitionKey ? '*' : ''}`] = { precise: others === all.length - 1, identical: core.model.sameCookie(await engine.findExact(c), c) };
    }
    return out;
  });
  for (const [name, v] of Object.entries(r)) {
    assert.ok(v.precise, `${name}: only that cookie deleted`);
    assert.ok(v.identical, `${name}: restored byte-identically`);
  }
});

test('test 11: editing the session cookie of a logged-in site keeps you logged in', async () => {
  assert.equal(await visit(chrome.cdp, fx.url('a.test/login')), 'login');
  assert.equal(await visit(chrome.cdp, fx.url('a.test/whoami')), 'logged-in');
  await run(async () => {
    const sid = (await engine.list({ site: 'a.test', storeId: '0' })).find((x) => x.name === 'sid');
    await engine.save(sid, { ...sid, httpOnly: false, sameSite: 'strict' });
  });
  assert.equal(await visit(chrome.cdp, fx.url('a.test/whoami')), 'logged-in');
  await run(async () => {
    const sid = (await engine.list({ site: 'a.test', storeId: '0' })).find((x) => x.name === 'sid');
    await engine.save(sid, { ...sid, value: 'forged' });
  });
  assert.equal(await visit(chrome.cdp, fx.url('a.test/whoami')), 'anonymous', 'changing the value does log out');
  await run(() => engine.undo());
  assert.equal(await visit(chrome.cdp, fx.url('a.test/whoami')), 'logged-in', 'undo logs back in');
});

test('test 19: a hostile import is rejected with a specific message and writes nothing', async () => {
  const r = await run(async () => {
    window.events.length = 0;
    const bad = JSON.stringify([
      { name: 'ok', value: '1', domain: 'a.test', path: '/', secure: true },
      { name: 'evil', value: '1', domain: 'a.test', path: '/', secure: false, sameSite: 'no_restriction' },
    ]);
    const parsed = core.io.parseImport(bad, { now: Date.now(), isPublicSuffix: core.site.isPublicSuffix });
    const notJson = core.io.parseImport('{"__proto__": {"x": 1}, "cookies": ', {});
    await new Promise((res) => setTimeout(res, 100));
    return { parsed, notJson, events: window.events.length, polluted: ({}).x };
  });
  assert.equal(r.parsed.ok, false);
  assert.match(r.parsed.error.message, /Entry 2/);
  assert.equal(r.notJson.ok, false);
  assert.equal(r.events, 0);
  assert.equal(r.polluted, undefined);
});

test('test 20: a 4 KB value renders back, edits and round-trips', async () => {
  const r = await run(async () => {
    const created = await engine.save(null, { name: 'big', value: 'v'.repeat(4093), domain: 'a.test', hostOnly: true, path: '/', secure: true, storeId: '0' });
    const edited = await engine.save(created.cookie, { ...created.cookie, value: 'w'.repeat(4093) });
    let tooBig;
    try { await engine.save(edited.cookie, { ...edited.cookie, value: 'w'.repeat(4094) }); } catch (e) { tooBig = e.code; }
    return { len: (await engine.findExact(edited.cookie)).value.length, tooBig };
  });
  assert.equal(r.len, 4093);
  assert.equal(r.tooBig, 'invalid');
});

test('undo survives closing and reopening the page (storage.session)', async () => {
  const before = await run(() => engine.undoList());
  const reopened = await openExtensionPage(chrome.cdp, (await chrome.cdp.send('Target.getTargetInfo', { targetId: page.targetId })).targetInfo.url);
  const afterList = await reopened.run(() => engine.undoList());
  assert.ok(before.length > 0);
  assert.deepEqual(afterList.map((e) => e.id), before.map((e) => e.id));
  await chrome.cdp.send('Target.closeTarget', { targetId: reopened.targetId });
});

test('test 18: export, then import on a clean profile -> identical cookie set, all flags preserved', async () => {
  const exported = await run(async () => {
    const list = await engine.list({ site: 'a.test', storeId: '0' });
    return { text: core.io.exportJson(list, { site: 'a.test', storeId: '0', now: Date.now() }), list };
  });
  assert.match(JSON.parse(exported.text).warning, /password/i);
  const clean = await launchChrome({ args: CHROME_ARGS });
  try {
    const id = await loadExtension(clean.cdp, ext.dir);
    const p = await openExtensionPage(clean.cdp, `chrome-extension://${id}/e2e/harness.html`);
    const r = await p.run(async (text, original) => {
      const parsed = core.io.parseImport(text, { now: Date.now(), isPublicSuffix: core.site.isPublicSuffix });
      if (!parsed.ok) return { error: parsed.error };
      await engine.importDrafts(parsed.drafts, { storeId: '0' });
      const now = await engine.list({ site: 'a.test', storeId: '0' });
      const missing = original.filter((o) => !now.some((n) => core.model.sameCookie(n, o))).map((o) => o.name);
      return { count: now.length, missing };
    }, exported.text, exported.list);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.missing, []);
    assert.equal(r.count, exported.list.length);
  } finally {
    await clean.close();
  }
});

test('Chrome stores a non-canonical topLevelSite in canonical form, and the engine finds it', async () => {
  const r = await run(async () => {
    // Raw API: what does Chrome store for 'https://WWW.a.test:8443/x'?
    await chrome.cookies.set({ url: 'https://a.test/', name: 'canon_raw', value: 'v', secure: true, partitionKey: { topLevelSite: 'https://WWW.a.test:8443/x' } });
    const raw = (await chrome.cookies.getAll({ name: 'canon_raw', partitionKey: {} }))[0]?.partitionKey ?? null;
    // Engine: writing through a non-canonical key must hit the same cookie, not a twin.
    const created = await engine.save(null, { name: 'canon', value: '1', domain: 'a.test', hostOnly: true, path: '/', secure: true, storeId: '0', partitionKey: { topLevelSite: 'https://a.test' } });
    const { undoId } = await engine.save(null, { name: 'canon', value: '2', domain: 'a.test', hostOnly: true, path: '/', secure: true, storeId: '0', partitionKey: { topLevelSite: 'https://www.a.test:8443' } });
    const twins = (await chrome.cookies.getAll({ name: 'canon', partitionKey: {} })).length;
    await engine.undo(undoId);
    const back = await engine.findExact(created.cookie);
    return { raw, twins, backValue: back?.value };
  });
  assert.deepEqual(r.raw, { hasCrossSiteAncestor: false, topLevelSite: 'https://a.test' });
  assert.equal(r.twins, 1);
  assert.equal(r.backValue, '1');
});

test('undo refuses to overwrite a value the site changed since, then honours force', async () => {
  const r = await run(async () => {
    const c = (await engine.list({ site: 'a.test', storeId: '0' })).find((x) => x.name === 'a_plain');
    const { undoId, cookie } = await engine.save(c, { ...c, value: 'mine' });
    // The site rewrites the cookie (as a page script or Set-Cookie would).
    await chrome.cookies.set({ ...core.model.toSetDetails(cookie), value: 'site' });
    let conflict;
    try { await engine.undo(undoId); } catch (e) { conflict = { code: e.code, cookies: e.cookies }; }
    const stillSite = (await engine.findExact(c)).value;
    await engine.undo(undoId, { force: true });
    return { conflict, stillSite, restored: core.model.sameCookie(await engine.findExact(c), c) };
  });
  assert.equal(r.conflict.code, 'undo_conflict');
  assert.deepEqual(r.conflict.cookies, ['a_plain']);
  assert.equal(r.stillSite, 'site');
  assert.ok(r.restored);
});
