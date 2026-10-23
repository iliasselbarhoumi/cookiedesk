// "Support me": CookieDesk is free, and tips go straight to Ko-fi (no support
// page in between). The card only appears after real use (milestones of
// successful changes), at most once per milestone, with growing snoozes after
// "Later" and a hard stop after MAX_DISMISSALS. Anyone who says they supported
// is never asked again. Honour system: nothing is gated behind it.
//
// Opening Ko-fi is the user navigating in a normal tab: the extension itself
// sends nothing anywhere. The heart in the header opens it any time.

export const KOFI_URL = 'https://ko-fi.com/buildwithiliass';
/** Successful changes (edits, deletes, imports, restores, copies) at which we gently ask. */
export const MILESTONES = [10, 40, 120, 300, 700, 1500];

const STATE_KEY = 'support';
const DAY = 24 * 60 * 60 * 1000;
const SNOOZE_DAYS = [7, 21, 45, 90];
const MAX_DISMISSALS = 4;
/** After a Ko-fi click, ask "did you?" once, when they come back (not instantly, not forever). */
const CONFIRM_AFTER_MS = 90 * 1000;
const CONFIRM_WITHIN_MS = 7 * DAY;

export const DEFAULT_SUPPORT = Object.freeze({ supporter: false, lastMilestone: 0, dismissals: 0 });

// ---- pure decisions (unit-tested) ----

export function reachedMilestone(count) {
  return MILESTONES.filter((m) => count >= m).pop() ?? 0;
}

/** What to show now: null, { kind: 'confirm' } or { kind: 'milestone', milestone }. */
export function decidePrompt(state, count, now) {
  const s = { ...DEFAULT_SUPPORT, ...state };
  if (s.supporter) return null;
  if (s.kofiClickedAt) {
    const since = now - s.kofiClickedAt;
    if (since >= CONFIRM_AFTER_MS && since <= CONFIRM_WITHIN_MS) return { kind: 'confirm' };
  }
  if (s.dismissals >= MAX_DISMISSALS) return null;
  if (s.nextAskAt && now < s.nextAskAt) return null;
  const milestone = reachedMilestone(count);
  return milestone > s.lastMilestone ? { kind: 'milestone', milestone } : null;
}

/** "Later" / "Not yet": snooze longer each time; "Not yet" forgets the click, no penalty. */
export function afterDismiss(state, prompt, now) {
  const s = { ...DEFAULT_SUPPORT, ...state };
  if (prompt?.kind === 'confirm') return { ...s, kofiClickedAt: undefined };
  const days = SNOOZE_DAYS[Math.min(s.dismissals, SNOOZE_DAYS.length - 1)];
  return {
    ...s,
    dismissals: s.dismissals + 1,
    nextAskAt: now + days * DAY,
    lastMilestone: Math.max(s.lastMilestone, prompt?.milestone ?? 0),
  };
}

/** Clicked through to Ko-fi: remember when (to ask "did you?" later) and the milestone. */
export function afterKofi(state, prompt, now) {
  const s = { ...DEFAULT_SUPPORT, ...state };
  return { ...s, kofiClickedAt: s.supporter ? undefined : now, lastMilestone: Math.max(s.lastMilestone, prompt?.milestone ?? 0) };
}

// ---- storage (chrome.storage.local; never leaves the computer) ----

export async function getSupport() {
  const d = await chrome.storage.local.get(STATE_KEY);
  return { ...DEFAULT_SUPPORT, ...d[STATE_KEY] };
}

const setState = (state) => chrome.storage.local.set({ [STATE_KEY]: state });

/** `count`: successful changes so far (rating.js keeps it). */
export async function supportPrompt(count) {
  const state = await getSupport();
  return { prompt: decidePrompt(state, count, Date.now()), supporter: state.supporter };
}

/** Straight to Ko-fi in a new tab. */
export async function openKofi(prompt = null) {
  // Open first: a later await would lose nothing here, but the tab is what the click asked for.
  const opened = chrome.tabs.create({ url: KOFI_URL });
  await setState(afterKofi(await getSupport(), prompt, Date.now()));
  await opened;
}

export async function dismissPrompt(prompt) {
  await setState(afterDismiss(await getSupport(), prompt, Date.now()));
}

export async function markSupporter() {
  await setState({ ...(await getSupport()), supporter: true, supporterSince: Date.now(), kofiClickedAt: undefined });
}
