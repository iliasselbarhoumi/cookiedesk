// Pure site helpers: registrable domain (eTLD+1), URL classification, match patterns.
// No extension APIs and no network; the Public Suffix List is static data in psl-data.js.
import { RULES } from './psl-data.js';

let normal = null;
let wildcard = null;
let exception = null;

// Built once on first use so importing the module stays cheap.
function tables() {
  if (normal) return;
  normal = new Set();
  wildcard = new Set();
  exception = new Set();
  for (const rule of RULES.split('\n')) {
    if (rule.startsWith('!')) exception.add(rule.slice(1));
    else if (rule.startsWith('*.')) wildcard.add(rule.slice(2));
    else normal.add(rule);
  }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const isIPv4 = (h) => IPV4.test(h);
const isIPv6 = (h) => h.includes(':');
const isIp = (h) => isIPv4(h) || isIPv6(h);

// Lowercase, drop one trailing dot and any leading dots (cookie domains), and
// punycode non-ASCII hosts so they can match the ASCII rule table.
function normalizeHost(input) {
  let h = String(input ?? '').trim().toLowerCase();
  h = h.replace(/^\.+/, '');
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (/[^\x00-\x7f]/.test(h)) {
    try {
      h = new URL(`http://${h}`).hostname;
    } catch {
      // keep as-is; it will simply not match any rule
    }
  }
  return h;
}

// Number of labels in the public suffix of `labels` (standard PSL algorithm).
function suffixLength(labels) {
  tables();
  let best = 1; // implicit default rule "*"
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    const count = labels.length - i;
    // An exception rule beats every other rule; its suffix is the rule minus one label.
    if (exception.has(candidate)) return count - 1;
    if (count > best) {
      if (normal.has(candidate)) best = count;
      else if (count > 1 && wildcard.has(labels.slice(i + 1).join('.'))) best = count;
    }
  }
  return best;
}

export function registrableDomain(host) {
  const h = normalizeHost(host);
  if (!h || isIp(h) || h === 'localhost' || !h.includes('.')) return h;
  const labels = h.split('.');
  const n = suffixLength(labels);
  if (labels.length <= n) return h; // the host is itself a public suffix
  return labels.slice(-(n + 1)).join('.');
}

export function isPublicSuffix(domain) {
  const h = normalizeHost(domain);
  if (!h || isIp(h) || h === 'localhost') return false;
  const labels = h.split('.');
  return suffixLength(labels) === labels.length;
}

const BROWSER = new Set(['chrome:', 'edge:', 'about:', 'devtools:', 'view-source:', 'chrome-search:', 'chrome-untrusted:']);
const EXTENSION = new Set(['chrome-extension:', 'moz-extension:']);

export function classifyUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { kind: 'restricted', reason: 'other', scheme: '' };
  }
  const scheme = u.protocol.slice(0, -1);
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    const store = u.protocol === 'https:' && (
      u.hostname === 'chromewebstore.google.com' ||
      (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))
    );
    if (store) return { kind: 'restricted', reason: 'webstore', scheme };
    return { kind: 'web', scheme, host: u.hostname, site: registrableDomain(u.hostname) };
  }
  if (BROWSER.has(u.protocol)) return { kind: 'restricted', reason: 'browser', scheme };
  if (EXTENSION.has(u.protocol)) return { kind: 'restricted', reason: 'extension', scheme };
  if (u.protocol === 'file:') return { kind: 'restricted', reason: 'file', scheme };
  return { kind: 'restricted', reason: 'other', scheme };
}

export function originPatternFor(site) {
  const h = normalizeHost(site);
  if (isIPv6(h)) return `*://${h.startsWith('[') ? h : `[${h}]`}/*`;
  if (isIPv4(h) || h === 'localhost') return `*://${h}/*`;
  // A host that is itself a public suffix (github.io, an intranet name) gets only
  // itself: "*.github.io" would ask for every user's site under it.
  if (isPublicSuffix(h)) return `*://${h}/*`;
  // "*.example.com" also matches example.com itself, and is what exposes parent-domain cookies.
  return `*://*.${h}/*`;
}

const PATTERN = /^(\*|https?):\/\/([^/]*)(\/.*)?$/i;

export function isAllSitesPattern(pattern) {
  if (pattern === '<all_urls>') return true;
  const m = PATTERN.exec(String(pattern ?? '').trim());
  return !!m && m[2] === '*';
}

export function patternToSite(pattern) {
  const p = String(pattern ?? '').trim();
  if (p === '<all_urls>') return null;
  const m = PATTERN.exec(p);
  if (!m || !m[2] || m[2] === '*') return null;
  const host = m[2].toLowerCase().replace(/^\*\./, '');
  return host || null;
}

const stripBrackets = (h) => (h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h);

export function domainMatchesSite(cookieDomain, site) {
  const d = stripBrackets(normalizeHost(cookieDomain));
  const s = stripBrackets(normalizeHost(site));
  if (!d || !s) return false;
  return d === s || d.endsWith(`.${s}`);
}
