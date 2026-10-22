import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCookie, utf8Bytes, SAME_SITE_VALUES } from '../../src/core/validate.js';

const NOW = 1_700_000_000_000;
const base = (o = {}) => ({
  name: 'sid', value: 'abc', domain: 'example.com', hostOnly: true, path: '/', secure: false,
  httpOnly: false, sameSite: 'lax', session: true, ...o,
});
const codes = (r) => r.errors.map((e) => e.code);
const wcodes = (r) => r.warnings.map((e) => e.code);
const v = (o, ctx = { now: NOW }) => validateCookie(base(o), ctx);

test('clean cookie has no issues', () => {
  const r = v();
  assert.deepEqual(r, { errors: [], warnings: [] });
});

test('constants and utf8Bytes', () => {
  assert.deepEqual(SAME_SITE_VALUES, ['no_restriction', 'lax', 'strict', 'unspecified']);
  assert.equal(utf8Bytes('abc'), 3);
  assert.equal(utf8Bytes('é'), 2);
  assert.equal(utf8Bytes('€'), 3);
  assert.equal(utf8Bytes('😀'), 4);
});

test('non-object draft', () => {
  for (const d of [null, undefined, 'x', [], 5]) assert.deepEqual(codes(validateCookie(d)), ['bad_draft']);
});

test('SameSite=None requires Secure', () => {
  assert.deepEqual(codes(v({ sameSite: 'no_restriction' })), ['samesite_none_insecure']);
  assert.deepEqual(codes(v({ sameSite: 'no_restriction', secure: true })), []);
  assert.match(v({ sameSite: 'no_restriction' }).errors[0].message, /must be Secure/);
});

test('Partitioned requires Secure', () => {
  const pk = { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false };
  assert.deepEqual(codes(v({ partitionKey: pk })), ['partitioned_insecure']);
  assert.deepEqual(codes(v({ partitionKey: pk, secure: true })), []);
  assert.deepEqual(codes(v({ partitionKey: null })), []);
});

test('__Secure- and __Host- prefixes', () => {
  assert.deepEqual(codes(v({ name: '__Secure-a' })), ['prefix_secure']);
  assert.deepEqual(codes(v({ name: '__secure-a' })), ['prefix_secure']);
  assert.deepEqual(codes(v({ name: '__Secure-a', secure: true })), []);
  assert.deepEqual(codes(v({ name: '__Host-a', secure: true })), []);
  assert.deepEqual(codes(v({ name: '__Host-a' })), ['prefix_secure']);
  assert.deepEqual(codes(v({ name: '__Host-a', secure: true, hostOnly: false, domain: '.example.com' })), ['host_prefix_domain']);
  assert.deepEqual(codes(v({ name: '__Host-a', secure: true, path: '/x' })), ['host_prefix_path']);
});

test('name+value size boundary is 4096 UTF-8 bytes', () => {
  assert.deepEqual(codes(v({ name: 'a', value: 'x'.repeat(4095) })), []);
  assert.deepEqual(codes(v({ name: 'a', value: 'x'.repeat(4096) })), ['too_large']);
  // 2-byte chars: 2047*2 + 1 + 1 = 4096 ok; one more char is 4098
  assert.deepEqual(codes(v({ name: 'a', value: 'é'.repeat(2047) + 'x' })), []);
  assert.deepEqual(codes(v({ name: 'a', value: 'é'.repeat(2048) })), ['too_large']);
  // 4-byte emoji: 1023*4 + 4 = 4096 ok (name 'a' + 1023 emoji + 3 x = 4096)
  assert.deepEqual(codes(v({ name: 'a', value: '😀'.repeat(1023) + 'xx' + 'x' })), []);
  assert.deepEqual(codes(v({ name: 'a', value: '😀'.repeat(1024) })), ['too_large']);
  assert.equal(v({ name: 'a', value: 'x'.repeat(4096) }).errors[0].field, 'value');
});

test('forbidden characters', () => {
  assert.ok(codes(v({ name: 'a\nb' })).includes('bad_chars_name'));
  assert.ok(codes(v({ name: 'a\0' })).includes('bad_chars_name'));
  assert.ok(codes(v({ name: 'a;b' })).includes('bad_chars_name'));
  assert.ok(codes(v({ name: 'a=b' })).includes('name_has_equals'));
  assert.ok(codes(v({ value: 'a\r\nb' })).includes('bad_chars_value'));
  assert.ok(codes(v({ value: 'a;b' })).includes('bad_chars_value'));
  assert.ok(codes(v({ value: 'a=b' })).length === 0); // = is fine in values
  assert.ok(codes(v({ path: '/a;b' })).includes('bad_chars_path'));
});

test('empty name and value', () => {
  assert.deepEqual(codes(v({ name: '', value: '' })), ['empty_cookie']);
  const r = v({ name: '', value: 'x' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(wcodes(r), ['empty_name']);
  assert.deepEqual(codes(v({ name: 'x', value: '' })), []);
});

test('path rules', () => {
  assert.deepEqual(codes(v({ path: 'x' })), ['path_slash']);
  assert.deepEqual(codes(v({ path: '' })), ['path_slash']);
  assert.deepEqual(codes(v({ path: '/' + 'a'.repeat(1023) })), []);
  assert.deepEqual(codes(v({ path: '/' + 'a'.repeat(1024) })), ['path_too_long']);
  assert.deepEqual(codes(v({ path: '/' + 'é'.repeat(512) })), ['path_too_long']); // 1025 bytes
});

test('domain rules', () => {
  assert.deepEqual(codes(v({ domain: '' })), ['domain_empty']);
  assert.deepEqual(codes(v({ domain: '.' })), ['domain_empty']);
  assert.deepEqual(codes(v({ domain: 'exa mple.com' })), ['domain_invalid']);
  assert.deepEqual(codes(v({ domain: 'a..com' })), ['domain_invalid']);
  assert.deepEqual(codes(v({ domain: 'example.com.' })), ['domain_invalid']);
  assert.deepEqual(codes(v({ domain: '-a.com' })), ['domain_invalid']);
  assert.deepEqual(codes(v({ domain: 'bücher.de' })), ['domain_invalid']);
  assert.deepEqual(codes(v({ domain: 'a'.repeat(64) + '.com' })), ['domain_invalid']);
  assert.deepEqual(codes(v({ domain: ('a'.repeat(60) + '.').repeat(20) + 'com' })), ['domain_too_long']);
  for (const ok of ['localhost', '127.0.0.1', 'a-b.example.co.uk', 'xn--bcher-kva.de', '_dmarc.example.com', '::1']) {
    assert.deepEqual(codes(v({ domain: ok })), [], ok);
  }
  assert.deepEqual(codes(v({ domain: '999.1.1.1' })), ['domain_invalid']);
  assert.deepEqual(codes(v({ domain: '.example.com', hostOnly: false })), []);
  assert.deepEqual(codes(v({ domain: '.example.com', hostOnly: true })), ['domain_leading_dot']);
});

test('public suffix only blocks Domain= cookies and only when a hook is supplied', () => {
  const ctx = { now: NOW, isPublicSuffix: (d) => d === 'com' || d === 'co.uk' };
  assert.deepEqual(codes(v({ domain: '.com', hostOnly: false }, ctx)), ['domain_public_suffix']);
  assert.deepEqual(codes(v({ domain: 'co.uk', hostOnly: false }, ctx)), ['domain_public_suffix']);
  assert.deepEqual(codes(v({ domain: '.example.com', hostOnly: false }, ctx)), []);
  assert.deepEqual(codes(v({ domain: 'com', hostOnly: true }, ctx)), []);
  assert.deepEqual(codes(v({ domain: '.com', hostOnly: false })), []);
});

test('partition key rules', () => {
  const p = (partitionKey, o = {}) => v({ secure: true, partitionKey, ...o });
  assert.deepEqual(codes(p('https://example.com')), ['partition_type']);
  assert.deepEqual(codes(p([])), ['partition_type']);
  assert.deepEqual(codes(p({})), ['partition_site']);
  assert.deepEqual(codes(p({ topLevelSite: 5 })), ['partition_site']);
  assert.deepEqual(codes(p({ topLevelSite: 'http://example.com' })), ['partition_site']);
  assert.deepEqual(codes(p({ topLevelSite: 'example.com' })), ['partition_site']);
  assert.deepEqual(codes(p({ topLevelSite: 'https://example.com/path' })), ['partition_site']);
  assert.deepEqual(codes(p({ topLevelSite: 'https://example.com' })), []);
  assert.deepEqual(codes(p({ topLevelSite: 'https://example.com', hasCrossSiteAncestor: 'no' })), ['flag_type']);
  // same-site, either direction, with or without leading dot
  assert.deepEqual(codes(p({ topLevelSite: 'https://example.com', hasCrossSiteAncestor: false }, { domain: 'sub.example.com' })), []);
  assert.deepEqual(codes(p({ topLevelSite: 'https://example.com', hasCrossSiteAncestor: false }, { domain: '.example.com', hostOnly: false })), []);
  assert.deepEqual(codes(p({ topLevelSite: 'https://www.example.com', hasCrossSiteAncestor: false }, { domain: '.example.com', hostOnly: false })), []);
  // cross-site: false is an error, true is fine
  const cross = { domain: 'other.test' };
  assert.deepEqual(codes(p({ topLevelSite: 'https://example.com', hasCrossSiteAncestor: false }, cross)), ['partition_cross_site']);
  assert.deepEqual(codes(p({ topLevelSite: 'https://example.com', hasCrossSiteAncestor: true }, cross)), []);
  assert.deepEqual(codes(p({ topLevelSite: 'https://example.com' }, cross)), []);
  // suffix match must be on a label boundary
  assert.deepEqual(codes(p({ topLevelSite: 'https://example.com', hasCrossSiteAncestor: false }, { domain: 'notexample.com' })), ['partition_cross_site']);
});

test('sameSite validation', () => {
  for (const s of SAME_SITE_VALUES) assert.deepEqual(codes(v({ sameSite: s, secure: true })), []);
  for (const s of ['None', 'LAX', 'bogus', null, 3]) assert.deepEqual(codes(v({ sameSite: s })), ['bad_samesite']);
});

test('non-boolean flags and non-string fields', () => {
  for (const k of ['secure', 'httpOnly', 'hostOnly', 'session']) {
    for (const bad of ['true', 1, null]) assert.deepEqual(codes(v({ [k]: bad })), ['flag_type'], `${k}=${bad}`);
  }
  assert.ok(codes(v({ name: 5 })).includes('name_type'));
  assert.ok(codes(v({ value: null })).includes('value_type'));
  assert.ok(codes(v({ domain: {} })).includes('domain_type'));
  assert.ok(codes(v({ path: 1 })).includes('path_type'));
});

test('expiration rules and warnings', () => {
  const sec = NOW / 1000;
  const e = (x, o = {}) => v({ session: false, expirationDate: x, ...o });
  for (const bad of [NaN, Infinity, -Infinity, '123', {}]) assert.deepEqual(codes(e(bad)), ['bad_expiration']);
  assert.deepEqual(codes(v({ session: false })), ['expiration_missing']);
  assert.deepEqual(codes(e(sec + 3600)), []);
  assert.deepEqual(wcodes(e(sec + 3600)), []);
  assert.deepEqual(wcodes(e(sec - 1)), ['expired_deletes']);
  assert.deepEqual(wcodes(e(sec)), ['expired_deletes']);
  assert.equal(e(sec - 1).warnings[0].message, 'Saving with an expiry in the past deletes this cookie.');
  assert.deepEqual(wcodes(e(sec + 400 * 86400)), []);
  assert.deepEqual(wcodes(e(sec + 400 * 86400 + 1)), ['clamped_400d']);
  assert.deepEqual(wcodes(e(sec + 3600.123456)), []); // fractional ok
  // session cookies ignore a stray expirationDate
  assert.deepEqual(validateCookie(base({ session: true, expirationDate: 1 }), { now: NOW }), { errors: [], warnings: [] });
});

test('other_site warning follows ctx.pageSite', () => {
  const ctx = { now: NOW, pageSite: 'example.com' };
  assert.deepEqual(wcodes(v({ domain: 'example.com' }, ctx)), []);
  assert.deepEqual(wcodes(v({ domain: '.example.com', hostOnly: false }, ctx)), []);
  assert.deepEqual(wcodes(v({ domain: 'a.example.com' }, ctx)), []);
  assert.deepEqual(wcodes(v({ domain: 'evil-example.com' }, ctx)), ['other_site']);
  assert.deepEqual(wcodes(v({ domain: 'other.test' }, ctx)), ['other_site']);
  assert.deepEqual(wcodes(v({ domain: 'other.test' })), []);
});

test('issues have the contract shape and never contain the value', () => {
  const secret = 'S3CR3T-VALUE-xyz';
  const bad = {
    name: '__Host-a=b', value: secret + ';\n' + 'x'.repeat(5000), domain: '.com', hostOnly: false, path: 'x',
    secure: false, sameSite: 'no_restriction', session: false, expirationDate: 1,
    partitionKey: { topLevelSite: 'http://nope' },
  };
  const r = validateCookie(bad, { now: NOW, isPublicSuffix: () => true, pageSite: 'example.org' });
  assert.ok(r.errors.length >= 6);
  for (const i of [...r.errors, ...r.warnings]) {
    assert.equal(typeof i.code, 'string');
    assert.equal(typeof i.message, 'string');
    assert.ok(i.field === null || typeof i.field === 'string');
    assert.ok(!i.message.includes(secret));
  }
});
