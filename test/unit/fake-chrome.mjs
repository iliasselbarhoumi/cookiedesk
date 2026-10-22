// In-memory chrome.cookies / chrome.storage.session that reproduce the Chrome 150
// behaviour measured in phase0 (FINDINGS §2, §3 and the remove() probe):
// - identity = store|partition|domain|path|name; set() on the same key overwrites
//   and fires overwrite+explicit; a past expiry deletes (expired_overwrite)
// - remove({url,name}) deletes EVERY same-name cookie sent to that URL
// - getAll partitionKey: omitted = unpartitioned, {} = all, {topLevelSite[,hasCrossSiteAncestor]} = that partition
// - set() returns whatever get(url,name) finds (not necessarily the cookie written)
// Failure injection: store.failNext(pred) makes the next matching set() throw.

import { cookieKey, partitionId } from '../../src/core/model.js';
import { canonicalTopLevelSite } from '../../src/core/partition.js';

const bare = (d) => d.replace(/^\./, '').toLowerCase();

function domainMatch(cookie, host) {
  const d = bare(cookie.domain);
  return cookie.hostOnly ? d === host : host === d || host.endsWith(`.${d}`);
}

function pathMatch(cookiePath, urlPath) {
  return urlPath === cookiePath || (urlPath.startsWith(cookiePath) && (cookiePath.endsWith('/') || urlPath[cookiePath.length] === '/'));
}

function pkMatches(filterPk, c) {
  if (filterPk === undefined) return !c.partitionKey;
  if (!filterPk.topLevelSite && filterPk.hasCrossSiteAncestor === undefined) return true;
  if (!c.partitionKey) return false;
  if (filterPk.topLevelSite && filterPk.topLevelSite !== c.partitionKey.topLevelSite) return false;
  if (filterPk.hasCrossSiteAncestor !== undefined && filterPk.hasCrossSiteAncestor !== c.partitionKey.hasCrossSiteAncestor) return false;
  return true;
}

export function createFakeChrome({ now = () => Date.now() } = {}) {
  const jar = new Map();
  const listeners = new Set();
  const failures = [];
  const calls = { set: 0, remove: 0, getAll: 0 };
  let session = {};
  const emit = (removed, cause, cookie) => { for (const l of listeners) l({ removed, cause, cookie: { ...cookie } }); };

  function fromDetails(d) {
    const url = new URL(d.url);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const hostOnly = d.domain === undefined;
    const c = {
      name: d.name ?? '',
      value: d.value ?? '',
      domain: hostOnly ? host : `.${bare(d.domain)}`,
      hostOnly,
      path: d.path ?? '/',
      secure: !!d.secure,
      httpOnly: !!d.httpOnly,
      sameSite: d.sameSite ?? 'unspecified',
      session: d.expirationDate === undefined,
      storeId: d.storeId ?? '0',
    };
    if (!c.session) c.expirationDate = d.expirationDate;
    if (d.partitionKey?.topLevelSite) {
      const top = new URL(d.partitionKey.topLevelSite).hostname;
      const same = bare(c.domain) === top || bare(c.domain).endsWith(`.${top}`);
      const cross = d.partitionKey.hasCrossSiteAncestor ?? !same;
      if (!same && cross === false) throw new Error('partitionKey has a first party value for hasCrossSiteAncestor when the url and the topLevelSite are not first party.');
      c.partitionKey = { hasCrossSiteAncestor: cross, topLevelSite: canonicalTopLevelSite(d.partitionKey.topLevelSite) };
    }
    return { c, url };
  }

  function rejects(c, url) {
    if (c.sameSite === 'no_restriction' && !c.secure) return true;
    if (c.partitionKey && !c.secure) return true;
    if (c.secure && url.protocol !== 'https:') return true;
    if (/^__secure-/i.test(c.name) && !c.secure) return true;
    if (/^__host-/i.test(c.name) && (!c.secure || !c.hostOnly || c.path !== '/')) return true;
    if (new TextEncoder().encode(c.name + c.value).length > 4096) return true;
    if (!c.secure) {
      for (const x of jar.values()) {
        if (x.secure && x.name === c.name && x.storeId === c.storeId && (domainMatch(x, bare(c.domain)) || domainMatch(c, bare(x.domain)))) return true;
      }
    }
    return false;
  }

  function matchesUrl(c, url) {
    return domainMatch(c, url.hostname.replace(/^\[|\]$/g, '')) && pathMatch(c.path, url.pathname) && (!c.secure || url.protocol === 'https:');
  }

  const cookies = {
    async getAll(filter = {}) {
      calls.getAll++;
      const url = filter.url ? new URL(filter.url) : null;
      return [...jar.values()]
        .filter((c) => (filter.storeId ?? '0') === c.storeId)
        .filter((c) => filter.name === undefined || c.name === filter.name)
        .filter((c) => filter.path === undefined || c.path === filter.path)
        .filter((c) => filter.domain === undefined || bare(c.domain) === bare(filter.domain) || bare(c.domain).endsWith(`.${bare(filter.domain)}`))
        .filter((c) => !url || matchesUrl(c, url))
        .filter((c) => pkMatches(filter.partitionKey, c))
        .sort((a, b) => b.path.length - a.path.length)
        .map((c) => structuredClone(c));
    },
    async get({ url, name, storeId, partitionKey }) {
      return (await cookies.getAll({ url, name, storeId, partitionKey }))[0] ?? null;
    },
    async set(details) {
      calls.set++;
      const i = failures.findIndex((f) => f(details));
      if (i !== -1) { failures.splice(i, 1); throw new Error(`Failed to parse or set cookie named "${details.name}".`); }
      const { c, url } = fromDetails(details);
      if (rejects(c, url)) throw new Error(`Failed to parse or set cookie named "${c.name}".`);
      const key = cookieKey(c);
      const old = jar.get(key);
      const expired = !c.session && c.expirationDate * 1000 <= now();
      if (old) { jar.delete(key); emit(true, expired ? 'expired_overwrite' : 'overwrite', old); }
      if (expired) return cookies.get({ url: details.url, name: c.name, storeId: c.storeId });
      jar.set(key, c);
      emit(false, 'explicit', c);
      return cookies.get({ url: details.url, name: c.name, storeId: c.storeId, partitionKey: details.partitionKey });
    },
    async remove({ url, name, storeId = '0', partitionKey }) {
      calls.remove++;
      const u = new URL(url);
      for (const [key, c] of jar) {
        if (c.name === name && c.storeId === storeId && matchesUrl(c, u) && partitionId(c.partitionKey) === partitionId(partitionKey && { hasCrossSiteAncestor: c.partitionKey?.hasCrossSiteAncestor, ...partitionKey })) {
          jar.delete(key);
          emit(true, 'explicit', c);
        }
      }
      return { url, name, storeId };
    },
    async getAllCookieStores() { return [{ id: '0', tabIds: [] }]; },
    onChanged: {
      addListener: (l) => listeners.add(l),
      removeListener: (l) => listeners.delete(l),
    },
  };

  const storage = {
    async get(key) {
      if (key === null) return structuredClone(session);
      return key in session ? { [key]: structuredClone(session[key]) } : {};
    },
    async set(obj) { session = { ...session, ...structuredClone(obj) }; },
    async remove(keys) { for (const k of [].concat(keys)) delete session[k]; },
  };

  return {
    cookies,
    storage,
    calls,
    jar,
    failNext(pred) { failures.push(pred); },
    seed(details) { const { c } = fromDetails(details); jar.set(cookieKey(c), c); return structuredClone(c); },
    all() { return [...jar.values()].map((c) => structuredClone(c)); },
  };
}
