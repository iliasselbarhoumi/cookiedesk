// chrome.cookies wrapper: list a site (both partitions), and transactional
// writes with undo. See phase0/FINDINGS.md §3, §6 and docs/core-contract.md.
//
// Every mutation runs under one lock shared by all extension pages, and:
//   1. snapshots every cookie it will touch (each step changes exactly one key);
//   2. journals the snapshots to chrome.storage.session BEFORE the first write,
//      so a popup that closes mid-transaction still leaves an undo behind;
//   3. writes with no loss window (same key: one set(); key change: set the new
//      cookie, then delete the old) and deletes precisely (expired overwrite of
//      the exact key; remove() would take same-name neighbours with it);
//   4. verifies by reading the exact key back (set()'s return value can be a
//      different same-name cookie; remove()'s proves nothing);
//   5. on any failure, compensates every step including the failing one, so the
//      store ends fully changed or exactly as it was — and says which.
// Undo is itself a journaled transaction, and refuses (unless forced) when the
// cookies changed since, so it never silently destroys a newer value.

import {
  cookieKey, sameCookie, snapshot, sortCookies, toSetDetails, toExpireDetails, toExactFilter,
} from './model.js';
import { features, chromeMajorFromUA, normalizePartitionKey, siteQueries } from './partition.js';
import { validateCookie, utf8Bytes } from './validate.js';
import { isPublicSuffix } from './site.js';
import { t, tn } from '../lib/i18n.js';

const JOURNAL_PREFIX = 'undo:';
export const JOURNAL_MAX = 20;
export const JOURNAL_TTL_MS = 10 * 60 * 1000;
const ENTRY_MAX_BYTES = 4 * 1024 * 1024; // storage.session holds 10 MB in total
const LOCK_NAME = 'cookiedesk-transaction';

export class CookieError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    Object.assign(this, details);
  }
}

export function detectFeatures(env = globalThis) {
  return features({
    chromeMajor: chromeMajorFromUA(env.navigator?.userAgent),
    hasGetPartitionKey: typeof env.chrome?.cookies?.getPartitionKey === 'function',
  });
}

/**
 * Ask Chrome what its cookies API accepts. Its argument validator rejects an
 * unknown property ("Unexpected property: 'hasCrossSiteAncestor'") before any
 * permission check, so a getAll that matches nothing is a safe, exact test. The
 * version in the user agent can be wrong or missing; this cannot.
 */
export async function probeFeatures(cookies = globalThis.chrome?.cookies) {
  const accepts = async (partitionKey) => {
    try {
      await cookies.getAll({ name: 'cookiedesk-feature-probe', partitionKey });
      return true;
    } catch {
      return false;
    }
  };
  return {
    partitionKey: await accepts({}),
    hasCrossSiteAncestor: await accepts({ topLevelSite: 'https://cookiedesk.invalid', hasCrossSiteAncestor: false }),
    getPartitionKey: typeof cookies?.getPartitionKey === 'function',
  };
}

const host = (c) => c.domain.replace(/^\./, '');

// Every filter we pass pins the store, so identity within a result ignores storeId
// (a draft may not carry one; Chrome's copy always does).
function keyInStore(c) {
  return cookieKey({ ...c, storeId: '' });
}

/**
 * @param {object} deps  injectable for tests: { cookies, storage, feats, now, locks }
 */
export function createEngine({
  cookies = globalThis.chrome?.cookies,
  storage = globalThis.chrome?.storage?.session,
  feats,
  now = () => Date.now(),
  locks = globalThis.navigator?.locks,
} = {}) {
  // Without injected flags, start from the version estimate and correct it by
  // probing; every call that reads or writes cookies waits for the probe.
  let ready = Promise.resolve();
  if (!feats) {
    feats = detectFeatures();
    ready = probeFeatures(cookies).then((f) => { Object.assign(feats, f); }, () => {});
  }
  const afterProbe = (fn) => async (...args) => { await ready; return fn(...args); };
  let busy = 0;
  const listeners = new Set();
  let debounce = null;
  let chain = Promise.resolve();

  // Popup, side panel and worker share the extension origin, so a Web Lock
  // serialises transactions across all of them. Without it (tests), a promise chain.
  function exclusive(fn) {
    if (locks?.request) return locks.request(LOCK_NAME, fn);
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  }

  // ---- reading -------------------------------------------------------------------

  async function list({ site, storeId }) {
    const seen = new Map();
    for (const filter of siteQueries(site, feats, storeId)) {
      for (const c of await cookies.getAll(filter)) seen.set(cookieKey(c), c);
    }
    return sortCookies([...seen.values()]);
  }

  async function findExact(c) {
    const filter = toExactFilter(c);
    if (!feats.partitionKey) delete filter.partitionKey;
    const found = await cookies.getAll(filter);
    return found.find((x) => keyInStore(x) === keyInStore(c)) ?? null;
  }

  async function stores() {
    return cookies.getAllCookieStores();
  }

  // ---- primitive writes (each verified) ---------------------------------------------

  async function write(target) {
    try {
      await cookies.set(toSetDetails(target));
    } catch (e) {
      throw await explainRejection(target, e);
    }
    const stored = await findExact(target);
    if (!stored) throw new CookieError('not_stored', t('err_not_stored', target.name), { cookie: target.name });
    return stored;
  }

  async function erase(c, { allowIrreversible = false } = {}) {
    let refused = null;
    try {
      await cookies.set(toExpireDetails(c));
    } catch (e) {
      refused = e;
    }
    if (refused) {
      // Chrome no longer accepts this cookie's own attributes (a legacy cookie).
      // remove() is the only way left, but it deletes same-name neighbours too,
      // and a deleted copy could never be written back for undo.
      const url = toSetDetails(c).url;
      const filter = { name: c.name, url };
      if (c.storeId !== undefined) filter.storeId = c.storeId;
      if (feats.partitionKey && c.partitionKey) filter.partitionKey = c.partitionKey;
      const neighbours = (await cookies.getAll(filter)).filter((x) => keyInStore(x) !== keyInStore(c));
      if (neighbours.length) {
        throw new CookieError('imprecise_delete', tn('err_imprecise_delete', neighbours.length, c.name), { cookie: c.name });
      }
      if (!allowIrreversible) {
        throw new CookieError('irreversible', t('err_irreversible_delete', c.name), { cookie: c.name });
      }
      await cookies.remove({ url, name: c.name, ...(c.storeId !== undefined ? { storeId: c.storeId } : {}), ...(filter.partitionKey ? { partitionKey: c.partitionKey } : {}) });
    }
    if (await findExact(c)) throw new CookieError('not_removed', t('err_not_removed', c.name), { cookie: c.name });
  }

  // Chrome's only error is "Failed to parse or set cookie"; say which rule broke.
  async function explainRejection(target, e) {
    const raw = String(e?.message ?? e);
    if (/No host permissions/i.test(raw)) {
      return new CookieError('no_permission', t('err_no_permission', host(target)), { cookie: target.name });
    }
    const { errors } = validateCookie(target, { now: now(), isPublicSuffix });
    if (errors.length) return new CookieError('invalid', errors[0].message, { field: errors[0].field, issues: errors, cookie: target.name });
    if (!target.secure) {
      const filter = { name: target.name };
      if (target.storeId !== undefined) filter.storeId = target.storeId;
      const shadow = (await cookies.getAll(filter)).find((x) => x.secure && domainsOverlap(x.domain, target.domain));
      if (shadow) {
        return new CookieError('secure_shadow', t('err_secure_shadow', target.name, host(shadow)), { field: 'secure', cookie: target.name });
      }
    }
    return new CookieError('rejected', t('err_rejected', target.name), { cookie: target.name });
  }

  // ---- normalising drafts --------------------------------------------------------------

  function normalize(draft, storeId) {
    if (draft.partitionKey?.topLevelSite && !feats.partitionKey) {
      throw new CookieError('partition_unsupported', t('err_partition_unsupported', draft.name), { cookie: draft.name });
    }
    const bare = String(draft.domain ?? '').replace(/^\./, '').toLowerCase();
    const hostOnly = draft.hostOnly ?? !String(draft.domain ?? '').startsWith('.');
    const domain = hostOnly ? bare : `.${bare}`;
    const session = draft.session ?? draft.expirationDate === undefined;
    const c = {
      name: draft.name,
      value: draft.value ?? '',
      domain,
      hostOnly,
      path: draft.path || '/',
      secure: !!draft.secure,
      httpOnly: !!draft.httpOnly,
      sameSite: draft.sameSite ?? 'unspecified',
      session,
      storeId,
    };
    if (!session) c.expirationDate = draft.expirationDate;
    if (c.storeId === undefined) delete c.storeId;
    const pk = feats.partitionKey ? normalizePartitionKey(draft.partitionKey, domain, feats) : undefined;
    if (pk) c.partitionKey = pk;
    return c;
  }

  function assertValid(c) {
    const { errors } = validateCookie(c, { now: now(), isPublicSuffix });
    if (errors.length) throw new CookieError('invalid', errors[0].message, { field: errors[0].field, issues: errors, cookie: c.name });
  }

  const isExpired = (c) => !c.session && c.expirationDate * 1000 <= now();
  // A cookie Chrome stored under older rules (e.g. SameSite=None without Secure) can't be set again as it is.
  const restorable = (c) => validateCookie(c, { now: now(), isPublicSuffix }).errors.length === 0;

  // ---- transactions ---------------------------------------------------------------------

  /** One step makes one key hold `after` (null = absent) where it held `before`. Idempotent undo. */
  function step(before, after, opts, stored) {
    return {
      before,
      after,
      do: async () => {
        if (after) stored.push(await write(after));
        else if (before) await erase(before, opts);
      },
      undo: async () => {
        const target = before ?? after;
        const current = await findExact(target);
        if (before) {
          if (!sameCookie(current, before)) await write(before);
        } else if (current) {
          await erase(current);
        }
      },
    };
  }

  /**
   * Run `plan` ([{ before, after }], one key each) as one undoable transaction.
   * Caller holds the lock and has read `before` inside it.
   */
  async function transact(label, plan, opts = {}) {
    // Replacing a cookie Chrome would no longer accept as it is would leave nothing for undo to write back.
    const lost = opts.checkRestorable === false ? [] : plan.filter((p) => p.before && p.after && !restorable(p.before)).map((p) => p.before.name);
    if (lost.length && !opts.allowIrreversible) {
      throw new CookieError('irreversible', tn('err_irreversible_replace', lost.length, listNames(lost)), { cookies: lost });
    }
    const stored = [];
    const steps = plan.map(({ before, after }) => step(before, after, opts, stored));
    const entry = {
      id: `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      // An undo's own entry remembers what it undid, so the UI can offer it as a redo.
      ...(opts.undid ? { undid: opts.undid } : {}),
      at: now(),
      state: 'pending',
      restore: plan.filter((p) => p.before).map((p) => snapshot(p.before)),
      after: plan.filter((p) => p.after).map((p) => snapshot(p.after)),
    };
    const bytes = utf8Bytes(JSON.stringify(entry));
    if (bytes > ENTRY_MAX_BYTES && !opts.allowIrreversible) {
      throw new CookieError('too_large_to_undo', t('err_too_large_to_undo', Math.ceil(bytes / 1024)));
    }
    const journaled = bytes <= ENTRY_MAX_BYTES;
    if (journaled) await putEntry(entry);

    busy++;
    const done = [];
    try {
      for (const s of steps) {
        done.push(s); // pushed first: a step that fails half-way is compensated too
        await s.do();
      }
    } catch (e) {
      let rolledBack = true;
      for (const s of done.reverse()) {
        try { await s.undo(); } catch { rolledBack = false; }
      }
      e.rolledBack = rolledBack;
      if (journaled) {
        if (rolledBack) await dropEntry(entry.id);
        else await putEntry({ ...entry, label: t('label_incomplete', label), state: 'done' });
      }
      throw e;
    } finally {
      busy--;
      notifySoon();
    }
    if (!journaled) return null;
    // Record what Chrome actually stored (it may clamp expiry), for undo's conflict check.
    await putEntry({ ...entry, state: 'done', after: stored.map(snapshot) });
    return entry.id;
  }

  /** Create (original = null) or edit a cookie. Returns { undoId, cookie }. */
  function save(original, draft, opts = {}) {
    return exclusive(async () => {
      const next = normalize(draft, original ? original.storeId : draft.storeId);
      assertValid(next);
      const plan = [];
      if (original) {
        const current = await findExact(original);
        if (!current) throw new CookieError('gone', t('err_gone', original.name), { cookie: original.name });
        if (keyInStore(current) !== keyInStore(next)) {
          // Key change: write the new cookie first (keeping whatever it overwrites), then delete the old.
          // An expired draft is just a delete of the original (the editor warned about it).
          if (!isExpired(next)) plan.push({ before: await findExact(next), after: next });
          plan.push({ before: current, after: null });
        } else {
          plan.push({ before: current, after: isExpired(next) ? null : next });
        }
      } else {
        const displaced = await findExact(next);
        if (!isExpired(next)) plan.push({ before: displaced, after: next });
        else if (displaced) plan.push({ before: displaced, after: null });
      }
      const label = !original ? t('label_added', next.name) : isExpired(next) ? t('label_deleted_expired', next.name) : t('label_edited', next.name);
      const undoId = plan.length ? await transact(label, plan, opts) : null;
      return { undoId, cookie: isExpired(next) ? null : await findExact(next) };
    });
  }

  /** Delete exactly these cookies. All-or-nothing. Returns { undoId }. */
  function remove(list, opts = {}) {
    return exclusive(async () => {
      const plan = [];
      for (const c of list) {
        const current = await findExact(c);
        if (current) plan.push({ before: current, after: null });
      }
      if (!plan.length) return { undoId: null };
      const label = plan.length === 1 ? t('label_deleted', plan[0].before.name) : tn('label_deleted_many', plan.length);
      return { undoId: await transact(label, plan, opts) };
    });
  }

  /**
   * Write imported drafts. Validates everything before the first write; all-or-nothing.
   * `remove`: cookies to delete in the same transaction unless a draft takes their
   *   place (restoring a cookie set makes the site match the set).
   * `protect(cookie)`: true leaves that cookie alone, neither overwritten nor
   *   deleted. Asked about Chrome's own copy, so it matches exactly.
   * `dryRun`: return what would happen, and write nothing.
   * Returns { undoId, written, deleted, skipped, plan: { write, delete } } (names only).
   */
  function importDrafts(drafts, { storeId, remove: removals = [], protect = () => false, label, dryRun = false, ...opts } = {}) {
    return exclusive(async () => {
      const next = drafts.map((d) => normalize(d, storeId));
      for (const c of next) assertValid(c);
      const keys = new Set();
      for (const c of next) {
        const k = keyInStore(c);
        if (keys.has(k)) throw new CookieError('duplicate', t('err_duplicate_in_file', c.name), { cookie: c.name });
        keys.add(k);
      }
      const writes = [];
      const deletes = [];
      const skipped = [];
      const kept = new Set(); // Chrome's keys that a draft takes over
      for (const c of next) {
        const displaced = await findExact(c);
        if (displaced) kept.add(keyInStore(displaced));
        if (displaced && protect(displaced)) { skipped.push(displaced.name); continue; }
        if (isExpired(c)) { if (displaced) deletes.push({ before: displaced, after: null }); } else if (!sameCookie(displaced, { ...c, storeId: displaced?.storeId })) writes.push({ before: displaced, after: c });
      }
      for (const r of removals) {
        const current = await findExact(r);
        if (!current || kept.has(keyInStore(current))) continue;
        if (protect(current)) { skipped.push(current.name); continue; }
        deletes.push({ before: current, after: null });
      }
      const summary = { written: writes.length, deleted: deletes.length, skipped, plan: { write: writes.map((p) => p.after.name), delete: deletes.map((p) => p.before.name) } };
      const plan = [...deletes, ...writes];
      if (dryRun || !plan.length) return { undoId: null, ...summary };
      const undoId = await transact(label ?? tn('label_imported', writes.length), plan, opts);
      return { undoId, ...summary };
    });
  }

  // ---- undo journal (chrome.storage.session: memory only, never on disk) ---------------
  // One storage key per entry, so concurrent writers never overwrite each other's.

  async function readJournal() {
    const all = await storage.get(null);
    const cutoff = now() - JOURNAL_TTL_MS;
    const entries = [];
    const stale = [];
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith(JOURNAL_PREFIX)) continue;
      if (v.at < cutoff) stale.push(k);
      else entries.push(v);
    }
    entries.sort((a, b) => a.at - b.at);
    while (entries.length > JOURNAL_MAX) stale.push(JOURNAL_PREFIX + entries.shift().id);
    if (stale.length) await storage.remove(stale);
    return entries;
  }

  async function putEntry(entry) {
    await storage.set({ [JOURNAL_PREFIX + entry.id]: entry });
  }

  async function dropEntry(id) {
    await storage.remove(JOURNAL_PREFIX + id);
  }

  // Entries are scoped to one cookie store, so an incognito change never shows up
  // (or gets undone) from a regular window, and vice versa.
  const inStore = (storeId) => (e) => storeId === undefined || [...e.restore, ...e.after].every((c) => (c.storeId ?? storeId) === storeId);

  /** Undo entries newest first, without values (safe to render). `storeId` limits to one store. */
  async function undoList({ storeId } = {}) {
    return (await readJournal()).filter(inStore(storeId)).reverse().map(({ id, label, undid, at, state, restore, after }) => ({
      id, label, undid, at, interrupted: state === 'pending', count: new Set([...restore, ...after].map(keyInStore)).size,
    }));
  }

  /**
   * Remove expired entries now (call on a timer) so old values don't linger in
   * memory. With `liveStores`, also drop entries for cookie stores that no longer
   * exist: closing the last incognito window must end its cookies' undo copies too.
   */
  async function pruneJournal({ liveStores } = {}) {
    const entries = await readJournal();
    if (!liveStores) return;
    // Undo copies from a store that is gone (the last incognito window closed) go with it.
    const live = new Set(liveStores);
    const dead = entries.filter((e) => [...e.restore, ...e.after].some((c) => c.storeId !== undefined && !live.has(c.storeId)));
    if (dead.length) await storage.remove(dead.map((e) => JOURNAL_PREFIX + e.id));
  }

  /**
   * Undo one entry (default: newest). Refuses with `undo_conflict` when a cookie
   * changed since (the site wrote it, or a later edit), unless `force`. The undo
   * is itself journaled, so it can be undone.
   */
  function undo(id, { force = false, storeId } = {}) {
    return exclusive(async () => {
      const entries = (await readJournal()).filter(inStore(storeId));
      const entry = id ? entries.find((e) => e.id === id) : entries.at(-1);
      if (!entry) throw new CookieError('undo_expired', t('err_undo_expired'));

      // Desired end state per key: the snapshot it had before, or absent.
      const targets = new Map();
      for (const c of entry.after) targets.set(keyInStore(c), { expected: c, restore: null });
      for (const c of entry.restore) targets.set(keyInStore(c), { expected: targets.get(keyInStore(c))?.expected ?? null, restore: c });

      const plan = [];
      const conflicts = [];
      const skipped = [];
      const refused = [];
      for (const { expected, restore } of targets.values()) {
        const probe = restore ?? expected;
        const current = await findExact(probe);
        // Fine: still what we wrote, or already back to what it was before (an
        // interrupted transaction never reached it). Anything else changed since.
        const asWritten = expected ? sameCookie(current, expected) || (!current && isExpired(expected)) : !current;
        const asBefore = restore ? sameCookie(current, restore) : !current;
        if (!asWritten && !asBefore) conflicts.push(probe.name);
        if (restore && isExpired(restore)) {
          skipped.push(restore.name); // it would have expired by now anyway
          if (current && expected) plan.push({ before: current, after: null });
          continue;
        }
        if (restore && !restorable(restore)) {
          refused.push(restore.name); // the user agreed to lose its undo; leave what is there now
          continue;
        }
        if (restore ? !sameCookie(current, restore) : current) plan.push({ before: current, after: restore });
      }
      if (conflicts.length && !force) {
        throw new CookieError('undo_conflict', t('err_undo_conflict', listNames(conflicts), entry.label), { cookies: conflicts });
      }
      if (plan.length) await transact(t('label_undid', entry.label), plan, { checkRestorable: false, undid: entry.label });
      await dropEntry(entry.id);
      return { label: entry.label, skipped, refused };
    });
  }

  // ---- change notifications -------------------------------------------------------------

  // Our own writes fire overwrite+explicit pairs (and rollbacks fire more); swallow
  // them while a transaction runs and announce one change at the end. Changes made
  // by the site arrive debounced, so a burst becomes one refresh.
  function notifySoon() {
    clearTimeout(debounce);
    debounce = setTimeout(() => { if (!busy) for (const l of listeners) l(); }, 60);
  }

  function onChange(listener) {
    if (!listeners.size) cookies.onChanged?.addListener(handleChanged);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) cookies.onChanged?.removeListener(handleChanged);
    };
  }

  function handleChanged() {
    if (!busy) notifySoon();
  }

  return {
    feats, ready, stores, undoList, pruneJournal, onChange, normalize,
    list: afterProbe(list), findExact: afterProbe(findExact), save: afterProbe(save),
    remove: afterProbe(remove), importDrafts: afterProbe(importDrafts), undo: afterProbe(undo),
  };
}

function listNames(names) {
  const quoted = [...new Set(names)].map((n) => `"${n}"`);
  return quoted.length <= 3 ? quoted.join(', ') : t('names_more', quoted.slice(0, 3).join(', '), quoted.length - 3);
}

function domainsOverlap(a, b) {
  const x = a.replace(/^\./, '').toLowerCase();
  const y = b.replace(/^\./, '').toLowerCase();
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}
