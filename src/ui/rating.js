// Asking for a store rating. Timing does the work: we ask people who have used
// CookieDesk for a while, right after it just worked for them, and never soon
// after something went wrong. Everyone who is asked gets the same "Rate" button
// (no "are you happy?" filter in front of the store).
//
//   eligible: installed ≥ 3 days, used on ≥ 3 different days, ≥ 5 successful changes
//   moment:   a successful change in the last 24 h, and no error since it or in the last 3 days
//   rarely:   at most 3 asks; "Later" waits 3 weeks, then 2 months, and needs
//             5 more successful changes; a card ignored for a day counts as "Later";
//             "Rate" ends it for good.
//
// Only store installs ask (unpacked builds have no update_url). Opening the
// review page is the user navigating in a normal tab: nothing is sent.
// The usage record holds counts and times only, never a cookie.

const USE_KEY = 'usage';
const ASK_KEY = 'rateAsk';
const LOCK = 'cookiedesk-usage';
const DAY = 24 * 60 * 60 * 1000;

export const MIN_INSTALLED_DAYS = 3;
export const MIN_ACTIVE_DAYS = 3;
export const MIN_WINS = 5;
const CALM_AFTER_TROUBLE = 3 * DAY;
const FRESH_WIN = DAY;
const SNOOZE_DAYS = [21, 60];
const MAX_ASKS = 3;
const MORE_WINS_PER_ASK = 5;
/** The support card stays quiet this long after any rating card interaction (one ask at a time). */
export const SUPPORT_QUIET = 3 * DAY;

// ---- pure decisions (unit-tested) ----

/** Where this copy came from, from the update_url the store adds; null for unpacked builds. */
export function reviewPage(manifest, id) {
  const from = manifest?.update_url ?? '';
  if (from.includes('clients2.google.com')) return { store: 'Chrome Web Store', url: `https://chromewebstore.google.com/detail/${id}/reviews` };
  if (from.includes('edge.microsoft.com')) return { store: 'Microsoft Edge Add-ons', url: `https://microsoftedge.microsoft.com/addons/detail/${id}` };
  return null;
}

const dayOf = (now) => Math.floor(now / DAY);

/** Usage after one outcome: 'win' (a change Chrome confirmed) or 'trouble' (an error shown). */
export function record(use, kind, now) {
  const u = { installedAt: now, wins: 0, activeDays: 0, ...use };
  if (kind === 'trouble') return { ...u, lastTroubleAt: now };
  if (kind !== 'win') return u;
  const today = dayOf(now);
  return {
    ...u,
    wins: u.wins + 1,
    lastWinAt: now,
    activeDays: u.lastDay === today ? u.activeDays : u.activeDays + 1,
    lastDay: today,
  };
}

export function shouldAsk(use, ask, now) {
  const u = { wins: 0, activeDays: 0, ...use };
  const a = { asks: 0, winsAtAsk: 0, ...ask };
  if (a.done || a.asks >= MAX_ASKS) return false;
  if (a.nextAskAt && now < a.nextAskAt) return false;
  if (!u.installedAt || now - u.installedAt < MIN_INSTALLED_DAYS * DAY) return false;
  if (u.activeDays < MIN_ACTIVE_DAYS || u.wins < MIN_WINS) return false;
  if (a.asks > 0 && u.wins - a.winsAtAsk < MORE_WINS_PER_ASK) return false;
  if (!u.lastWinAt || now - u.lastWinAt > FRESH_WIN) return false;
  if (u.lastTroubleAt && (u.lastTroubleAt > u.lastWinAt || now - u.lastTroubleAt < CALM_AFTER_TROUBLE)) return false;
  return true;
}

/** "Later" (or a card left alone for a day). */
export function afterLater(use, ask, now) {
  const a = { asks: 0, ...ask };
  const days = SNOOZE_DAYS[Math.min(a.asks, SNOOZE_DAYS.length - 1)];
  return { ...a, asks: a.asks + 1, nextAskAt: now + days * DAY, winsAtAsk: use?.wins ?? 0, shownAt: undefined, actedAt: now };
}

export const afterRate = (ask, now) => ({ ...ask, done: 'rated', shownAt: undefined, actedAt: now });

// ---- storage (chrome.storage.local; never leaves the computer) ----

async function load() {
  const d = await chrome.storage.local.get([USE_KEY, ASK_KEY]);
  return { use: d[USE_KEY] ?? {}, ask: d[ASK_KEY] ?? {} };
}

const saveAsk = (ask) => chrome.storage.local.set({ [ASK_KEY]: ask });

export function storePage() {
  try {
    return reviewPage(chrome.runtime.getManifest(), chrome.runtime.id);
  } catch {
    return null;
  }
}

/** Service worker on install, and the UI as a fallback: starts the clock once. */
export async function noteInstalled() {
  await navigator.locks.request(LOCK, async () => {
    const { use } = await load();
    if (!use.installedAt) await chrome.storage.local.set({ [USE_KEY]: { ...use, installedAt: Date.now() } });
  });
}

/** After every change Chrome confirmed ('win') or error the user saw ('trouble'). */
export async function noteOutcome(kind) {
  await navigator.locks.request(LOCK, async () => {
    const { use } = await load();
    await chrome.storage.local.set({ [USE_KEY]: record(use, kind, Date.now()) });
  });
}

/**
 * { page, show, supportQuiet, wins }. Showing the card starts its one-day clock;
 * a card nobody answered by then counts as "Later".
 */
export async function ratingPrompt() {
  const page = storePage();
  const now = Date.now();
  let { use, ask } = await load();
  if (ask.shownAt && now - ask.shownAt > DAY) {
    ask = afterLater(use, ask, now);
    await saveAsk(ask);
  }
  const show = !!page && shouldAsk(use, ask, now);
  if (show && !ask.shownAt) await saveAsk({ ...ask, shownAt: now });
  const supportQuiet = show || (!!ask.actedAt && now - ask.actedAt < SUPPORT_QUIET);
  return { page, show, supportQuiet, wins: use.wins ?? 0 };
}

export async function rateLater() {
  const { use, ask } = await load();
  await saveAsk(afterLater(use, ask, Date.now()));
}

/** Straight to the store's review page in a new tab; never asks again. */
export async function openReviews() {
  const page = storePage();
  if (!page) return;
  const opened = chrome.tabs.create({ url: page.url });
  const { ask } = await load();
  await saveAsk(afterRate(ask, Date.now()));
  await opened;
}
