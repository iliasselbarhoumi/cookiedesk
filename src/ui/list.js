// The cookie list. Rows are keyed by cookie identity and only rebuilt when what
// they show changed, so a re-list after an edit doesn't flicker (spec §9 test 6).

import { h, icon } from './dom.js';
import { cookieKey } from '../core/model.js';
import { partitionLabel, isPartitioned } from '../core/partition.js';
import { formatExpiry, formatExpiryDate, sameSiteLabel, rowSignature, truncate } from './view.js';

// The row shows one line of the value; the full 4 KB never needs to be in the DOM.
const VALUE_PREVIEW = 300;
const HTTPONLY_HINT = 'HttpOnly: not visible to page JavaScript (document.cookie can\'t read it)';

function badge(testid, text, title, cls = '') {
  return h('span', { class: `badge ${cls}`, testid, text, title, attrs: { 'aria-label': title } });
}

const SAME_SITE_HINTS = {
  no_restriction: 'SameSite=None: sent on cross-site requests too',
  lax: 'SameSite=Lax: sent on top-level navigations, not on cross-site subrequests',
  strict: 'SameSite=Strict: only sent on same-site requests',
};

function buildRow(c, site, actions, protectedNow) {
  const partitioned = isPartitioned(c);
  const badges = [];
  if (protectedNow) badges.push(h('span', { class: 'badge protected', testid: 'badge-protected', title: 'Protected: bulk delete, import and set restore leave it alone (p)', attrs: { 'aria-label': 'Protected' } }, icon('shield', 'badge-icon'), 'Protected'));
  if (c.httpOnly) badges.push(h('span', { class: 'badge httponly', testid: 'badge-httponly', title: HTTPONLY_HINT, attrs: { 'aria-label': 'HttpOnly. Not visible to page JavaScript' } }, icon('lock', 'badge-icon'), 'HttpOnly'));
  if (c.secure) badges.push(badge('badge-secure', 'Secure', 'Secure: only sent over HTTPS'));
  const ss = sameSiteLabel(c.sameSite);
  if (ss) badges.push(badge('badge-samesite', `SameSite=${ss}`, SAME_SITE_HINTS[c.sameSite]));
  if (partitioned) {
    const label = partitionLabel(c.partitionKey, site);
    badges.push(h('span', { class: 'badge partitioned', testid: 'badge-partitioned', title: label, attrs: { 'aria-label': label } },
      'Partitioned', h('span', { class: 'pk-site', text: ` · ${label.replace(/^Partitioned under /, '')}` })));
  }

  const row = h('li', {
    class: 'row', testid: 'cookie-row', tabIndex: 0,
    dataset: { name: c.name, domain: c.domain, path: c.path, partitioned: String(partitioned), protected: String(!!protectedNow) },
    attrs: { 'aria-label': `${c.name || '(empty name)'}, ${c.domain}${c.path}` },
  },
  h('div', { class: 'r1' },
    h('span', { class: `name${c.name ? '' : ' none'}`, text: c.name || '(empty name)' }),
    h('span', { class: 'badges' }, badges)),
  h('div', { class: `value${c.value ? '' : ' none'}`, text: c.value ? truncate(c.value, VALUE_PREVIEW) : '(empty value)' }),
  h('div', { class: 'r3' },
    h('span', { class: 'where' }, h('span', { class: 'domain', text: c.domain }), h('span', { class: 'path', text: c.path })),
    c.session
      ? badge('badge-session', 'Session', formatExpiryDate(c), 'quiet')
      : h('span', { class: 'exp', title: formatExpiryDate(c) })),
  h('div', { class: 'actions' },
    h('button', { type: 'button', class: `icon-btn${protectedNow ? ' on' : ''}`, testid: 'row-protect', title: protectedNow ? 'Unprotect (p)' : 'Protect from bulk delete, import and set restore (p)', attrs: { 'aria-label': 'Protected', 'aria-pressed': String(!!protectedNow) }, onclick: (e) => { e.stopPropagation(); actions.protect(row._cookie, !protectedNow); } }, icon('shield')),
    h('button', { type: 'button', class: 'icon-btn', testid: 'row-copy', title: 'Copy value (c)', attrs: { 'aria-label': 'Copy value' }, onclick: (e) => { e.stopPropagation(); actions.copy(row._cookie, e.currentTarget); } }, icon('copy')),
    h('button', { type: 'button', class: 'icon-btn danger', testid: 'row-delete', title: 'Delete (Del) — undoable', attrs: { 'aria-label': 'Delete' }, onclick: (e) => { e.stopPropagation(); actions.remove(row._cookie); } }, icon('trash'))));
  row._cookie = c;
  row.addEventListener('click', () => actions.open(row._cookie));
  return row;
}

/**
 * Render `cookies` into `ul`, reusing rows whose content is unchanged.
 * `actions`: { open(c), copy(c, button), remove(c), protect(c, on) }.
 * `isProtected(c)`: P1-1. `fresh`: Map of cookie key -> 'added' | 'changed' to highlight (P1-5).
 */
export function renderRows(ul, cookies, { site, now = Date.now(), actions, isProtected = () => false, fresh = new Map() }) {
  const old = new Map([...ul.children].map((el) => [el._key, el]));
  const focusedKey = document.activeElement?.closest?.('.row')?._key;
  const rows = cookies.map((c) => {
    const key = cookieKey(c);
    const prot = isProtected(c);
    const sig = rowSignature(c, site) + (prot ? '|protected' : '');
    let el = old.get(key);
    if (!el || el._sig !== sig) {
      el = buildRow(c, site, actions, prot);
      el._key = key;
      el._sig = sig;
    }
    el._cookie = c;
    const change = fresh.get(key);
    if (change) {
      // Restart the highlight even if the row already had it.
      el.classList.remove('fresh');
      void el.offsetWidth;
      el.classList.add('fresh');
      el.dataset.change = change;
      clearTimeout(el._freshTimer);
      el._freshTimer = setTimeout(() => { el.classList.remove('fresh'); delete el.dataset.change; }, 3000);
    }
    const exp = el.querySelector('.exp');
    if (exp) {
      const text = formatExpiry(c, now);
      if (exp.textContent !== text) exp.textContent = text;
    }
    return el;
  });
  const keep = new Set(rows);
  for (const el of [...ul.children]) if (!keep.has(el)) el.remove();
  rows.forEach((el, i) => { if (ul.children[i] !== el) ul.insertBefore(el, ul.children[i] ?? null); });
  if (focusedKey && document.activeElement === document.body) rows.find((el) => el._key === focusedKey)?.focus();
}
