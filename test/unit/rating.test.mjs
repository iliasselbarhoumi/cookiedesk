import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterLater, afterRate, record, reviewPage, shouldAsk } from '../../src/ui/rating.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 12);

/** Installed at T0, then `wins` clean wins spread over `days` days; returns usage at the last win. */
function used({ wins = 6, days = 3 } = {}) {
  let use = record({}, null, T0);
  for (let i = 0; i < wins; i++) use = record(use, 'win', T0 + Math.floor((i * days) / wins) * DAY + i * 1000);
  return { ...use, lastWinAt: T0 + 4 * DAY };
}
const now = T0 + 4 * DAY + 60 * 1000; // a minute after the last win

test('the review page follows where the copy was installed from', () => {
  assert.deepEqual(reviewPage({ update_url: 'https://clients2.google.com/service/update2/crx' }, 'abc'),
    { store: 'Chrome Web Store', url: 'https://chromewebstore.google.com/detail/abc/reviews' });
  assert.equal(reviewPage({ update_url: 'https://edge.microsoft.com/extensionwebstorebase/v1/crx' }, 'abc').store, 'Microsoft Edge Add-ons');
  assert.equal(reviewPage({}, 'abc'), null, 'unpacked builds never ask');
});

test('trouble is recorded without counting as use', () => {
  const use = record(record({}, 'win', T0), 'trouble', T0 + 1000);
  assert.equal(use.wins, 1);
  assert.equal(use.lastTroubleAt, T0 + 1000);
  assert.deepEqual(record(use, null, T0 + 2000), use);
});

test('active days count each day once', () => {
  const use = used({ wins: 6, days: 3 });
  assert.equal(use.wins, 6);
  assert.equal(use.activeDays, 3);
});

test('asks only established users, right after a win', () => {
  assert.equal(shouldAsk(used(), {}, now), true);
  assert.equal(shouldAsk(used({ wins: 4 }), {}, now), false, 'too few wins');
  assert.equal(shouldAsk(used({ days: 2 }), {}, now), false, 'too few days');
  assert.equal(shouldAsk({ ...used(), installedAt: now - 2 * DAY }, {}, now), false, 'installed too recently');
  assert.equal(shouldAsk(used(), {}, now + 2 * DAY), false, 'the win is no longer fresh');
});

test('never soon after something went wrong', () => {
  const troubled = { ...used(), lastTroubleAt: now - DAY };
  assert.equal(shouldAsk(troubled, {}, now), false);
  const after = { ...used(), lastTroubleAt: now - 5 * DAY + 1, lastWinAt: now - 1000 };
  assert.equal(shouldAsk({ ...after, lastTroubleAt: now - 4 * DAY }, {}, now), true, 'calm again after 3 days');
  assert.equal(shouldAsk({ ...used(), lastTroubleAt: now - 10 }, {}, now), false, 'trouble after the last win');
});

test('"Maybe later" backs off, needs more use, and stops after three asks', () => {
  let use = used();
  let ask = afterLater(use, {}, now);
  assert.equal(shouldAsk(use, ask, now + 20 * DAY), false, 'snoozed three weeks');
  use = { ...use, lastWinAt: now + 22 * DAY };
  assert.equal(shouldAsk(use, ask, now + 22 * DAY), false, 'no new wins since the ask');
  use = { ...use, wins: use.wins + 5 };
  assert.equal(shouldAsk(use, ask, now + 22 * DAY), true);
  ask = afterLater(use, ask, now + 22 * DAY);
  use = { ...use, wins: use.wins + 5, lastWinAt: now + 83 * DAY };
  assert.equal(shouldAsk(use, ask, now + 83 * DAY), true, 'second snooze is two months');
  ask = afterLater(use, ask, now + 83 * DAY);
  use = { ...use, wins: use.wins + 50, lastWinAt: now + 400 * DAY };
  assert.equal(shouldAsk(use, ask, now + 400 * DAY), false, 'three asks is the limit');
});

test('"Rate it" ends the asking', () => {
  assert.equal(shouldAsk(used(), afterRate({}, now), now), false);
});
