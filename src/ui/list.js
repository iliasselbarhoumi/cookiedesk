// The cookie list. Rows are keyed by cookie identity and only rebuilt when what
// they show changed, so a re-list after an edit doesn't flicker (spec §9 test 6).

import { h, icon } from './dom.js';
import { cookieKey } from '../core/model.js';
import { partitionLabel, partitionPlace, isPartitioned } from '../core/partition.js';
import { t } from '../lib/i18n.js';
import { formatExpiry, formatExpiryDate, sameSiteLabel, rowSignature, truncate } from './view.js';

// The row shows one line of the value; the full 4 KB never needs to be in the DOM.
const VALUE_PREVIEW = 300;

function badge(testid, text, title, cls = '', iconName = null) {
  return h('span', { class: `badge ${cls}`, testid, title, attrs: { 'aria-label': title } }, iconName && icon(iconName, 'badge-icon'), text);
}

const SAME_SITE_HINTS = { no_restriction: 'hint_samesite_none', lax: 'hint_samesite_lax', strict: 'hint_samesite_strict' };

function iconButton(testid, iconName, label, title, onclick, cls = '') {
  return h('button', { type: 'button', class: `icon-btn ${cls}`, testid, title, attrs: { 'aria-label': label }, onclick }, iconName);
}

function buildRow(c, site, actions, protectedNow) {
  const partitioned = isPartitioned(c);
  const badges = [];
  if (protectedNow) badges.push(badge('badge-protected', null, t('badge_protected'), 'protected icon-only', 'shield'));
  if (c.httpOnly) badges.push(badge('badge-httponly', 'HttpOnly', t('hint_httponly'), 'httponly', 'eyeOff'));
  if (c.secure) badges.push(badge('badge-secure', null, t('hint_secure'), 'icon-only', 'lock'));
  const ss = sameSiteLabel(c.sameSite);
  if (ss) badges.push(badge('badge-samesite', ss, t(SAME_SITE_HINTS[c.sameSite])));
  if (partitioned) {
    const label = partitionLabel(c.partitionKey, site);
    badges.push(h('span', { class: 'badge partitioned', testid: 'badge-partitioned', title: label, attrs: { 'aria-label': label } },
      icon('split', 'badge-icon'), t('badge_partitioned'), h('span', { class: 'pk-site', text: ` · ${partitionPlace(c.partitionKey, site)}` })));
  }

  const row = h('li', {
    class: 'row', testid: 'cookie-row', tabIndex: 0,
    dataset: { name: c.name, domain: c.domain, path: c.path, partitioned: String(partitioned), protected: String(!!protectedNow) },
    attrs: { 'aria-label': `${c.name || t('empty_name')}, ${c.domain}${c.path}` },
  },
  h('div', { class: 'r1' },
    h('span', { class: `name${c.name ? '' : ' none'}`, text: c.name || t('empty_name') }),
    h('span', { class: 'badges' }, badges)),
  h('div', { class: `value${c.value ? '' : ' none'}`, text: c.value ? truncate(c.value, VALUE_PREVIEW) : t('empty_value') }),
  h('div', { class: 'r3' },
    h('span', { class: 'where' }, h('span', { class: 'domain', text: c.domain }), h('span', { class: 'path', text: c.path })),
    c.session
      ? badge('badge-session', t('session'), formatExpiryDate(c), 'quiet', 'clock')
      : h('span', { class: 'exp', title: formatExpiryDate(c) }, icon('clock', 'meta-icon'), h('span', { class: 'exp-text' }))),
  h('div', { class: 'actions' },
    iconButton('row-protect', icon('shield'), t('row_protected'), protectedNow ? t('row_unprotect_title') : t('row_protect_title'),
      (e) => { e.stopPropagation(); actions.protect(row._cookie, !protectedNow); }, protectedNow ? 'on' : ''),
    iconButton('row-copy', [icon('copy', 'icon i-copy'), icon('check', 'icon i-done')], t('copy_value'), t('copy_value_title'),
      (e) => { e.stopPropagation(); actions.copy(row._cookie, e.currentTarget); }),
    iconButton('row-delete', icon('trash'), t('btn_delete'), t('row_delete_title'),
      (e) => { e.stopPropagation(); actions.remove(row._cookie); }, 'danger')));
  row.querySelector('[data-testid=row-protect]').setAttribute('aria-pressed', String(!!protectedNow));
  row.dataset.copiedText = t('copied');
  row._cookie = c;
  row.addEventListener('click', () => actions.open(row._cookie));
  return row;
}

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A row that went away folds up instead of vanishing; it stops counting as a row at once. */
function leave(el) {
  if (calm()) { el.remove(); return; }
  el.classList.add('leaving');
  el.dataset.testid = 'cookie-row-leaving';
  el.tabIndex = -1;
  el.setAttribute('aria-hidden', 'true');
  el.style.height = `${el.offsetHeight}px`;
  void el.offsetHeight;
  el.style.height = '0px';
  setTimeout(() => el.remove(), 220);
}

/**
 * Render `cookies` into `ul`, reusing rows whose content is unchanged.
 * `actions`: { open(c), copy(c, button), remove(c), protect(c, on) }.
 * `isProtected(c)`: P1-1. `fresh`: Map of cookie key -> 'added' | 'changed' to highlight (P1-5).
 */
export function renderRows(ul, cookies, { site, now = Date.now(), actions, isProtected = () => false, fresh = new Map() }) {
  const old = new Map([...ul.children].filter((el) => !el.classList.contains('leaving')).map((el) => [el._key, el]));
  const firstPaint = old.size === 0;
  const focusedKey = document.activeElement?.closest?.('.row')?._key;
  const rows = cookies.map((c, i) => {
    const key = cookieKey(c);
    const prot = isProtected(c);
    const sig = rowSignature(c, site) + (prot ? '|protected' : '');
    let el = old.get(key);
    if (!el || el._sig !== sig) {
      el = buildRow(c, site, actions, prot);
      el._key = key;
      el._sig = sig;
      // A fresh list slides in row by row (only the first screenful is staggered).
      if (firstPaint && !calm()) {
        el.style.setProperty('--i', String(Math.min(i, 14)));
        el.classList.add('enter');
        el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
      }
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
    const exp = el.querySelector('.exp-text');
    if (exp) {
      const text = formatExpiry(c, now);
      if (exp.textContent !== text) exp.textContent = text;
    }
    return el;
  });
  const keep = new Set(rows);
  for (const el of [...ul.children]) if (!keep.has(el) && !el.classList.contains('leaving')) leave(el);
  // Put rows in order around any that are still folding away.
  let ref = ul.firstElementChild;
  for (const el of rows) {
    while (ref && ref !== el && ref.classList.contains('leaving')) ref = ref.nextElementSibling;
    if (ref === el) ref = ref.nextElementSibling;
    else ul.insertBefore(el, ref);
  }
  if (focusedKey && document.activeElement === document.body) rows.find((el) => el._key === focusedKey)?.focus();
}
