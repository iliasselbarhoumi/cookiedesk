import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MILESTONES, afterDismiss, afterKofi, decidePrompt, reachedMilestone } from '../../src/ui/support.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 9);
const fresh = { supporter: false, lastMilestone: 0, dismissals: 0 };

test('no ask before the first milestone, then exactly once per milestone', () => {
  assert.equal(decidePrompt(fresh, MILESTONES[0] - 1, now), null);
  assert.deepEqual(decidePrompt(fresh, MILESTONES[0], now), { kind: 'milestone', milestone: MILESTONES[0] });
  const later = afterDismiss(fresh, { kind: 'milestone', milestone: MILESTONES[0] }, now);
  assert.equal(decidePrompt(later, MILESTONES[0], now + 30 * DAY), null, 'same milestone never asked twice');
});

test('"Maybe later" snoozes longer each time and stops after four', () => {
  let s = fresh;
  const waits = [];
  for (let i = 0; i < 4; i++) {
    s = afterDismiss(s, { kind: 'milestone', milestone: MILESTONES[i] }, now);
    waits.push(Math.round((s.nextAskAt - now) / DAY));
  }
  assert.deepEqual(waits, [7, 21, 45, 90]);
  assert.equal(decidePrompt(s, 1_000_000, now + 400 * DAY), null, 'never again after four dismissals');
});

test('snoozed: a new milestone waits until the snooze ends', () => {
  const [first, second] = MILESTONES;
  const s = afterDismiss(fresh, { kind: 'milestone', milestone: first }, now);
  assert.equal(decidePrompt(s, second, now + 2 * DAY), null);
  assert.deepEqual(decidePrompt(s, second, now + 8 * DAY), { kind: 'milestone', milestone: second });
});

test('after a Ko-fi click: ask "did you?" once they come back, within a week', () => {
  const s = afterKofi(fresh, { kind: 'milestone', milestone: 3 }, now);
  assert.equal(s.lastMilestone, 3);
  assert.equal(decidePrompt(s, 3, now + 10 * 1000), null, 'not instantly');
  assert.deepEqual(decidePrompt(s, 3, now + 5 * 60 * 1000), { kind: 'confirm' });
  assert.equal(decidePrompt(s, 3, now + 8 * DAY), null, 'not forever');
  const notYet = afterDismiss(s, { kind: 'confirm' }, now + 5 * 60 * 1000);
  assert.equal(notYet.kofiClickedAt, undefined);
  assert.equal(notYet.dismissals, 0, '"Not yet" costs nothing');
});

test('supporters are never asked', () => {
  assert.equal(decidePrompt({ ...fresh, supporter: true }, 1000, now), null);
  assert.equal(afterKofi({ ...fresh, supporter: true }, null, now).kofiClickedAt, undefined);
});

test('milestones', () => {
  assert.equal(reachedMilestone(0), 0);
  assert.equal(reachedMilestone(MILESTONES[1] + 2), MILESTONES[1]);
  assert.equal(reachedMilestone(99999), MILESTONES[MILESTONES.length - 1]);
});
