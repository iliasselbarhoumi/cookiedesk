// Which tab are we looking at, what site is it, and may we read its cookies?
// Every answer maps to an explicit view state — never a bare empty list (P0-7).

import { classifyUrl } from '../core/site.js';
import { siteAccess } from '../core/perms.js';
import { t } from '../lib/i18n.js';

/**
 * PURE. The state to show for a tab URL and the access we hold.
 *   unknown    — URL hidden: side panel on a site we can't see yet (no activeTab, no grant)
 *   restricted — chrome://, the Web Store, extension pages, file:, data: …
 *   no-access  — a web site we have no grant for
 *   ready      — a web site we can read
 */
export function tabState(url, access) {
  if (!url) return { kind: 'unknown' };
  const c = classifyUrl(url);
  if (c.kind === 'restricted') return { kind: 'restricted', reason: c.reason, scheme: c.scheme };
  if (!access?.granted) return { kind: 'no-access', site: c.site, host: c.host };
  return { kind: 'ready', site: c.site, host: c.host, via: access.via };
}

/** PURE. Plain-words explanation for a restricted page. */
export function restrictedMessage(reason) {
  switch (reason) {
    case 'browser': return t('restricted_browser');
    case 'webstore': return t('restricted_webstore');
    case 'extension': return t('restricted_extension');
    case 'file': return t('restricted_file');
    default: return t('restricted_other');
  }
}

/** The tab to show: `?tab=<id>` if given (the side panel follows a tab; tests target one), else the active tab. */
export async function currentTab() {
  const param = new URLSearchParams(location.search).get('tab');
  if (param) {
    try { return await chrome.tabs.get(Number(param)); } catch { /* closed: fall back */ }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/** The cookie store holding this tab (incognito tabs use a separate store). */
export async function storeFor(tab, stores) {
  const match = stores.find((s) => s.tabIds.includes(tab?.id));
  return (match ?? stores[0] ?? { id: '0' }).id;
}

/** Resolve everything the UI needs about the current tab. */
export async function resolveContext() {
  const tab = await currentTab();
  const url = tab?.url || tab?.pendingUrl || '';
  const c = url ? classifyUrl(url) : null;
  const access = c?.kind === 'web' ? await siteAccess(c.site) : null;
  const stores = await chrome.cookies.getAllCookieStores();
  return { tab, url, state: tabState(url, access), stores, storeId: await storeFor(tab, stores) };
}
