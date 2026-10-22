import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCookies, formatExpiry, byteCount, truncate, countSummary, formFromCookie, draftFromForm,
  toDatetimeLocal, fromDatetimeLocal, rowSignature, sameSiteLabel, storeLabel, exportFilename, defaultExpiry,
} from '../../src/ui/view.js';

const c = (o) => ({ name: 'n', value: 'v', domain: 'a.test', hostOnly: true, path: '/', secure: true, httpOnly: false, sameSite: 'lax', session: true, storeId: '0', ...o });

test('filterCookies: case-insensitive over name, value and domain; blank query keeps all', () => {
  const list = [c({ name: 'SID', value: 'abc' }), c({ name: 'x', value: 'TOKEN' }), c({ name: 'y', domain: '.Other.test' })];
  assert.deepEqual(filterCookies(list, 'sid').map((x) => x.name), ['SID']);
  assert.deepEqual(filterCookies(list, 'token').map((x) => x.name), ['x']);
  assert.deepEqual(filterCookies(list, 'other').map((x) => x.name), ['y']);
  assert.equal(filterCookies(list, '  ').length, 3);
  assert.equal(filterCookies(list, undefined).length, 3);
  assert.equal(filterCookies(list, 'nothing').length, 0);
});

test('formatExpiry: session, expired, and coarse relative times', () => {
  const now = 1_700_000_000_000;
  const at = (s) => c({ session: false, expirationDate: now / 1000 + s });
  assert.equal(formatExpiry(c({}), now), 'Session');
  assert.equal(formatExpiry(at(-1), now), 'Expired');
  assert.equal(formatExpiry(at(0), now), 'Expired');
  assert.equal(formatExpiry(at(30), now), 'in <1 min');
  assert.equal(formatExpiry(at(60), now), 'in 1 min');
  assert.equal(formatExpiry(at(59 * 60), now), 'in 59 min');
  assert.equal(formatExpiry(at(3600), now), 'in 1 hour');
  assert.equal(formatExpiry(at(5 * 3600), now), 'in 5 hours');
  assert.equal(formatExpiry(at(3.5 * 86400), now), 'in 3 days');
  assert.equal(formatExpiry(at(90 * 86400), now), 'in 3 months');
  assert.equal(formatExpiry(at(800 * 86400), now), 'in 2 years');
});

test('byteCount: UTF-8 bytes across parts', () => {
  assert.equal(byteCount('ab', 'c'), 3);
  assert.equal(byteCount('é'), 2);
  assert.equal(byteCount('😀', undefined), 4);
  assert.equal(byteCount(), 0);
});

test('truncate: ellipsis, no split surrogate pairs', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
  assert.equal(truncate('abc😀def', 5), 'abc…');
  assert.equal(truncate(null, 3), '');
});

test('countSummary: totals, partitioned, filtered', () => {
  const list = [c({}), c({ partitionKey: { topLevelSite: 'https://a.test' } }), c({ name: 'z' })];
  assert.equal(countSummary([]), '0 cookies');
  assert.equal(countSummary([c({})]), '1 cookie');
  assert.equal(countSummary(list), '3 cookies · 1 partitioned');
  assert.equal(countSummary(list, 3), '3 cookies · 1 partitioned');
  assert.equal(countSummary(list, 1), '1 of 3 cookies · 1 partitioned');
});

test('datetime-local round trip in local time, with and without seconds', () => {
  const s = new Date(2030, 4, 6, 7, 8, 9).getTime() / 1000;
  assert.equal(toDatetimeLocal(s), '2030-05-06T07:08:09');
  assert.equal(fromDatetimeLocal('2030-05-06T07:08:09'), s);
  assert.equal(fromDatetimeLocal('2030-05-06T07:08'), s - 9);
  assert.ok(Number.isNaN(fromDatetimeLocal('')));
  assert.ok(Number.isNaN(fromDatetimeLocal('tomorrow')));
  assert.match(defaultExpiry(0), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
});

test('formFromCookie / draftFromForm: untouched cookie round-trips byte-identically', () => {
  const orig = c({ domain: '.a.test', hostOnly: false, session: false, expirationDate: 1900000000.123456, httpOnly: true,
    sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://a.test', hasCrossSiteAncestor: false } });
  const form = formFromCookie(orig, { site: 'a.test' });
  assert.equal(form.domain, 'a.test');
  assert.equal(form.hostOnly, false);
  assert.equal(form.partitioned, true);
  const d = draftFromForm(form, orig);
  assert.equal(d.domain, '.a.test');
  assert.equal(d.expirationDate, 1900000000.123456);
  assert.deepEqual(d.partitionKey, { topLevelSite: 'https://a.test', hasCrossSiteAncestor: false });
  for (const k of ['name', 'value', 'path', 'secure', 'httpOnly', 'sameSite', 'session', 'hostOnly']) assert.equal(d[k], orig[k], k);
});

test('draftFromForm: edits replace kept fields; session drops expiry; unpartitioning drops the key', () => {
  const orig = c({ session: false, expirationDate: 1900000000.5, partitionKey: { topLevelSite: 'https://a.test', hasCrossSiteAncestor: true } });
  const form = formFromCookie(orig, { site: 'a.test' });
  const moved = draftFromForm({ ...form, expires: '2031-01-01T00:00:00', topLevelSite: 'https://b.test/' }, orig);
  assert.equal(moved.expirationDate, new Date(2031, 0, 1).getTime() / 1000);
  assert.deepEqual(moved.partitionKey, { topLevelSite: 'https://b.test' });
  const plain = draftFromForm({ ...form, session: true, partitioned: false }, orig);
  assert.equal('expirationDate' in plain, false);
  assert.equal('partitionKey' in plain, false);
  assert.equal(plain.session, true);
});

test('formFromCookie: defaults for a new cookie', () => {
  const f = formFromCookie(null, { host: 'www.a.test', site: 'a.test', https: true });
  assert.deepEqual(f, { name: '', value: '', domain: 'www.a.test', hostOnly: true, path: '/', session: true, expires: '',
    secure: true, httpOnly: false, sameSite: 'lax', partitioned: false, topLevelSite: 'https://a.test' });
  assert.equal(formFromCookie(null, { host: 'x.test', https: false }).secure, false);
  const d = draftFromForm({ ...f, name: 'a', domain: ' .www.a.test ' });
  assert.equal(d.domain, 'www.a.test');
});

test('small labels', () => {
  assert.notEqual(rowSignature(c({}), 'a.test'), rowSignature(c({ value: 'w' }), 'a.test'));
  assert.equal(rowSignature(c({}), 'a.test'), rowSignature(c({}), 'a.test'));
  assert.equal(sameSiteLabel('no_restriction'), 'None');
  assert.equal(sameSiteLabel('unspecified'), '');
  assert.equal(storeLabel({ id: '0' }), 'Default');
  assert.equal(storeLabel({ id: '1' }), 'Incognito');
  assert.equal(exportFilename('a.test', 'json', new Date(2030, 0, 2, 3, 4).getTime()), 'cookies-a.test-20300102-0304.json');
  assert.equal(exportFilename('a/b', 'txt', new Date(2030, 0, 2, 3, 4).getTime()), 'cookies-a_b-20300102-0304.txt');
});
