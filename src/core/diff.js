// Compare two cookie sets (P2-1), e.g. before and after a login flow. PURE: no
// chrome.*, unit-tested. Values are compared but never logged.

import { partitionId } from './model.js';

// Identity across stores and Chrome versions: a set saved where Chrome didn't report
// hasCrossSiteAncestor still matches one that does (absent counts as false).
function diffKey(c) {
  const pk = c.partitionKey?.topLevelSite ? { topLevelSite: c.partitionKey.topLevelSite, hasCrossSiteAncestor: c.partitionKey.hasCrossSiteAncestor === true } : null;
  return [partitionId(pk), String(c.domain).toLowerCase(), c.path, c.name].join('|');
}

const expiry = (c) => (c.session || c.expirationDate === undefined ? null : Math.floor(c.expirationDate));

/** Which attributes differ between two copies of the same cookie. */
export function changedFields(a, b) {
  const out = [];
  if (a.value !== b.value) out.push('value');
  if (expiry(a) !== expiry(b)) out.push('expiry');
  if (!!a.secure !== !!b.secure) out.push('secure');
  if (!!a.httpOnly !== !!b.httpOnly) out.push('httpOnly');
  if ((a.sameSite ?? 'unspecified') !== (b.sameSite ?? 'unspecified')) out.push('sameSite');
  return out;
}

/**
 * Returns { added, removed, changed: [{ before, after, fields }], expiryOnly: [...same shape], same }.
 * `expiryOnly` holds cookies whose only difference is the expiry (servers refresh
 * Max-Age on every response, so these are usually noise).
 */
export function diffCookieSets(before, after) {
  const old = new Map(before.map((c) => [diffKey(c), c]));
  const added = [];
  const changed = [];
  const expiryOnly = [];
  let same = 0;
  for (const c of after) {
    const k = diffKey(c);
    const prev = old.get(k);
    old.delete(k);
    if (!prev) { added.push(c); continue; }
    const fields = changedFields(prev, c);
    if (!fields.length) same++;
    else if (fields.length === 1 && fields[0] === 'expiry') expiryOnly.push({ before: prev, after: c, fields });
    else changed.push({ before: prev, after: c, fields });
  }
  const byName = (a, b) => (a.name ?? a.after.name).localeCompare(b.name ?? b.after.name);
  return {
    added: added.sort(byName),
    removed: [...old.values()].sort(byName),
    changed: changed.sort(byName),
    expiryOnly: expiryOnly.sort(byName),
    same,
  };
}
