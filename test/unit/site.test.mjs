import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  registrableDomain, isPublicSuffix, classifyUrl, originPatternFor,
  patternToSite, isAllSitesPattern, domainMatchesSite,
} from '../../src/core/site.js';
import { RULES } from '../../src/core/psl-data.js';

test('registrableDomain: basic and multi-level suffixes', () => {
  assert.equal(registrableDomain('example.com'), 'example.com');
  assert.equal(registrableDomain('www.example.com'), 'example.com');
  assert.equal(registrableDomain('a.b.c.example.com'), 'example.com');
  assert.equal(registrableDomain('www.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('example.co.uk'), 'example.co.uk');
});

test('registrableDomain: normalization', () => {
  assert.equal(registrableDomain('WWW.Example.COM'), 'example.com');
  assert.equal(registrableDomain('www.example.com.'), 'example.com');
  assert.equal(registrableDomain('.example.com'), 'example.com');
  assert.equal(registrableDomain('.a.example.com'), 'example.com');
});

test('registrableDomain: private suffixes', () => {
  assert.equal(registrableDomain('github.io'), 'github.io');
  assert.equal(registrableDomain('foo.github.io'), 'foo.github.io');
  assert.equal(registrableDomain('a.b.foo.github.io'), 'foo.github.io');
});

test('registrableDomain: IPs, localhost, single labels', () => {
  assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(registrableDomain('192.168.1.20'), '192.168.1.20');
  assert.equal(registrableDomain('[::1]'), '[::1]');
  assert.equal(registrableDomain('::1'), '::1');
  assert.equal(registrableDomain('[2001:db8::1]'), '[2001:db8::1]');
  assert.equal(registrableDomain('localhost'), 'localhost');
  assert.equal(registrableDomain('LOCALHOST.'), 'localhost');
  assert.equal(registrableDomain('intranet'), 'intranet');
  assert.equal(registrableDomain('com'), 'com');
  assert.equal(registrableDomain(''), '');
});

test('registrableDomain: wildcard and exception rules', () => {
  // *.ck is a suffix rule, !www.ck an exception
  assert.equal(registrableDomain('foo.ck'), 'foo.ck');
  assert.equal(registrableDomain('bar.foo.ck'), 'bar.foo.ck');
  assert.equal(registrableDomain('www.ck'), 'www.ck');
  assert.equal(registrableDomain('sub.www.ck'), 'www.ck');
  assert.equal(registrableDomain('city.kobe.jp'), 'city.kobe.jp');
  assert.equal(registrableDomain('x.city.kobe.jp'), 'city.kobe.jp');
});

test('registrableDomain: punycode and unicode hosts', () => {
  assert.equal(registrableDomain('xn--bcher-kva.example'), 'xn--bcher-kva.example');
  assert.equal(registrableDomain('www.xn--bcher-kva.ch'), 'xn--bcher-kva.ch');
  assert.equal(registrableDomain('www.bücher.ch'), 'xn--bcher-kva.ch');
  assert.equal(registrableDomain('www.example.xn--p1ai'), 'example.xn--p1ai');
  assert.equal(registrableDomain('www.пример.рф'), 'xn--e1afmkfd.xn--p1ai');
});

test('registrableDomain: unknown TLD uses default rule', () => {
  assert.equal(registrableDomain('a.b.notatld'), 'b.notatld');
});

test('isPublicSuffix', () => {
  assert.equal(isPublicSuffix('com'), true);
  assert.equal(isPublicSuffix('.co.uk'), true);
  assert.equal(isPublicSuffix('github.io'), true);
  assert.equal(isPublicSuffix('CO.UK.'), true);
  assert.equal(isPublicSuffix('example.com'), false);
  assert.equal(isPublicSuffix('foo.github.io'), false);
  assert.equal(isPublicSuffix('foo.ck'), true);
  assert.equal(isPublicSuffix('www.ck'), false);
  assert.equal(isPublicSuffix('localhost'), false);
  assert.equal(isPublicSuffix('127.0.0.1'), false);
  assert.equal(isPublicSuffix('::1'), false);
  assert.equal(isPublicSuffix(''), false);
});

test('classifyUrl: web', () => {
  assert.deepEqual(classifyUrl('https://www.example.co.uk/a?b#c'),
    { kind: 'web', scheme: 'https', host: 'www.example.co.uk', site: 'example.co.uk' });
  assert.deepEqual(classifyUrl('http://localhost:3000/x'),
    { kind: 'web', scheme: 'http', host: 'localhost', site: 'localhost' });
  assert.deepEqual(classifyUrl('http://[::1]:8080/'),
    { kind: 'web', scheme: 'http', host: '[::1]', site: '[::1]' });
  assert.deepEqual(classifyUrl('https://10.0.0.1/'),
    { kind: 'web', scheme: 'https', host: '10.0.0.1', site: '10.0.0.1' });
  assert.equal(classifyUrl('https://EXAMPLE.com./').site, 'example.com');
  // chrome.google.com outside /webstore is an ordinary site
  assert.equal(classifyUrl('https://chrome.google.com/other').kind, 'web');
  // the webstore exemption is https-only
  assert.equal(classifyUrl('http://chrome.google.com/webstore').kind, 'web');
});

test('classifyUrl: restricted reasons', () => {
  const r = (u) => classifyUrl(u);
  for (const u of ['chrome://settings', 'edge://flags', 'about:blank', 'devtools://devtools/x',
    'view-source:https://example.com', 'chrome-search://local-ntp', 'chrome-untrusted://x/']) {
    assert.equal(r(u).kind, 'restricted', u);
    assert.equal(r(u).reason, 'browser', u);
  }
  assert.deepEqual(r('chrome-extension://abc/page.html'), { kind: 'restricted', reason: 'extension', scheme: 'chrome-extension' });
  assert.equal(r('moz-extension://abc/p').reason, 'extension');
  assert.deepEqual(r('https://chromewebstore.google.com/detail/x'), { kind: 'restricted', reason: 'webstore', scheme: 'https' });
  assert.equal(r('https://chrome.google.com/webstore/detail/x').reason, 'webstore');
  assert.deepEqual(r('file:///tmp/a.html'), { kind: 'restricted', reason: 'file', scheme: 'file' });
  for (const u of ['data:text/plain,hi', 'blob:https://example.com/uuid', 'javascript:void(0)', 'ftp://example.com/', 'not a url', '', undefined]) {
    assert.equal(r(u).kind, 'restricted', String(u));
    assert.equal(r(u).reason, 'other', String(u));
  }
});

test('originPatternFor', () => {
  assert.equal(originPatternFor('example.com'), '*://*.example.com/*');
  assert.equal(originPatternFor('Example.co.uk'), '*://*.example.co.uk/*');
  assert.equal(originPatternFor('1.2.3.4'), '*://1.2.3.4/*');
  assert.equal(originPatternFor('[::1]'), '*://[::1]/*');
  assert.equal(originPatternFor('::1'), '*://[::1]/*');
  assert.equal(originPatternFor('localhost'), '*://localhost/*');
});

test('patternToSite and isAllSitesPattern', () => {
  assert.equal(patternToSite('*://*.example.com/*'), 'example.com');
  assert.equal(patternToSite('https://example.com/*'), 'example.com');
  assert.equal(patternToSite('http://*.example.com/*'), 'example.com');
  assert.equal(patternToSite('*://1.2.3.4/*'), '1.2.3.4');
  assert.equal(patternToSite('*://[::1]/*'), '[::1]');
  assert.equal(patternToSite('*://localhost/*'), 'localhost');
  for (const p of ['<all_urls>', '*://*/*', 'https://*/*', 'http://*/*']) {
    assert.equal(patternToSite(p), null, p);
    assert.equal(isAllSitesPattern(p), true, p);
  }
  for (const p of ['*://*.example.com/*', 'https://example.com/*', '', 'garbage']) {
    assert.equal(isAllSitesPattern(p), false, p);
  }
  assert.equal(patternToSite('garbage'), null);
  // round trip
  for (const s of ['example.com', '1.2.3.4', '[::1]', 'localhost']) {
    assert.equal(patternToSite(originPatternFor(s)), s);
  }
});

test('domainMatchesSite', () => {
  assert.equal(domainMatchesSite('.a.example.com', 'example.com'), true);
  assert.equal(domainMatchesSite('example.com', 'example.com'), true);
  assert.equal(domainMatchesSite('.EXAMPLE.com', 'example.com'), true);
  assert.equal(domainMatchesSite('notexample.com', 'example.com'), false);
  assert.equal(domainMatchesSite('example.com.evil.net', 'example.com'), false);
  assert.equal(domainMatchesSite('com', 'example.com'), false);
  assert.equal(domainMatchesSite('localhost', 'localhost'), true);
  assert.equal(domainMatchesSite('::1', '[::1]'), true);
  assert.equal(domainMatchesSite('', 'example.com'), false);
});

test('PSL data sanity', () => {
  const rules = new Set(RULES.split('\n'));
  for (const r of ['com', 'co.uk', 'github.io', '*.ck', '!www.ck']) assert.ok(rules.has(r), r);
  assert.ok(rules.size > 5000);
  assert.ok(!/[^\x00-\x7f]/.test(RULES), 'rules must be ASCII/punycode');
});

test('site.js stays pure', async () => {
  const src = await readFile(new URL('../../src/core/site.js', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\b/.test(src));
  assert.ok(!/\bchrome\.(cookies|tabs|runtime|storage|permissions|scripting)\b/.test(src));
  assert.ok(!/from 'node:/.test(src));
});

test('originPatternFor never asks for a whole public suffix', () => {
  assert.equal(originPatternFor('github.io'), '*://github.io/*');
  assert.equal(originPatternFor('com'), '*://com/*');
  assert.equal(originPatternFor('intranet'), '*://intranet/*');
  assert.equal(originPatternFor('foo.github.io'), '*://*.foo.github.io/*');
  assert.equal(patternToSite('*://github.io/*'), 'github.io');
});
