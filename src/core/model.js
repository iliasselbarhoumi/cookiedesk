// Cookie identity and round-tripping. PURE: no chrome.*, unit-tested.
//
// Chrome identifies a cookie by (store, partition, domain, path, name); a set()
// with the same five overwrites in place, anything else creates a new cookie.

export function partitionId(pk) {
  if (!pk || typeof pk !== 'object') return '';
  const site = pk.topLevelSite ?? '';
  const cross = pk.hasCrossSiteAncestor === true ? '1' : pk.hasCrossSiteAncestor === false ? '0' : '';
  return site || cross ? `${site}^${cross}` : '';
}

export function cookieKey(c) {
  return [c.storeId ?? '', partitionId(c.partitionKey), c.domain.toLowerCase(), c.path, c.name].join('|');
}

export function sameKey(a, b) {
  return cookieKey(a) === cookieKey(b);
}

function urlHost(domain) {
  const host = domain.replace(/^\./, '');
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/** A URL Chrome accepts for this cookie: scheme follows `secure`, host is the domain, path is the cookie's. */
export function cookieUrl(c) {
  const url = new URL(`${c.secure ? 'https' : 'http'}://${urlHost(c.domain)}`);
  url.pathname = c.path || '/';
  return url.href;
}

/** chrome.cookies.set() details that recreate `c` exactly (verified byte-identical, FINDINGS §3). */
export function toSetDetails(c) {
  const d = {
    url: cookieUrl(c),
    name: c.name,
    value: c.value,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: c.sameSite ?? 'unspecified',
  };
  if (c.storeId !== undefined) d.storeId = c.storeId;
  if (!c.hostOnly) d.domain = c.domain;
  if (!c.session && c.expirationDate !== undefined) d.expirationDate = c.expirationDate;
  if (partitionId(c.partitionKey)) d.partitionKey = { ...c.partitionKey };
  return d;
}

/**
 * Details that delete exactly `c` and nothing else. remove({url,name}) deletes
 * every same-name cookie sent to that URL (FINDINGS §6); an expired overwrite of
 * the exact key does not.
 */
export function toExpireDetails(c) {
  return { ...toSetDetails(c), expirationDate: 1 };
}

/** A getAll() filter that returns `c` (and maybe a few neighbours to filter out by key). */
export function toExactFilter(c) {
  const f = { name: c.name, domain: c.domain.replace(/^\./, ''), path: c.path };
  if (c.storeId !== undefined) f.storeId = c.storeId;
  if (partitionId(c.partitionKey)) f.partitionKey = { ...c.partitionKey };
  return f;
}

const FIELDS = ['name', 'value', 'domain', 'hostOnly', 'path', 'secure', 'httpOnly', 'sameSite', 'session', 'expirationDate', 'storeId'];

/** True when two cookies are identical in every stored field. */
export function sameCookie(a, b) {
  if (!a || !b) return false;
  for (const f of FIELDS) if ((a[f] ?? null) !== (b[f] ?? null)) return false;
  return partitionId(a.partitionKey) === partitionId(b.partitionKey);
}

/** Field-wise copy so snapshots never alias objects Chrome handed us. */
export function snapshot(c) {
  const s = {};
  for (const f of FIELDS) if (c[f] !== undefined) s[f] = c[f];
  if (partitionId(c.partitionKey)) s.partitionKey = { ...c.partitionKey };
  return s;
}

const bareDomain = (c) => c.domain.replace(/^\./, '').toLowerCase();

/** Stable display order: domain, name, path, unpartitioned before partitioned. */
export function sortCookies(list) {
  return [...list].sort((a, b) =>
    bareDomain(a).localeCompare(bareDomain(b))
    || a.name.localeCompare(b.name)
    || a.path.localeCompare(b.path)
    || partitionId(a.partitionKey).localeCompare(partitionId(b.partitionKey)));
}
