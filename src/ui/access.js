// Access & settings: what CookieDesk may read, one click to revoke, and the
// toolbar-button choice (P-5: never force the side panel).

import { h, icon } from './dom.js';
import * as perms from '../core/perms.js';
import { showToast } from './dialogs.js';
import { openKofi, getSupport } from './support.js';
import { openReviews, storePage } from './rating.js';
import { t } from '../lib/i18n.js';

const SURFACE_KEY = 'surface'; // read by sw.js
const SOURCE_URL = 'https://github.com/iliasselbarhoumi/cookiedesk'; // links only, nothing is fetched
const ISSUES_URL = `${SOURCE_URL}/issues`;

function quote(text) {
  return h('p', { class: 'prompt-quote' }, h('span', { class: 'hint', text: `${t('chrome_will_ask')} ` }), h('q', { text }));
}

/** Returns { el, refresh }. `close()` goes back to the main view. */
export function createAccessView({ close }) {
  const body = h('div', { class: 'access-body' });
  const el = h('section', { class: 'access', testid: 'access-view', attrs: { 'aria-label': t('access_aria') } },
    h('div', { class: 'editor-head' },
      h('button', { type: 'button', class: 'icon-btn', testid: 'access-close', title: t('back_esc'), attrs: { 'aria-label': t('back') }, onclick: () => close() }, icon('back')),
      h('h2', { text: t('menu_access') })),
    body);

  async function failSoft(fn) {
    try { await fn(); } catch (e) { showToast(e?.message || String(e), { error: true }); }
    refresh();
  }

  async function refresh() {
    const [g, stored] = await Promise.all([perms.grants(), chrome.storage.local.get(SURFACE_KEY)]);
    const surface = stored[SURFACE_KEY] === 'sidepanel' ? 'sidepanel' : 'popup';

    const supporter = (await getSupport().catch(() => ({}))).supporter;

    const allSites = g.allSites
      ? h('div', { class: 'card on' },
        h('div', { class: 'card-head' }, h('span', { class: 'card-glyph' }, icon('globe')), h('h3', { text: t('all_sites_on') })),
        h('p', { text: t('all_sites_on_text') }),
        h('button', { type: 'button', class: 'btn small', testid: 'revoke-all', onclick: () => failSoft(() => perms.revoke(perms.ALL_SITES)) }, icon('x'), t('turn_off')))
      : h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('span', { class: 'card-glyph' }, icon('globe')), h('h3', { text: t('all_sites') })),
        h('p', { text: t('all_sites_text') }),
        // requestAllSites must be the first call in the handler: the prompt needs the click's user gesture.
        h('button', { type: 'button', class: 'btn small', testid: 'grant-all', onclick: () => failSoft(() => perms.requestAllSites()) }, icon('key'), t('allow_all_sites')),
        quote(t('prompt_all')));

    const rows = g.sites.map(({ pattern, site }) => h('li', { class: 'grant-row', testid: 'grant-row', dataset: { site } },
      h('span', { class: 'site-avatar', attrs: { 'aria-hidden': 'true' }, text: site.charAt(0).toUpperCase() }),
      h('span', { class: 'mono grant-site', text: site }),
      h('button', { type: 'button', class: 'icon-btn danger', testid: 'revoke', title: t('remove_access', site), attrs: { 'aria-label': t('remove_access', site) }, onclick: () => failSoft(() => perms.revoke(pattern)) }, icon('x'))));

    const surfaceBtn = (value, glyph, label) => h('button', {
      type: 'button', class: 'seg-btn', dataset: { value }, attrs: { 'aria-pressed': String(surface === value) },
      onclick: (e) => {
        for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        chrome.storage.local.set({ [SURFACE_KEY]: value });
      },
    }, icon(glyph), label);
    const page = storePage();

    body.replaceChildren(...[
      h('p', { class: 'lead' }, icon('shield', 'icon lead-icon'), h('span', { text: t('access_lead') })),
      allSites,
      h('h3', { class: 'section-title', text: rows.length ? t('allowed_sites_count', rows.length) : t('allowed_sites') }),
      g.allSites && rows.length ? h('p', { class: 'hint', text: t('all_sites_overrides') }) : null,
      rows.length ? h('ul', { class: 'grants' }, rows) : h('p', { class: 'hint empty-inline', text: t('none_yet') }),
      h('h3', { class: 'section-title', text: t('toolbar_opens') }),
      h('div', { class: 'seg', testid: 'setting-surface', attrs: { role: 'group', 'aria-label': t('toolbar_opens') } },
        surfaceBtn('popup', 'popup', t('surface_popup')), surfaceBtn('sidepanel', 'panel', t('surface_sidepanel'))),
      h('h3', { class: 'section-title', text: t('support_feedback') }),
      h('div', { class: 'thanks' },
        h('button', { type: 'button', class: 'thanks-btn kofi', testid: 'access-kofi', onclick: () => openKofi().catch(() => {}) },
          icon(supporter ? 'heart' : 'coffee'), h('span', { text: supporter ? t('thanks_supporting') : t('buy_coffee') })),
        page && h('button', { type: 'button', class: 'thanks-btn', testid: 'access-rate', onclick: () => openReviews().catch(() => {}) }, icon('star'), h('span', { text: t('menu_rate') })),
        h('a', { class: 'thanks-btn', href: ISSUES_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('alert'), h('span', { text: t('report_problem') })),
        h('a', { class: 'thanks-btn', href: SOURCE_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('code'), h('span', { text: t('source_code') }))),
      h('p', { class: 'privacy' },
        icon('lock', 'icon privacy-icon'),
        h('span', { text: t('privacy_line') })),
    ].filter(Boolean));
  }

  return { el, refresh };
}
