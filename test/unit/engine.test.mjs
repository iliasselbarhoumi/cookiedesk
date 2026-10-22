// Transaction / undo engine against the fake store (spec §5.4, §9 tests 1, 6–10, 19, 20).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, probeFeatures, JOURNAL_MAX, JOURNAL_TTL_MS } from '../../src/core/cookies.js';
import { sameCookie } from '../../src/core/model.js';
import { createFakeChrome } from './fake-chrome.mjs';

const FEATS = { partitionKey: true, hasCrossSiteAncestor: true, getPartitionKey: true };
const T0 = 1_800_000_000_000;

function setup() {
  let t = T0;
  const fake = createFakeChrome({ now: () => t });
  const engine = createEngine({ cookies: fake.cookies, storage: fake.storage, feats: FEATS, now: () => t });
  return { fake, engine, advance: (ms) => { t += ms; } };
}

const seedSite = (fake) => ({
  plain: fake.seed({ url: 'https://a.test/', name: 'plain', value: 'one', secure: true, sameSite: 'lax', expirationDate: T0 / 1000 + 3600.25 }),
  http: fake.seed({ url: 'https://a.test/', name: 'sid', value: 'secret', secure: true, httpOnly: true, sameSite: 'strict' }),
  dom: fake.seed({ url: 'https://www.a.test/', name: 'dom', value: 'd', domain: 'a.test', secure: true }),
  part: fake.seed({ url: 'https://a.test/', name: 'part', value: 'p', secure: true, sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://a.test' } }),
  third: fake.seed({ url: 'https://b.test/', name: 'tp', value: 't', secure: true, sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://a.test' } }),
  other: fake.seed({ url: 'https://c.test/', name: 'other', value: 'o', secure: true }),
});

test('list: a site shows unpartitioned + partitioned cookies, including third parties partitioned under it (test 1)', async () => {
  const { fake, engine } = setup();
  seedSite(fake);
  const names = (await engine.list({ site: 'a.test', storeId: '0' })).map((c) => `${c.name}${c.partitionKey ? '*' : ''}`);
  assert.deepEqual(names.sort(), ['dom', 'part*', 'plain', 'sid', 'tp*']);
});

test('list on Chrome without partition support asks only for unpartitioned cookies (test 5)', async () => {
  const fake = createFakeChrome();
  seedSite(fake);
  const engine = createEngine({ cookies: fake.cookies, storage: fake.storage, feats: { partitionKey: false, hasCrossSiteAncestor: false, getPartitionKey: false } });
  const names = (await engine.list({ site: 'a.test' })).map((c) => c.name).sort();
  assert.deepEqual(names, ['dom', 'plain', 'sid']);
});

test('value edit is one overwrite, one journal entry, undo restores byte-identically (tests 6, 10)', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  const before = fake.all();
  const { undoId, cookie } = await engine.save(plain, { ...plain, value: 'two' });
  assert.equal(cookie.value, 'two');
  assert.equal(fake.calls.remove, 0, 'same-key edit never calls remove()');
  assert.equal((await engine.undoList()).length, 1);
  await engine.undo(undoId);
  const after = fake.all();
  assert.equal(after.length, before.length);
  for (const c of before) assert.ok(after.some((x) => sameCookie(x, c)), `${c.name} restored exactly`);
});

test('change listener fires once per edit despite the overwrite+explicit pair (test 6)', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  let calls = 0;
  engine.onChange(() => { calls++; });
  await engine.save(plain, { ...plain, value: 'two' });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(calls, 1);
});

test('illegal combination is blocked before any write; original untouched (test 7)', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  const sets = fake.calls.set;
  await assert.rejects(engine.save(plain, { ...plain, secure: false, sameSite: 'no_restriction' }), (e) => e.code === 'invalid' && /Secure/.test(e.message));
  assert.equal(fake.calls.set, sets);
  assert.ok(fake.all().some((c) => sameCookie(c, plain)));
});

test('rename where Chrome rejects the new cookie: nothing changes, user told (test 8)', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  const before = fake.all();
  fake.failNext((d) => d.name === 'renamed');
  await assert.rejects(engine.save(plain, { ...plain, name: 'renamed' }), (e) => e.code === 'rejected' && e.rolledBack === true);
  assert.deepEqual(fake.all(), before);
});

test('rename where deleting the old cookie fails: the new one is rolled back, original intact (test 8)', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  fake.failNext((d) => d.name === 'plain' && d.expirationDate === 1);
  // erase() falls back to remove(); make that fail too by injecting a second failure path
  const origRemove = fake.cookies.remove;
  fake.cookies.remove = async () => { throw new Error('boom'); };
  await assert.rejects(engine.save(plain, { ...plain, name: 'renamed' }), (e) => e.rolledBack === true);
  fake.cookies.remove = origRemove;
  const names = fake.all().map((c) => c.name);
  assert.ok(names.includes('plain'));
  assert.ok(!names.includes('renamed'));
});

test('expiry in the past deletes the cookie, and undo brings it back (test 9)', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  const { undoId, cookie } = await engine.save(plain, { ...plain, session: false, expirationDate: T0 / 1000 - 10 });
  assert.equal(cookie, null);
  assert.ok(!fake.all().some((c) => c.name === 'plain'));
  assert.match((await engine.undoList())[0].label, /expiry in the past/);
  await engine.undo(undoId);
  assert.ok(fake.all().some((c) => sameCookie(c, plain)));
});

test('delete is precise: same-name neighbours on the same URL survive; undo is byte-identical (test 10)', async () => {
  const { fake, engine } = setup();
  const host = fake.seed({ url: 'https://a.test/', name: 'dup', value: 'host', secure: true, httpOnly: true, sameSite: 'strict', expirationDate: T0 / 1000 + 99.5 });
  const dom = fake.seed({ url: 'https://a.test/', name: 'dup', value: 'dom', domain: 'a.test', secure: true });
  const deep = fake.seed({ url: 'https://a.test/x', name: 'dup', value: 'deep', path: '/x', secure: true });
  const { undoId } = await engine.remove([deep]);
  const left = fake.all();
  assert.ok(left.some((c) => sameCookie(c, host)));
  assert.ok(left.some((c) => sameCookie(c, dom)));
  assert.ok(!left.some((c) => sameCookie(c, deep)));
  await engine.undo(undoId);
  assert.ok(fake.all().some((c) => sameCookie(c, deep)));
});

test('partitioned cookie edit keeps its partition and undo restores it', async () => {
  const { fake, engine } = setup();
  const { part } = seedSite(fake);
  const { undoId, cookie } = await engine.save(part, { ...part, value: 'new' });
  assert.deepEqual(cookie.partitionKey, part.partitionKey);
  assert.equal(fake.all().filter((c) => c.name === 'part').length, 1);
  await engine.undo(undoId);
  assert.ok(fake.all().some((c) => sameCookie(c, part)));
});

test('add onto an existing key journals the displaced cookie', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  const { undoId } = await engine.save(null, { name: 'plain', value: 'x', domain: 'a.test', hostOnly: true, path: '/', secure: true });
  await engine.undo(undoId);
  assert.ok(fake.all().some((c) => sameCookie(c, plain)));
});

test('rename onto an existing name keeps the overwritten cookie for undo', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  const victim = fake.seed({ url: 'https://a.test/', name: 'victim', value: 'v', secure: true });
  const { undoId } = await engine.save(plain, { ...plain, name: 'victim' });
  assert.ok(!fake.all().some((c) => c.name === 'plain'));
  await engine.undo(undoId);
  const all = fake.all();
  assert.ok(all.some((c) => sameCookie(c, plain)));
  assert.ok(all.some((c) => sameCookie(c, victim)));
});

test('editing a cookie that vanished meanwhile is refused, not recreated', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  await fake.cookies.remove({ url: 'https://a.test/', name: 'plain' });
  await assert.rejects(engine.save(plain, { ...plain, value: 'x' }), (e) => e.code === 'gone');
});

test('non-Secure cookie shadowed by a Secure one gets a specific explanation', async () => {
  const { fake, engine } = setup();
  fake.seed({ url: 'https://a.test/', name: 'tok', value: 's', domain: 'a.test', secure: true });
  await assert.rejects(engine.save(null, { name: 'tok', value: 'i', domain: 'www.a.test', hostOnly: true, path: '/', secure: false }), (e) => e.code === 'secure_shadow');
});

test('import is all-or-nothing: a failure midway rolls back every earlier write (test 19)', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  const before = fake.all();
  fake.failNext((d) => d.name === 'n3');
  const drafts = [
    { name: 'n1', value: '1', domain: 'a.test', hostOnly: true, path: '/', secure: true },
    { ...plain, value: 'overwritten' },
    { name: 'n3', value: '3', domain: 'a.test', hostOnly: true, path: '/', secure: true },
  ];
  await assert.rejects(engine.importDrafts(drafts, { storeId: '0' }), (e) => e.rolledBack === true);
  assert.deepEqual(fake.all().sort((a, b) => a.name.localeCompare(b.name)), before.sort((a, b) => a.name.localeCompare(b.name)));
});

test('import validates every entry before the first write', async () => {
  const { fake, engine } = setup();
  const sets = fake.calls.set;
  await assert.rejects(engine.importDrafts([
    { name: 'ok', value: '1', domain: 'a.test', hostOnly: true, path: '/', secure: true },
    { name: 'bad', value: '1', domain: 'a.test', hostOnly: true, path: '/', secure: false, sameSite: 'no_restriction' },
  ]), (e) => e.code === 'invalid');
  assert.equal(fake.calls.set, sets);
});

test('4 KB value edits and round-trips; 4097 bytes is refused before writing (test 20)', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  const big = 'x'.repeat(4096 - 'plain'.length);
  const { cookie, undoId } = await engine.save(plain, { ...plain, value: big });
  assert.equal(cookie.value.length, big.length);
  await assert.rejects(engine.save(cookie, { ...cookie, value: `${big}y` }), (e) => e.code === 'invalid');
  await engine.undo(undoId);
  assert.ok(fake.all().some((c) => sameCookie(c, plain)));
});

test('journal keeps the last 20 entries for 10 minutes, and holds no values in undoList()', async () => {
  const { fake, engine, advance } = setup();
  const { plain } = seedSite(fake);
  let cur = plain;
  for (let i = 0; i < JOURNAL_MAX + 5; i++) cur = (await engine.save(cur, { ...cur, value: `SECRET-VALUE-${i}` })).cookie;
  const list = await engine.undoList();
  assert.equal(list.length, JOURNAL_MAX);
  assert.ok(!JSON.stringify(list).includes('SECRET-VALUE'), 'undoList exposes labels only');
  advance(JOURNAL_TTL_MS + 1);
  assert.equal((await engine.undoList()).length, 0);
  assert.equal(Object.keys(await fake.storage.get(null)).length, 0, 'expired entries (and their values) are deleted, not just hidden');
  await assert.rejects(engine.undo(), (e) => e.code === 'undo_expired');
});

test('undo refuses to overwrite a value the site wrote since, unless forced', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  const { undoId, cookie } = await engine.save(plain, { ...plain, value: 'mine' });
  await fake.cookies.set({ url: 'https://a.test/', name: 'plain', value: 'site-wrote', secure: true, sameSite: 'lax', expirationDate: cookie.expirationDate });
  await assert.rejects(engine.undo(undoId), (e) => e.code === 'undo_conflict' && e.cookies.includes('plain'));
  assert.equal(fake.all().find((c) => c.name === 'plain').value, 'site-wrote');
  await engine.undo(undoId, { force: true });
  assert.ok(fake.all().some((c) => sameCookie(c, plain)));
});

test('undoing an older edit after a newer one conflicts instead of destroying the newer value', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  const e1 = await engine.save(plain, { ...plain, value: 'v2' });
  const e2 = await engine.save(e1.cookie, { ...e1.cookie, value: 'v3' });
  await assert.rejects(engine.undo(e1.undoId), (e) => e.code === 'undo_conflict');
  await engine.undo(e2.undoId);
  await engine.undo(e1.undoId);
  assert.ok(fake.all().some((c) => sameCookie(c, plain)));
});

test('an undo is itself undoable (redo)', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  const { undoId } = await engine.save(plain, { ...plain, value: 'v2' });
  await engine.undo(undoId);
  const [redo] = await engine.undoList();
  assert.match(redo.label, /^Undid: Edited/);
  await engine.undo(redo.id);
  assert.equal(fake.all().find((c) => c.name === 'plain').value, 'v2');
});

test('concurrent saves each get their own journal entry', async () => {
  const { fake, engine } = setup();
  const { plain, http } = seedSite(fake);
  await Promise.all([engine.save(plain, { ...plain, value: 'a' }), engine.save(http, { ...http, value: 'b' })]);
  assert.equal((await engine.undoList()).length, 2);
});

test('concurrent undo and save: the undone entry does not come back', async () => {
  const { fake, engine } = setup();
  const { plain, http } = seedSite(fake);
  const { undoId } = await engine.save(plain, { ...plain, value: 'a' });
  await Promise.all([engine.undo(undoId), engine.save(http, { ...http, value: 'b' })]);
  const labels = (await engine.undoList()).map((e) => e.label);
  assert.ok(!labels.includes('Edited "plain"'));
  assert.ok(labels.includes('Edited "sid"'));
});

test('the journal entry exists before the first write (popup closing mid-transaction leaves an undo)', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  let seenAtFirstSet = null;
  const realSet = fake.cookies.set;
  fake.cookies.set = async (d) => {
    seenAtFirstSet ??= Object.keys(await fake.storage.get(null)).filter((k) => k.startsWith('undo:')).length;
    return realSet(d);
  };
  await engine.save(plain, { ...plain, value: 'x' });
  assert.equal(seenAtFirstSet, 1);
});

test('a legacy cookie that Chrome can only delete with its neighbours is refused, nothing lost', async () => {
  const { fake, engine } = setup();
  // Legacy order: non-Secure cookies stored before a Secure same-name Domain cookie appeared.
  const deep = fake.seed({ url: 'http://a.test/x', name: 'tok', value: 'deep', path: '/x' });
  const root = fake.seed({ url: 'http://a.test/', name: 'tok', value: 'root' });
  fake.seed({ url: 'https://a.test/', name: 'tok', value: 's', domain: 'a.test', secure: true });
  const before = fake.all();
  await assert.rejects(engine.remove([deep]), (e) => e.code === 'imprecise_delete' && e.rolledBack === true);
  assert.equal(fake.all().length, before.length);
  assert.ok(fake.all().some((c) => sameCookie(c, root)));
});

test('a cookie Chrome would not accept again is only deleted with explicit consent (no undo possible)', async () => {
  const { fake, engine } = setup();
  const lone = fake.seed({ url: 'http://a.test/', name: 'solo', value: 'v' });
  fake.seed({ url: 'https://www.a.test/', name: 'solo', value: 's', domain: 'a.test', secure: true });
  await assert.rejects(engine.remove([lone]), (e) => e.code === 'irreversible');
  assert.ok(fake.all().some((c) => sameCookie(c, lone)));
  await engine.remove([lone], { allowIrreversible: true });
  assert.ok(!fake.all().some((c) => sameCookie(c, lone)));
});

test('undo skips restores that would already have expired, and still restores the rest', async () => {
  const { fake, engine, advance } = setup();
  const short = fake.seed({ url: 'https://a.test/', name: 'short', value: 's', secure: true, expirationDate: T0 / 1000 + 60 });
  const long = fake.seed({ url: 'https://a.test/', name: 'long', value: 'l', secure: true });
  const { undoId } = await engine.remove([short, long]);
  advance(120_000);
  const r = await engine.undo(undoId);
  assert.deepEqual(r.skipped, ['short']);
  assert.ok(fake.all().some((c) => sameCookie(c, long)));
});

test('an edit always stays in the original cookie store', async () => {
  const { fake, engine } = setup();
  const { plain } = seedSite(fake);
  await engine.save(plain, { ...plain, value: 'x', storeId: '1' });
  assert.equal(fake.all().find((c) => c.name === 'plain').value, 'x');
});

test('a non-canonical topLevelSite matches the partition Chrome stores (no unjournaled overwrite)', async () => {
  const { fake, engine } = setup();
  const { part } = seedSite(fake);
  const { undoId } = await engine.save(null, { name: 'part', value: 'new', domain: 'a.test', hostOnly: true, path: '/', secure: true, sameSite: 'no_restriction', storeId: '0', partitionKey: { topLevelSite: 'https://WWW.a.test:8443' } });
  assert.equal(fake.all().filter((c) => c.name === 'part').length, 1);
  await engine.undo(undoId);
  assert.ok(fake.all().some((c) => sameCookie(c, part)));
});

test('a partitioned draft on Chrome without partition support is refused, not silently unpartitioned', async () => {
  const fake = createFakeChrome();
  const engine = createEngine({ cookies: fake.cookies, storage: fake.storage, feats: { partitionKey: false, hasCrossSiteAncestor: false, getPartitionKey: false } });
  await assert.rejects(engine.importDrafts([{ name: 'p', value: 'v', domain: 'a.test', hostOnly: true, path: '/', secure: true, partitionKey: { topLevelSite: 'https://a.test' } }]), (e) => e.code === 'partition_unsupported');
  assert.equal(fake.all().length, 0);
});

test('pruneJournal drops undo copies of cookie stores that no longer exist (closed incognito)', async () => {
  const { fake, engine } = setup();
  const normal = fake.seed({ url: 'https://a.test/', name: 'n', value: 'v', secure: true });
  const incog = fake.seed({ url: 'https://a.test/', name: 'i', value: 'secret', secure: true, storeId: '1' });
  await engine.remove([normal]);
  await engine.remove([incog]);
  assert.equal((await engine.undoList()).length, 2);
  await engine.pruneJournal({ liveStores: ['0'] });
  const left = await engine.undoList();
  assert.deepEqual(left.map((e) => e.label), ['Deleted "n"']);
  assert.ok(!JSON.stringify(await fake.storage.get(null)).includes('secret'));
});

test('a change too large to keep an undo copy asks first, and runs without undo only on consent', async () => {
  const { fake, engine } = setup();
  const big = 'x'.repeat(4000);
  const drafts = Array.from({ length: 1100 }, (_, i) => ({ name: `c${i}`, value: big, domain: `s${i % 10}.a.test`, hostOnly: true, path: '/', secure: true }));
  await assert.rejects(engine.importDrafts(drafts, { storeId: '0' }), (e) => e.code === 'too_large_to_undo');
  assert.equal(fake.all().length, 0, 'nothing written before consent');
  const r = await engine.importDrafts(drafts, { storeId: '0', allowIrreversible: true });
  assert.equal(r.undoId, null);
  assert.equal(fake.all().length, 1100);
});

test('probeFeatures asks Chrome which partition properties it accepts (test 5: the UA can lie)', async () => {
  // Chrome's validator throws on a property it doesn't know, before any permission check.
  const chromeOf = (known) => ({
    async getAll(details) {
      for (const k of Object.keys(details.partitionKey ?? {})) if (!known.includes(k)) throw new Error(`Unexpected property: '${k}'.`);
      if ('partitionKey' in details && !known.includes('partitionKey')) throw new Error("Unexpected property: 'partitionKey'.");
      return [];
    },
  });
  assert.deepEqual(await probeFeatures(chromeOf([])), { partitionKey: false, hasCrossSiteAncestor: false, getPartitionKey: false });
  assert.deepEqual(await probeFeatures(chromeOf(['partitionKey', 'topLevelSite'])), { partitionKey: true, hasCrossSiteAncestor: false, getPartitionKey: false });
  const modern = { ...chromeOf(['partitionKey', 'topLevelSite', 'hasCrossSiteAncestor']), getPartitionKey() {} };
  assert.deepEqual(await probeFeatures(modern), { partitionKey: true, hasCrossSiteAncestor: true, getPartitionKey: true });
});

test('an engine without injected flags corrects the version estimate before its first read', async () => {
  const seen = [];
  const cookies = {
    async getAll(details) {
      if (details.partitionKey && 'hasCrossSiteAncestor' in details.partitionKey) throw new Error("Unexpected property: 'hasCrossSiteAncestor'.");
      seen.push(details);
      return [];
    },
  };
  const engine = createEngine({ cookies, storage: createFakeChrome().storage }); // node's UA has no Chrome version: estimate says "all APIs"
  await engine.list({ site: 'a.test', storeId: '0' });
  assert.equal(engine.feats.hasCrossSiteAncestor, false);
  assert.ok(seen.every((d) => !d.partitionKey || !('hasCrossSiteAncestor' in d.partitionKey)));
});
