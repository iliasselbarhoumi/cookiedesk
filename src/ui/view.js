// Pure helpers for the UI: formatting, filtering, and the editor form <-> draft
// mapping. No DOM and no chrome.* here, so they run under `node --test`.

import { utf8Bytes } from '../core/validate.js';
import { isPartitioned } from '../core/partition.js';

const SAME_SITE_LABELS = { no_restriction: 'None', lax: 'Lax', strict: 'Strict', unspecified: '' };

/** Live, case-insensitive match over name, value and domain. */
export function filterCookies(list, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => c.name.toLowerCase().includes(q)
    || c.value.toLowerCase().includes(q)
    || c.domain.toLowerCase().includes(q));
}

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** "Session", "Expired", or a coarse relative time like "in 3 days". `now` in ms. */
export function formatExpiry(cookie, now = Date.now()) {
  if (cookie.session || cookie.expirationDate === undefined) return 'Session';
  const s = cookie.expirationDate - now / 1000;
  if (s <= 0) return 'Expired';
  const min = 60; const hour = 60 * min; const day = 24 * hour;
  if (s < min) return 'in <1 min';
  if (s < hour) return `in ${plural(Math.floor(s / min), 'min')}`.replace(/mins$/, 'min');
  if (s < 2 * day) return `in ${plural(Math.floor(s / hour), 'hour')}`;
  if (s < 60 * day) return `in ${plural(Math.floor(s / day), 'day')}`;
  if (s < 730 * day) return `in ${plural(Math.floor(s / (30 * day)), 'month')}`;
  return `in ${plural(Math.floor(s / (365 * day)), 'year')}`;
}

/** Absolute expiry for tooltips, in the user's locale. */
export function formatExpiryDate(cookie) {
  if (cookie.session || cookie.expirationDate === undefined) return 'Deleted when the browser closes';
  return `Expires ${new Date(cookie.expirationDate * 1000).toLocaleString()}`;
}

/** UTF-8 bytes of all parts together (Chrome's 4096 limit is on name + value). */
export function byteCount(...parts) {
  return parts.reduce((n, p) => n + utf8Bytes(p ?? ''), 0);
}

/** Shorten to at most `max` characters with an ellipsis, never splitting a surrogate pair. */
export function truncate(str, max) {
  const s = String(str ?? '');
  if (s.length <= max) return s;
  let end = Math.max(0, max - 1);
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return `${s.slice(0, end)}…`;
}

/** "23 cookies · 2 partitioned"; with `shown`, "5 of 23 cookies · …" while filtering. */
export function countSummary(list, shown) {
  const total = list.length;
  const parts = [shown !== undefined && shown !== total ? `${shown} of ${plural(total, 'cookie')}` : plural(total, 'cookie')];
  const partitioned = list.filter(isPartitioned).length;
  if (partitioned) parts.push(`${partitioned} partitioned`);
  return parts.join(' · ');
}

export function sameSiteLabel(sameSite) {
  return SAME_SITE_LABELS[sameSite] ?? '';
}

/** Everything a row displays, so unchanged rows can be skipped on re-render. */
export function rowSignature(c, site) {
  return JSON.stringify([c.name, c.value, c.domain, c.path, c.secure, c.httpOnly, c.sameSite,
    c.session, c.expirationDate, c.partitionKey?.topLevelSite, c.partitionKey?.hasCrossSiteAncestor, site]);
}

// ---- dates: <input type=datetime-local> works in local time, cookies in epoch seconds ----

const pad = (n) => String(n).padStart(2, '0');

export function toDatetimeLocal(seconds) {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Epoch seconds, or NaN for an empty or malformed value. */
export function fromDatetimeLocal(str) {
  const m = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(String(str ?? ''));
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return new Date(y, mo - 1, d, h, mi, s).getTime() / 1000;
}

/** Default expiry offered when the user turns "Session cookie" off: 30 days out. */
export function defaultExpiry(now = Date.now()) {
  return toDatetimeLocal(Math.floor(now / 1000) + 30 * 86400);
}

// ---- editor form <-> draft ----

/** Form values for a cookie, or for a new one on `site` (host = the tab's host). */
export function formFromCookie(c, { host, site, https = true } = {}) {
  if (!c) {
    return {
      name: '', value: '', domain: host ?? site ?? '', hostOnly: true, path: '/', session: true, expires: '',
      secure: https, httpOnly: false, sameSite: 'lax', partitioned: false, topLevelSite: site ? `https://${site}` : '',
    };
  }
  return {
    name: c.name,
    value: c.value,
    domain: c.domain.replace(/^\./, ''),
    hostOnly: !!c.hostOnly,
    path: c.path,
    session: !!c.session || c.expirationDate === undefined,
    expires: c.expirationDate !== undefined ? toDatetimeLocal(c.expirationDate) : '',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: c.sameSite ?? 'unspecified',
    partitioned: !!c.partitionKey?.topLevelSite,
    topLevelSite: c.partitionKey?.topLevelSite ?? (site ? `https://${site}` : ''),
  };
}

/**
 * Draft for validateCookie / engine.save. Fields the form can't show exactly
 * (a fractional expiry, hasCrossSiteAncestor) are kept from `original` while the
 * user leaves them alone, so saving an untouched cookie writes it back byte-identically.
 */
export function draftFromForm(f, original = null) {
  const bare = String(f.domain ?? '').trim().replace(/^\./, '');
  const draft = {
    name: f.name,
    value: f.value,
    domain: f.hostOnly ? bare : `.${bare}`,
    hostOnly: !!f.hostOnly,
    path: f.path,
    secure: !!f.secure,
    httpOnly: !!f.httpOnly,
    sameSite: f.sameSite,
    session: !!f.session,
  };
  if (!f.session) {
    const keep = original && !original.session && original.expirationDate !== undefined
      && toDatetimeLocal(original.expirationDate) === f.expires;
    draft.expirationDate = keep ? original.expirationDate : fromDatetimeLocal(f.expires);
  }
  if (f.partitioned) {
    const top = String(f.topLevelSite ?? '').trim().replace(/\/+$/, '');
    const opk = original?.partitionKey;
    draft.partitionKey = opk && opk.topLevelSite === top ? { ...opk } : { topLevelSite: top };
  }
  return draft;
}

// ---- misc ----

export function storeLabel(store) {
  return store.id === '0' ? 'Default' : store.id === '1' ? 'Incognito' : `Store ${store.id}`;
}

/** cookies-<site>-<YYYYMMDD-HHmm>.<ext>, local time. */
export function exportFilename(site, ext, now = Date.now()) {
  const d = new Date(now);
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const safe = String(site || 'cookies').replace(/[^a-z0-9.-]/gi, '_');
  return `cookies-${safe}-${stamp}.${ext}`;
}
