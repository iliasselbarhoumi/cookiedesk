import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJson, parseImport, exportNetscape, exportDocumentCookie, EXPORT_WARNING } from '../../src/core/io.js';

const NOW = 1_700_000_000_000;
const SEC = NOW / 1000;
const ctx = { now: NOW };
const ck = (o = {}) => ({
  name: 'sid', value: 'v1', domain: '.example.com', hostOnly: false, path: '/', secure: true, httpOnly: true,
  sameSite: 'lax', session: false, expirationDate: SEC + 1000.123456, storeId: '0', ...o,
});
const stripStore = ({ storeId, ...rest }) => rest;
const bad = (r, code) => { assert.equal(r.ok, false); if (code) assert.equal(r.error.code, code); return r.error; };

const full = [
  ck(),
  ck({ name: 'host', domain: 'www.example.com', hostOnly: true, httpOnly: false, sameSite: 'strict', secure: false }),
  ck({ name: 'sess', session: true, expirationDate: undefined, sameSite: 'unspecified', secure: false }),
  ck({ name: 'none', sameSite: 'no_restriction', path: '/app' }),
  ck({ name: 'part', domain: 'cdn.test', hostOnly: true, partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: true } }),
  ck({ name: 'part', domain: 'example.com', hostOnly: true, partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false } }),
  ck({ name: 'ünï', value: '€ value=with=equals', domain: 'b.test', hostOnly: true }),
];

test('exportJson envelope', () => {
  const o = JSON.parse(exportJson(full, { site: 'example.com', storeId: '0', now: NOW }));
  assert.equal(o.format, 'cookiedesk');
  assert.equal(o.version, 1);
  assert.equal(o.exportedAt, new Date(NOW).toISOString());
  assert.equal(o.site, 'example.com');
  assert.equal(o.storeId, '0');
  assert.equal(o.warning, 'This file contains live session cookies. Anyone who has it can sign in as you on these sites. Treat it like a password and delete it when done.');
  assert.equal(o.warning, EXPORT_WARNING);
  assert.equal(o.cookies.length, full.length);
  for (const c of o.cookies) assert.ok(!('storeId' in c));
  assert.ok(!('expirationDate' in o.cookies[2]));
  assert.ok(!('partitionKey' in o.cookies[0]));
  assert.deepEqual(o.cookies[4].partitionKey, full[4].partitionKey);
});

test('exportJson -> parseImport round trip preserves every field', () => {
  const text = exportJson(full, { site: 'example.com', storeId: '0', now: NOW });
  const r = parseImport(text, ctx);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.source, 'cookiedesk');
  const expected = full.map((c) => {
    const e = stripStore(c);
    if (e.session) delete e.expirationDate;
    return e;
  });
  assert.deepEqual(r.drafts, expected);
  assert.equal(r.drafts[0].expirationDate, SEC + 1000.123456);
  assert.deepEqual(r.domains, ['b.test', 'cdn.test', 'example.com', 'www.example.com']);
});

test('Netscape round trip (lossy where the format is)', () => {
  const plain = full.filter((c) => !c.partitionKey);
  const txt = exportNetscape(plain);
  assert.match(txt, /^# Netscape HTTP Cookie File/);
  assert.match(txt, /^#HttpOnly_\.example\.com\tTRUE\t\/\tTRUE\t\d+\tsid\tv1$/m);
  assert.match(txt, /^www\.example\.com\tFALSE\t\/\tFALSE\t\d+\thost\tv1$/m);
  assert.match(txt, /\tsess\tv1$/m);
  const sessLine = txt.split('\n').find((l) => l.endsWith('\tsess\tv1'));
  assert.equal(sessLine.split('\t')[4], '0');
  const r = parseImport(txt, ctx);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.source, 'netscape');
  const expected = plain.map((c) => {
    const e = stripStore(c);
    e.sameSite = 'unspecified';
    if (e.session) delete e.expirationDate; else e.expirationDate = Math.floor(e.expirationDate);
    return e;
  });
  assert.deepEqual(r.drafts, expected);
});

test('exportNetscape skips partitioned cookies and says so', () => {
  const txt = exportNetscape(full);
  assert.match(txt, /# 2 partitioned cookie/);
  assert.ok(!txt.includes('\tpart\t'));
});

test('Netscape parsing details', () => {
  const txt = [
    '# Netscape HTTP Cookie File', '', '# a comment',
    '#HttpOnly_.example.com\tTRUE\t/\tTRUE\t0\ta\tb',
    'example.org\tFALSE\t/x\tFALSE\t4102444800\temptyval\t',
    'example.org\tFALSE\t/x\tFALSE\t4102444800\tshort', // 6 fields: empty value
  ].join('\r\n');
  const r = parseImport(txt, { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.drafts[0].httpOnly, true);
  assert.equal(r.drafts[0].session, true);
  assert.equal(r.drafts[1].value, '');
  assert.equal(r.drafts[2].value, '');
  assert.ok(r.warnings.some((w) => /clamp|limits|400/i.test(w)));
});

test('Netscape malformed lines are rejected', () => {
  bad(parseImport('example.com\tTRUE\t/\tTRUE\t0', ctx), 'bad_line');
  bad(parseImport('example.com\tMAYBE\t/\tTRUE\t0\ta\tb', ctx), 'bad_line');
  bad(parseImport('example.com\tTRUE\t/\tTRUE\tsoon\ta\tb', ctx), 'bad_line');
  bad(parseImport('just some words', ctx), 'bad_line');
  bad(parseImport('# only comments\n', ctx), 'no_cookies');
});

test('Cookie-Editor / EditThisCookie shaped array', () => {
  const arr = [
    { domain: '.example.com', expirationDate: SEC + 5000, hostOnly: false, httpOnly: true, name: 'a', path: '/', sameSite: 'no_restriction', secure: true, session: false, storeId: '0', value: 'x', id: 1, firstPartyDomain: '' },
    { domain: 'example.com', name: 'b', path: '/', sameSite: null, secure: false, httpOnly: false, value: 'y', storeId: null },
    { domain: '.example.com', name: 'c', path: '/', sameSite: 'Lax', value: 'z', expirationDate: SEC + 5000 },
    { domain: '.example.com', name: 'd', path: '/', sameSite: 'None', secure: true, value: 'z', session: true },
    { domain: '.example.com', name: 'e', path: '/', sameSite: 'STRICT', value: '' },
  ];
  const r = parseImport(JSON.stringify(arr), ctx);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.source, 'array');
  assert.deepEqual(r.drafts.map((d) => d.sameSite), ['no_restriction', 'unspecified', 'lax', 'no_restriction', 'strict']);
  assert.equal(r.drafts[1].hostOnly, true);
  assert.equal(r.drafts[1].session, true);
  assert.equal(r.drafts[0].hostOnly, false);
  assert.equal(r.drafts[2].hostOnly, false);
  assert.equal(r.drafts[2].session, false);
  for (const d of r.drafts) {
    assert.ok(!('id' in d) && !('storeId' in d) && !('firstPartyDomain' in d));
  }
});

test('hostOnly absent is derived from the leading dot; domain cookies get the dot', () => {
  const r = parseImport(JSON.stringify([
    { name: 'a', value: '1', domain: 'example.com', path: '/' },
    { name: 'b', value: '1', domain: '.example.com', path: '/' },
    { name: 'c', value: '1', domain: 'example.com', hostOnly: false, path: '/' },
  ]), ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.drafts.map((d) => [d.hostOnly, d.domain]), [[true, 'example.com'], [false, '.example.com'], [false, '.example.com']]);
});

test('explicit hostOnly with a leading dot is rejected', () => {
  bad(parseImport(JSON.stringify([{ name: 'a', value: '1', domain: '.example.com', hostOnly: true, path: '/' }]), ctx), 'domain_leading_dot');
});

test('warnings: expired and other-site entries are returned, not fatal', () => {
  const r = parseImport(JSON.stringify([
    { name: 'old', value: '1', domain: 'example.com', path: '/', session: false, expirationDate: SEC - 10 },
    { name: 'far', value: '1', domain: 'other.test', path: '/' },
  ]), { now: NOW, pageSite: 'example.com' });
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /^Entry 1 \("old"\): Saving with an expiry in the past deletes this cookie\.$/);
  assert.match(r.warnings[1], /^Entry 2 \("far"\)/);
});

test('validation failure rejects everything with entry, name and rule', () => {
  const good = { name: 'ok', value: '1', domain: 'example.com', path: '/' };
  const r = parseImport(JSON.stringify([good, good && { ...good, name: 'a' }, { ...good, name: 'sid', sameSite: 'no_restriction' }]), ctx);
  const e = bad(r, 'samesite_none_insecure');
  assert.equal(r.drafts, undefined);
  assert.equal(e.index, 2);
  assert.match(e.message, /^Entry 3 \("sid"\): SameSite=None cookies must be Secure/);
});

test('public suffix hook is passed through', () => {
  const t = JSON.stringify([{ name: 'a', value: '1', domain: '.com', path: '/' }]);
  assert.equal(parseImport(t, ctx).ok, true);
  bad(parseImport(t, { now: NOW, isPublicSuffix: (d) => d === 'com' }), 'domain_public_suffix');
});

test('duplicate keys are rejected; same name on different path/partition is fine', () => {
  const a = { name: 'a', value: '1', domain: 'example.com', path: '/' };
  const e = bad(parseImport(JSON.stringify([a, { ...a, value: '2' }]), ctx), 'duplicate');
  assert.equal(e.index, 1);
  assert.equal(parseImport(JSON.stringify([a, { ...a, path: '/x' }, { ...a, domain: '.example.com' }]), ctx).ok, true);
  const p = { ...a, secure: true, partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false } };
  assert.equal(parseImport(JSON.stringify([a, p]), ctx).ok, true);
  bad(parseImport(JSON.stringify([p, { ...p }]), ctx), 'duplicate');
  bad(parseImport('example.com\tFALSE\t/\tFALSE\t0\ta\t1\nexample.com\tFALSE\t/\tFALSE\t0\ta\t2', ctx), 'duplicate');
});

// ---------------- hostile input ----------------

test('hostile: not JSON / primitives / wrong envelope', () => {
  bad(parseImport('{"cookies": [', ctx), 'bad_json');
  bad(parseImport('[1,2', ctx), 'bad_json');
  bad(parseImport('', ctx), 'no_cookies');
  bad(parseImport('   ', ctx), 'no_cookies');
  bad(parseImport(undefined, ctx), 'not_text');
  bad(parseImport(null, ctx), 'not_text');
  bad(parseImport({ cookies: [] }, ctx), 'not_text');
  bad(parseImport('42', ctx), 'bad_line');
  bad(parseImport('"str"', ctx));
  bad(parseImport('null', ctx));
  bad(parseImport('{}', ctx), 'unknown_format');
  bad(parseImport('{"format":"other","cookies":[]}', ctx), 'unknown_format');
  bad(parseImport('{"format":"cookiedesk","version":2,"cookies":[]}', ctx), 'bad_version');
  bad(parseImport('{"format":"cookiedesk","version":1,"cookies":{}}', ctx), 'bad_envelope');
  bad(parseImport('[]', ctx), 'no_cookies');
});

test('hostile: deeply nested arrays do not throw', () => {
  const deep = '['.repeat(200_000) + ']'.repeat(200_000);
  const r = parseImport(deep, ctx);
  assert.equal(r.ok, false);
  const wide = '[' + '[],'.repeat(100_000) + '[]]';
  assert.equal(parseImport(wide, { now: NOW, maxCookies: 50 }).ok, false);
});

test('hostile: size and count limits', () => {
  const big = JSON.stringify([{ name: 'a', value: 'x'.repeat(2000), domain: 'example.com', path: '/' }]);
  bad(parseImport(big, { now: NOW, maxBytes: 1000 }), 'too_large');
  // multibyte: 600 chars but > 1000 bytes
  bad(parseImport('€'.repeat(600), { now: NOW, maxBytes: 1000 }), 'too_large');
  assert.equal(parseImport(big, { now: NOW, maxBytes: 100_000 }).ok, true);
  const many = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: 'n' + i, value: '1', domain: 'example.com', path: '/' })));
  bad(parseImport(many(6), { now: NOW, maxCookies: 5 }), 'too_many');
  assert.equal(parseImport(many(5), { now: NOW, maxCookies: 5 }).ok, true);
  assert.equal(parseImport(many(10), ctx).ok, true);
  bad(parseImport(many(5001), ctx), 'too_many');
});

test('hostile: entries that are not objects', () => {
  const g = { name: 'a', value: '1', domain: 'example.com', path: '/' };
  for (const x of [null, [], 'str', 7, true]) {
    const e = bad(parseImport(JSON.stringify([g, x]), ctx), 'bad_entry');
    assert.equal(e.index, 1);
    assert.match(e.message, /^Entry 2 /);
  }
});

test('hostile: wrong types', () => {
  const g = { name: 'a', value: '1', domain: 'example.com', path: '/' };
  const cases = [
    { name: 5 }, { name: undefined }, { value: 5 }, { value: null }, { domain: ['example.com'] }, { path: 1 },
    { secure: 'true' }, { secure: 1 }, { httpOnly: 'yes' }, { hostOnly: 0 }, { session: 'no' },
    { expirationDate: '123' }, { expirationDate: {} }, { expirationDate: true },
  ];
  for (const c of cases) {
    const r = parseImport(JSON.stringify([{ ...g, ...c }]), ctx);
    assert.equal(r.ok, false, JSON.stringify(c));
  }
  // JSON cannot carry NaN/Infinity, but 1e999 parses to Infinity
  bad(parseImport('[{"name":"a","value":"1","domain":"example.com","path":"/","expirationDate":1e999}]', ctx));
});

test('hostile: unknown sameSite and bad partitionKey', () => {
  const g = { name: 'a', value: '1', domain: 'example.com', path: '/', secure: true };
  bad(parseImport(JSON.stringify([{ ...g, sameSite: 'bogus' }]), ctx), 'bad_samesite');
  bad(parseImport(JSON.stringify([{ ...g, sameSite: 3 }]), ctx), 'bad_samesite');
  bad(parseImport(JSON.stringify([{ ...g, sameSite: true }]), ctx), 'bad_samesite');
  bad(parseImport(JSON.stringify([{ ...g, partitionKey: 'https://example.com' }]), ctx), 'bad_partition_key');
  bad(parseImport(JSON.stringify([{ ...g, partitionKey: [] }]), ctx), 'bad_partition_key');
  bad(parseImport(JSON.stringify([{ ...g, partitionKey: {} }]), ctx), 'bad_partition_key');
  bad(parseImport(JSON.stringify([{ ...g, partitionKey: { topLevelSite: 1 } }]), ctx), 'bad_partition_key');
  bad(parseImport(JSON.stringify([{ ...g, partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: 'x' } }]), ctx), 'bad_partition_key');
  bad(parseImport(JSON.stringify([{ ...g, partitionKey: { topLevelSite: 'http://example.com' } }]), ctx), 'partition_site');
  assert.equal(parseImport(JSON.stringify([{ ...g, partitionKey: null }]), ctx).ok, true);
});

test('hostile: __proto__ / constructor / prototype keys are ignored and nothing is polluted', () => {
  const text = '[{"name":"a","value":"1","domain":"example.com","path":"/",' +
    '"__proto__":{"polluted":1,"secure":true},"constructor":{"prototype":{"polluted":2}},"prototype":{"polluted":3},' +
    '"partitionKey":null}]';
  const r = parseImport(text, ctx);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const d = r.drafts[0];
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(d.polluted, undefined);
  assert.equal(d.secure, false);
  assert.equal(Object.getPrototypeOf(d), Object.prototype);
  assert.deepEqual(Object.keys(d).sort(), ['domain', 'hostOnly', 'httpOnly', 'name', 'path', 'secure', 'sameSite', 'session', 'value'].sort());

  // entry that is itself only a __proto__ key
  const r2 = parseImport('[{"__proto__":{"polluted":1}}]', ctx);
  bad(r2, 'bad_type');
  assert.equal(({}).polluted, undefined);

  // envelope with __proto__ and inherited-looking fields
  const r3 = parseImport('{"__proto__":{"format":"cookiedesk"},"cookies":[]}', ctx);
  bad(r3, 'unknown_format');
  // partitionKey with __proto__
  const r4 = parseImport('[{"name":"a","value":"1","domain":"example.com","path":"/","secure":true,"partitionKey":{"topLevelSite":"https://example.com","__proto__":{"x":1}}}]', ctx);
  assert.equal(r4.ok, true);
  assert.deepEqual(Object.keys(r4.drafts[0].partitionKey), ['topLevelSite']);
});

test('hostile: one bad entry among good ones rejects everything', () => {
  const g = (n) => ({ name: n, value: '1', domain: 'example.com', path: '/' });
  const r = parseImport(JSON.stringify([g('a'), g('b'), { ...g('c'), path: 'nope' }, g('d')]), ctx);
  const e = bad(r, 'path_slash');
  assert.equal(e.index, 2);
  assert.ok(!('drafts' in r) && !('domains' in r));
  assert.match(e.message, /^Entry 3 \("c"\): /);
});

test('hostile: huge entry name is truncated in messages', () => {
  const r = parseImport(JSON.stringify([{ name: 'n'.repeat(10000), value: '1', domain: 'example.com', path: 'x' }]), ctx);
  assert.equal(r.ok, false);
  assert.ok(r.error.message.length < 300);
});

test('no error or warning message contains the cookie value', () => {
  const secret = 'TOPSECRETVALUE123';
  const cases = [
    [{ name: 'a', value: secret, domain: 'example.com', path: 'bad' }],
    [{ name: 'a', value: secret, domain: 'example.com', path: '/', sameSite: 'no_restriction' }],
    [{ name: 'a', value: secret + ';', domain: 'example.com', path: '/' }],
    [{ name: 'a', value: secret + 'x'.repeat(5000), domain: 'example.com', path: '/' }],
    [{ name: 'a', value: secret, domain: 'example.com', path: '/', secure: 'yes' }],
    [{ name: 'a', value: secret, domain: 'example.com', path: '/', partitionKey: secret }],
    [{ name: 'a', value: secret, domain: 'example.com', path: '/', sameSite: secret }],
    [{ name: 'a', value: secret, domain: 'example.com', path: '/', expirationDate: secret }],
    [{ name: 'a', value: secret, domain: 'example.com', path: '/' }, { name: 'a', value: secret, domain: 'example.com', path: '/' }],
    [{ name: 'a', value: secret, domain: 'other.test', path: '/', session: false, expirationDate: 1 }],
    [{ name: 'a', value: secret, domain: 'example.com', path: '/' }, 'x'],
  ];
  let sawWarning = false;
  for (const c of cases) {
    const r = parseImport(JSON.stringify(c), { now: NOW, pageSite: 'example.com' });
    const msgs = r.ok ? r.warnings : [r.error.message];
    if (r.ok) sawWarning = sawWarning || msgs.length > 0;
    for (const m of msgs) assert.ok(!m.includes(secret), m);
  }
  assert.ok(sawWarning);
  const nets = ['example.com\tFALSE\t/\tFALSE\tx\ta\t' + secret, 'example.com\tFALSE\t/\tMAYBE\t0\ta\t' + secret];
  for (const n of nets) assert.ok(!parseImport(n, ctx).error.message.includes(secret));
  assert.ok(!parseImport('{"x":"' + secret + '"', ctx).error.message.includes(secret));
});

test('P1-3: a named set round-trips its label; site and set come back as display-only meta', () => {
  const text = exportJson(full, { site: 'example.com', storeId: '0', now: NOW, setName: 'admin' });
  assert.equal(JSON.parse(text).set, 'admin');
  const r = parseImport(text, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.meta, { site: 'example.com', set: 'admin', exportedAt: new Date(NOW).toISOString() });
  assert.equal(JSON.parse(exportJson(full, { site: 'x', now: NOW })).set, undefined);
  // Non-string or huge labels are dropped, not trusted.
  const odd = JSON.parse(text);
  odd.set = { toString: 'x' };
  odd.site = 'y'.repeat(500);
  assert.deepEqual(parseImport(JSON.stringify(odd), ctx).meta, { exportedAt: new Date(NOW).toISOString() });
  assert.deepEqual(parseImport(JSON.stringify([stripStore(ck())]), ctx).meta, {});
});

test('P1-6: document.cookie snippet sets every attribute, leaves HttpOnly out by name', () => {
  const { text, skipped } = exportDocumentCookie([
    ck({ httpOnly: false, name: 'a', value: 'x"y\\z', hostOnly: true, domain: 'www.example.com', expirationDate: SEC + 60 }),
    ck({ httpOnly: false, name: 'b', session: true, expirationDate: undefined, sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://example.com' } }),
    ck({ httpOnly: false, name: 'c', secure: false, sameSite: 'unspecified', path: '/app' }),
    ck({ name: 'secret_session' }),
  ], { site: 'example.com' });
  assert.deepEqual(skipped, ['secret_session']);
  const lines = text.trim().split('\n');
  assert.match(lines[0], /for example\.com/);
  assert.match(text, /treat it like a password/);
  assert.match(text, /Left out \(HttpOnly.*\): "secret_session"/);
  assert.ok(!/secret_session=/.test(text), 'the HttpOnly cookie is not set by the snippet');
  const stmts = lines.filter((l) => l.startsWith('document.cookie'));
  assert.equal(stmts.length, 3);
  // Each statement is valid JavaScript whose string is the cookie we meant.
  const set = [];
  for (const l of stmts) new Function('document', l)({ set cookie(v) { set.push(v); } });
  assert.equal(set[0], `a=x"y\\z; Path=/; Expires=${new Date((SEC + 60) * 1000).toUTCString()}; Secure; SameSite=Lax`);
  assert.equal(set[1], 'b=v1; Path=/; Domain=example.com; Secure; SameSite=None; Partitioned');
  assert.equal(set[2], `c=v1; Path=/app; Domain=example.com; Expires=${new Date((SEC + 1000.123456) * 1000).toUTCString()}`);
});

test('P1-6: hostile cookie names cannot escape the snippet (U+2028/U+2029 end a // comment)', () => {
  const evil = 'x\u2028globalThis.pwned=1//';
  const { text } = exportDocumentCookie([
    ck({ name: evil }), // HttpOnly: named in the comment
    ck({ httpOnly: false, name: 'y\u2029globalThis.pwned=2//', value: 'v\u2028w' }),
  ], { site: 'example.com' });
  assert.ok(!/[\u2028\u2029]/.test(text), 'no raw line separators anywhere');
  globalThis.pwned = 0;
  const set = [];
  new Function('document', text)({ set cookie(v) { set.push(v); } });
  assert.equal(globalThis.pwned, 0, 'nothing injected ran');
  assert.equal(set.length, 1);
  assert.ok(set[0].startsWith('y\u2029globalThis.pwned=2//=v\u2028w;'), 'the cookie itself is set exactly');
  delete globalThis.pwned;
});

test('domains differing only in case are the same cookie (Chrome lowercases them)', () => {
  const r = parseImport(JSON.stringify([stripStore(ck({ domain: '.Example.com' })), stripStore(ck())]), ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'duplicate');
});
