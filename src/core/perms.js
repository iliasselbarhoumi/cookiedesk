// Optional host permissions, granted per site (spec §5.2, FINDINGS §1).
//
// A per-site grant is '*://*.<registrable domain>/*': narrower patterns hide
// non-Secure cookies (http) and parent-domain cookies (.example.com).

import { originPatternFor, patternToSite, isAllSitesPattern } from './site.js';

export const ALL_SITES = '<all_urls>';

/**
 * Must be called synchronously from a click handler: Chrome requires a user
 * gesture, and awaiting anything first can lose it.
 */
export function requestSite(site) {
  return chrome.permissions.request({ origins: [originPatternFor(site)] });
}

export function requestAllSites() {
  return chrome.permissions.request({ origins: [ALL_SITES] });
}

export async function siteAccess(site) {
  const all = await chrome.permissions.contains({ origins: [ALL_SITES] });
  if (all) return { granted: true, via: 'all' };
  const granted = await chrome.permissions.contains({ origins: [originPatternFor(site)] });
  return { granted, via: granted ? 'site' : null };
}

/** What the user has granted, for the permissions screen. */
export async function grants() {
  const { origins = [] } = await chrome.permissions.getAll();
  const allSites = origins.some(isAllSitesPattern);
  const sites = origins
    .filter((o) => !isAllSitesPattern(o))
    .map((pattern) => ({ pattern, site: patternToSite(pattern) }))
    .filter((g) => g.site)
    .sort((a, b) => a.site.localeCompare(b.site));
  return { allSites, sites, patterns: origins };
}

/** Revoke one granted pattern (or every all-sites pattern when `pattern` is ALL_SITES). */
export async function revoke(pattern) {
  const { origins = [] } = await chrome.permissions.getAll();
  const targets = pattern === ALL_SITES ? origins.filter(isAllSitesPattern) : [pattern];
  if (!targets.length) return false;
  return chrome.permissions.remove({ origins: targets });
}

export function onGrantsChanged(listener) {
  chrome.permissions.onAdded.addListener(listener);
  chrome.permissions.onRemoved.addListener(listener);
  return () => {
    chrome.permissions.onAdded.removeListener(listener);
    chrome.permissions.onRemoved.removeListener(listener);
  };
}
