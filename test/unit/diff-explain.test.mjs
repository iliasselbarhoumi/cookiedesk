// P2-1 (diff two cookie sets) and P2-3 (explain this cookie).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffCookieSets, changedFields } from '../../src/core/diff.js';
import { explainCookie, jwtInfo } from '../../src/core/explain.js';

const NOW = 1_800_000_000_000;
const c = (o) => ({ name: 'n', value: 'v', domain: 'a.test', hostOnly: true, path: '/', secure: true, httpOnly: false, sameSite: 'lax', session: false, expirationDate: NOW / 1000 + 3600, ...o });

test('diffCookieSets: added, removed, changed (with fields), expiry-only and unchanged', () => {
  const before = [c({ name: 'sid', value: 'anon' }), c({ name: 'theme' }), c({ name: 'gone' }), c({ name: 'ttl' })];
  const after = [
    c({ name: 'sid', value: 'logged-in', httpOnly: true }),
    c({ name: 'theme' }),
    c({ name: 'csrf' }),
    c({ name: 'ttl', expirationDate: NOW / 1000 + 7200 }),
  ];
  const d = diffCookieSets(before, after);
  assert.deepEqual(d.added.map((x) => x.name), ['csrf']);
  assert.deepEqual(d.removed.map((x) => x.name), ['gone']);
  assert.deepEqual(d.changed.map((x) => [x.after.name, x.fields]), [['sid', ['value', 'httpOnly']]]);
  assert.deepEqual(d.expiryOnly.map((x) => x.after.name), ['ttl']);
  assert.equal(d.same, 1);
});

test('diffCookieSets: identity is domain + path + partition + name, not store; fractional expiry is not a change', () => {
  const pk = { topLevelSite: 'https://a.test' };
  const d = diffCookieSets(
    [c({ storeId: '0', partitionKey: pk }), c({ path: '/x' }), c({ expirationDate: 1000.2, name: 'f' })],
    [c({ storeId: '1', partitionKey: { ...pk, hasCrossSiteAncestor: false } }), c({ path: '/y' }), c({ expirationDate: 1000.9, name: 'f' })],
  );
  assert.equal(d.same, 2, 'store and an unreported hasCrossSiteAncestor do not matter; sub-second expiry neither');
  assert.deepEqual(d.added.map((x) => x.path), ['/y']);
  assert.deepEqual(d.removed.map((x) => x.path), ['/x']);
  assert.deepEqual(changedFields(c({ session: true, expirationDate: undefined }), c()), ['expiry']);
});

test('explainCookie: every attribute in plain words', () => {
  const t = (o, opts) => Object.fromEntries(explainCookie(c(o), { now: NOW, ...opts }).map((x) => [x.topic, x.text]));
  const host = t({ hostOnly: true, httpOnly: true, sameSite: 'strict' });
  assert.match(host.scope, /only to a\.test itself/);
  assert.match(host.httpOnly, /not visible to page JavaScript/);
  assert.match(host.sameSite, /Strict/);
  assert.match(host.secure, /only sent over HTTPS/);
  assert.match(host.expiry, /less than a day/);
  assert.match(host.size, /^2 of the 4096 bytes/);

  const dom = t({ domain: '.a.test', hostOnly: false, secure: false, sameSite: 'unspecified', session: true, expirationDate: undefined, path: '/app' });
  assert.match(dom.scope, /a\.test and every subdomain/);
  assert.match(dom.secure, /plain HTTP/);
  assert.match(dom.sameSite, /treats it as Lax/);
  assert.match(dom.expiry, /session cookie/);
  assert.match(dom.path, /under \/app/);
  assert.match(t({ name: '__Host-x' }).prefix, /__Host-/);
  assert.match(t({ name: '__Secure-x' }).prefix, /__Secure-/);

  const third = t({ domain: 'b.test', sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://a.test', hasCrossSiteAncestor: true } }, { site: 'a.test' });
  assert.match(third['third-party'], /Set by b\.test, a different site from a\.test.*partition/);
  assert.match(third.partition, /while a\.test is the site in the address bar\. It is in the cross-site part/);
  assert.match(t({ partitionKey: { topLevelSite: 'https://a.test', hasCrossSiteAncestor: false } }).partition, /same-site part/);
  assert.match(t({ name: '__host-x' }).prefix, /__Host-/);
  assert.equal(t({}, { site: 'a.test' })['third-party'], undefined);
});

test('jwtInfo: recognises a JWT and reads its exp; anything else is null', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'x', exp: 1_900_000_000 })}.c2lnbmF0dXJl`;
  assert.deepEqual(jwtInfo(token), { exp: 1_900_000_000 });
  assert.deepEqual(jwtInfo(`${b64({ alg: 'none' })}.${b64({ sub: 'x' })}.`), { exp: null });
  assert.deepEqual(jwtInfo(`${b64({ alg: 'none' })}.${b64({ exp: 1e20 })}.`), { exp: null }, 'absurd exp is not shown');
  for (const v of ['', 'abc', 'a.b.c', `${b64({ x: 1 })}.${b64({ exp: 1 })}.sig`, 'not.base64!!.x', `${'A'.repeat(10)}.${'B'.repeat(10)}.C`]) assert.equal(jwtInfo(v), null, v);
  const e = explainCookie(c({ value: token }), { now: NOW }).find((x) => x.topic === 'jwt');
  assert.match(e.text, /JSON Web Token; the token itself says it expires .*\(in 3 years\)/);
});
