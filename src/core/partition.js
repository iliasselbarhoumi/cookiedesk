// Partitioned cookies (CHIPS) and feature detection. PURE: no chrome.*, unit-tested.
// Kept isolated so a change in Chrome's partitioning model is a local edit (spec §10).

import { registrableDomain } from './site.js';

export const MIN_PARTITION_KEY = 119;
export const MIN_CROSS_SITE_ANCESTOR = 130;
export const MIN_GET_PARTITION_KEY = 132;

export function chromeMajorFromUA(userAgent) {
  // No \b: headless Chrome reports 'HeadlessChrome/119.0…'.
  const m = /Chrome\/(\d+)\./.exec(userAgent ?? '');
  return m ? Number(m[1]) : null;
}

/** What this browser can do, estimated from its version (cookies.js confirms by probing). An unknown version is treated as current. */
export function features({ chromeMajor, hasGetPartitionKey }) {
  const v = chromeMajor ?? Infinity;
  return {
    partitionKey: v >= MIN_PARTITION_KEY,
    hasCrossSiteAncestor: v >= MIN_CROSS_SITE_ANCESTOR,
    getPartitionKey: !!hasGetPartitionKey && v >= MIN_GET_PARTITION_KEY,
  };
}

export function isPartitioned(c) {
  return !!(c.partitionKey && (c.partitionKey.topLevelSite || c.partitionKey.hasCrossSiteAncestor !== undefined));
}

function hostOf(topLevelSite) {
  try { return new URL(topLevelSite).hostname.toLowerCase(); } catch { return null; }
}

/**
 * Chrome keys partitions by schemeful site: 'https://www.A.test:8443/x' is
 * stored as 'https://a.test'. Matching that form keeps our identity of a
 * cookie equal to Chrome's. Unparsable input is returned unchanged.
 */
export function canonicalTopLevelSite(topLevelSite) {
  try {
    const url = new URL(topLevelSite);
    return `${url.protocol}//${registrableDomain(url.hostname)}`;
  } catch {
    return topLevelSite;
  }
}

/** Same-site in the sense Chrome checks for hasCrossSiteAncestor (FINDINGS §2). */
export function isSameSite(cookieDomain, topLevelSite) {
  const top = hostOf(topLevelSite);
  if (!top) return false;
  return registrableDomain(cookieDomain.replace(/^\./, '')) === registrableDomain(top);
}

/**
 * The key a draft will actually get. Chrome fills hasCrossSiteAncestor in when
 * omitted (false same-site, true cross-site); filling it in ourselves keeps our
 * identity of the cookie equal to Chrome's. Below Chrome 130 the field is dropped.
 */
export function normalizePartitionKey(pk, cookieDomain, feats) {
  if (!pk || !pk.topLevelSite) return undefined;
  const topLevelSite = canonicalTopLevelSite(pk.topLevelSite);
  if (!feats?.hasCrossSiteAncestor) return { topLevelSite };
  const cross = typeof pk.hasCrossSiteAncestor === 'boolean' ? pk.hasCrossSiteAncestor : !isSameSite(cookieDomain, topLevelSite);
  return { topLevelSite, hasCrossSiteAncestor: cross };
}

export function partitionLabel(pk, site) {
  if (!pk?.topLevelSite) return '';
  const top = hostOf(pk.topLevelSite) ?? pk.topLevelSite;
  const where = site && top === site ? 'this site' : top;
  const ctx = pk.hasCrossSiteAncestor === true ? ', cross-site context' : '';
  return `Partitioned under ${where}${ctx}`;
}

/**
 * getAll() filters that together list a site: every cookie whose domain is the
 * site or a subdomain (unpartitioned and in any partition), plus cookies other
 * sites set while embedded under this one. Results need de-duplication by key.
 */
export function siteQueries(site, feats, storeId) {
  const base = storeId !== undefined ? { storeId } : {};
  if (!feats.partitionKey) return [{ ...base, domain: site }];
  return [
    { ...base, domain: site, partitionKey: {} },
    { ...base, partitionKey: { topLevelSite: `https://${site}` } },
    { ...base, partitionKey: { topLevelSite: `http://${site}` } },
  ];
}
