import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cookieKey, partitionId, cookieUrl, toSetDetails, toExpireDetails, toExactFilter, sameCookie, snapshot, sortCookies,
} from '../../src/core/model.js';
import {
  chromeMajorFromUA, features, isPartitioned, isSameSite, normalizePartitionKey, partitionLabel, siteQueries,
} from '../../src/core/partition.js';

const base = { name: 'sid', value: 'v', domain: 'a.test', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true, storeId: '0' };

test('cookieKey distinguishes every identity field and only those', () => {
  const k = cookieKey(base);
  assert.notEqual(cookieKey({ ...base, name: 'x' }), k);
  assert.notEqual(cookieKey({ ...base, path: '/x' }), k);
  assert.notEqual(cookieKey({ ...base, domain: '.a.test' }), k);
  assert.notEqual(cookieKey({ ...base, storeId: '1' }), k);
  assert.notEqual(cookieKey({ ...base, partitionKey: { topLevelSite: 'https://a.test', hasCrossSiteAncestor: false } }), k);
  assert.equal(cookieKey({ ...base, value: 'other', httpOnly: false }), k);
  assert.equal(cookieKey({ ...base, domain: 'A.TEST' }), k);
});

test('partitionId: empty for unpartitioned, separates hasCrossSiteAncestor', () => {
  assert.equal(partitionId(undefined), '');
  assert.equal(partitionId({}), '');
  assert.notEqual(partitionId({ topLevelSite: 'https://a.test', hasCrossSiteAncestor: true }), partitionId({ topLevelSite: 'https://a.test', hasCrossSiteAncestor: false }));
});

test('cookieUrl: scheme follows secure, host from domain, cookie path, IPv6 bracketed', () => {
  assert.equal(cookieUrl(base), 'https://a.test/');
  assert.equal(cookieUrl({ ...base, secure: false, domain: '.a.test', path: '/x y' }), 'http://a.test/x%20y');
  assert.equal(cookieUrl({ ...base, domain: '::1' }), 'https://[::1]/');
  assert.equal(cookieUrl({ ...base, domain: '127.0.0.1' }), 'https://127.0.0.1/');
});

test('toSetDetails: host-only omits domain, session omits expiry, keeps partition and flags', () => {
  const d = toSetDetails(base);
  assert.equal(d.domain, undefined);
  assert.equal(d.expirationDate, undefined);
  assert.deepEqual([d.secure, d.httpOnly, d.sameSite, d.storeId], [true, true, 'lax', '0']);
  const pk = { topLevelSite: 'https://a.test', hasCrossSiteAncestor: false };
  const d2 = toSetDetails({ ...base, hostOnly: false, domain: '.a.test', session: false, expirationDate: 1900000000.5, partitionKey: pk });
  assert.equal(d2.domain, '.a.test');
  assert.equal(d2.expirationDate, 1900000000.5);
  assert.deepEqual(d2.partitionKey, pk);
  assert.notEqual(d2.partitionKey, pk, 'copied, not aliased');
});

test('toExpireDetails targets the exact key with an expiry in the past', () => {
  const d = toExpireDetails({ ...base, session: false, expirationDate: 1900000000 });
  assert.equal(d.expirationDate, 1);
  assert.equal(d.name, 'sid');
  assert.equal(d.domain, undefined);
});

test('toExactFilter strips the leading dot and carries store + partition', () => {
  assert.deepEqual(toExactFilter({ ...base, domain: '.a.test', partitionKey: { topLevelSite: 'https://a.test' } }), { name: 'sid', domain: 'a.test', path: '/', storeId: '0', partitionKey: { topLevelSite: 'https://a.test' } });
});

test('sameCookie compares every stored field; snapshot copies them', () => {
  const s = snapshot({ ...base, extra: 'ignored' });
  assert.equal(s.extra, undefined);
  assert.ok(sameCookie(s, base));
  assert.ok(!sameCookie({ ...base, value: 'x' }, base));
  assert.ok(!sameCookie({ ...base, partitionKey: { topLevelSite: 'https://a.test' } }, base));
  assert.ok(!sameCookie(null, base));
});

test('sortCookies: by domain, name, path, unpartitioned first', () => {
  const list = sortCookies([
    { ...base, name: 'b' },
    { ...base, name: 'a', partitionKey: { topLevelSite: 'https://a.test' } },
    { ...base, name: 'a' },
    { ...base, name: 'a', domain: '.0.test' },
  ]);
  assert.deepEqual(list.map((c) => `${c.domain}:${c.name}:${partitionId(c.partitionKey) ? 'P' : ''}`), ['.0.test:a:', 'a.test:a:', 'a.test:a:P', 'a.test:b:']);
});

test('chromeMajorFromUA and features gate each partition API by version', () => {
  assert.equal(chromeMajorFromUA('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36'), 150);
  assert.equal(chromeMajorFromUA('Firefox/120'), null);
  assert.equal(chromeMajorFromUA('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 HeadlessChrome/119.0.6045.105 Safari/537.36'), 119);
  assert.deepEqual(features({ chromeMajor: 118, hasGetPartitionKey: false }), { partitionKey: false, hasCrossSiteAncestor: false, getPartitionKey: false });
  assert.deepEqual(features({ chromeMajor: 125, hasGetPartitionKey: false }), { partitionKey: true, hasCrossSiteAncestor: false, getPartitionKey: false });
  assert.deepEqual(features({ chromeMajor: 131, hasGetPartitionKey: false }), { partitionKey: true, hasCrossSiteAncestor: true, getPartitionKey: false });
  assert.deepEqual(features({ chromeMajor: 150, hasGetPartitionKey: true }), { partitionKey: true, hasCrossSiteAncestor: true, getPartitionKey: true });
  assert.equal(features({ chromeMajor: null, hasGetPartitionKey: true }).partitionKey, true);
});

test('normalizePartitionKey fills hasCrossSiteAncestor the way Chrome does', () => {
  const all = { partitionKey: true, hasCrossSiteAncestor: true };
  assert.deepEqual(normalizePartitionKey({ topLevelSite: 'https://a.test' }, 'a.test', all), { topLevelSite: 'https://a.test', hasCrossSiteAncestor: false });
  assert.deepEqual(normalizePartitionKey({ topLevelSite: 'https://a.test' }, 'b.test', all), { topLevelSite: 'https://a.test', hasCrossSiteAncestor: true });
  assert.deepEqual(normalizePartitionKey({ topLevelSite: 'https://a.test', hasCrossSiteAncestor: true }, 'a.test', all), { topLevelSite: 'https://a.test', hasCrossSiteAncestor: true });
  assert.deepEqual(normalizePartitionKey({ topLevelSite: 'https://a.test', hasCrossSiteAncestor: true }, 'a.test', { partitionKey: true, hasCrossSiteAncestor: false }), { topLevelSite: 'https://a.test' });
  assert.equal(normalizePartitionKey(undefined, 'a.test', all), undefined);
  assert.equal(normalizePartitionKey({}, 'a.test', all), undefined);
});

test('isSameSite / isPartitioned / partitionLabel', () => {
  assert.ok(isSameSite('.www.a.test', 'https://a.test'));
  assert.ok(!isSameSite('b.test', 'https://a.test'));
  assert.ok(!isSameSite('a.test', 'not a url'));
  assert.ok(isPartitioned({ partitionKey: { topLevelSite: 'https://a.test' } }));
  assert.ok(!isPartitioned({}));
  assert.equal(partitionLabel({ topLevelSite: 'https://a.test', hasCrossSiteAncestor: false }, 'a.test'), 'Partitioned under this site');
  assert.equal(partitionLabel({ topLevelSite: 'https://a.test', hasCrossSiteAncestor: true }, 'b.test'), 'Partitioned under a.test, cross-site context');
  assert.equal(partitionLabel(undefined), '');
});

test('siteQueries: both partitions when supported, unpartitioned only on old Chrome', () => {
  assert.deepEqual(siteQueries('a.test', { partitionKey: false }, '0'), [{ storeId: '0', domain: 'a.test' }]);
  const q = siteQueries('a.test', { partitionKey: true });
  assert.deepEqual(q[0], { domain: 'a.test', partitionKey: {} });
  assert.ok(q.some((f) => f.partitionKey?.topLevelSite === 'https://a.test'));
});
