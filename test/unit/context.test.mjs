// Tab -> view state (P0-7: every non-list state says why). context.js imports
// perms.js, which only touches chrome.* when called, so the pure parts load in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabState, restrictedMessage } from '../../src/ui/context.js';

test('no URL (side panel on a site we cannot see yet) is "unknown", not an empty list', () => {
  assert.deepEqual(tabState('', null), { kind: 'unknown' });
  assert.deepEqual(tabState(undefined, null), { kind: 'unknown' });
});

test('restricted pages are explained by reason (test 3)', () => {
  assert.equal(tabState('chrome://extensions/', null).reason, 'browser');
  assert.equal(tabState('https://chromewebstore.google.com/detail/x', { granted: true, via: 'all' }).reason, 'webstore');
  assert.equal(tabState('chrome-extension://abc/page.html', null).reason, 'extension');
  assert.equal(tabState('file:///tmp/a.html', null).reason, 'file');
  assert.equal(tabState('about:blank', null).kind, 'restricted');
  for (const r of ['browser', 'webstore', 'extension', 'file', 'other']) assert.ok(restrictedMessage(r).length > 20);
});

test('a web site without a grant is "no-access" with its registrable site (test 2)', () => {
  assert.deepEqual(tabState('https://www.example.co.uk/x', { granted: false, via: null }), { kind: 'no-access', site: 'example.co.uk', host: 'www.example.co.uk' });
});

test('a granted site is "ready" and remembers how it was granted', () => {
  assert.deepEqual(tabState('http://shop.a.test:8080/', { granted: true, via: 'site' }), { kind: 'ready', site: 'a.test', host: 'shop.a.test', via: 'site' });
  assert.equal(tabState('https://a.test/', { granted: true, via: 'all' }).via, 'all');
});
