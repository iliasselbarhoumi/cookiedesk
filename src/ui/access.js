// Access & settings: what CookieDesk may read, one click to revoke, and the
// toolbar-button choice (P-5: never force the side panel).

import { h, icon } from './dom.js';
import * as perms from '../core/perms.js';
import { showToast } from './dialogs.js';

const SURFACE_KEY = 'surface'; // read by sw.js
const SOURCE_URL = 'https://github.com/iliasselbarhoumi/cookiedesk'; // a link only, nothing is fetched

function quote(text) {
  return h('p', { class: 'prompt-quote' }, h('span', { class: 'hint', text: 'Chrome will ask: ' }), h('q', { text }));
}

/** Returns { el, refresh }. `close()` goes back to the main view. */
export function createAccessView({ close }) {
  const body = h('div', { class: 'access-body' });
  const el = h('section', { class: 'access', testid: 'access-view', attrs: { 'aria-label': 'Access and settings' } },
    h('div', { class: 'editor-head' },
      h('button', { type: 'button', class: 'icon-btn', testid: 'access-close', title: 'Back (Esc)', attrs: { 'aria-label': 'Back' }, onclick: () => close() }, icon('back')),
      h('h2', { text: 'Access & settings' })),
    body);

  async function failSoft(fn) {
    try { await fn(); } catch (e) { showToast(e?.message || String(e), { error: true }); }
    refresh();
  }

  async function refresh() {
    const [g, stored] = await Promise.all([perms.grants(), chrome.storage.local.get(SURFACE_KEY)]);
    const surface = stored[SURFACE_KEY] === 'sidepanel' ? 'sidepanel' : 'popup';

    const allSites = g.allSites
      ? h('div', { class: 'card on' },
        h('h3', { text: 'All sites: on' }),
        h('p', { text: 'CookieDesk can read and change cookies on every site, including cookies set by sites embedded in a page.' }),
        h('button', { type: 'button', class: 'btn', testid: 'revoke-all', text: 'Turn off all-sites access', onclick: () => failSoft(() => perms.revoke(perms.ALL_SITES)) }))
      : h('div', { class: 'card' },
        h('h3', { text: 'All sites' }),
        h('p', { text: 'Optional. You won\'t be asked again for each site, and cookies from other sites embedded in a page (ads, widgets, sign-in frames) become visible everywhere.' }),
        // requestAllSites must be the first call in the handler: the prompt needs the click's user gesture.
        h('button', { type: 'button', class: 'btn', testid: 'grant-all', text: 'Allow on all sites', onclick: () => failSoft(() => perms.requestAllSites()) }),
        quote('Read and change all your data on all websites'));

    const rows = g.sites.map(({ pattern, site }) => h('li', { class: 'grant-row', testid: 'grant-row', dataset: { site } },
      h('span', { class: 'mono grant-site', text: site }),
      h('button', { type: 'button', class: 'btn small', testid: 'revoke', text: 'Remove', attrs: { 'aria-label': `Remove access to ${site}` }, onclick: () => failSoft(() => perms.revoke(pattern)) })));

    const surfaceSel = h('select', { testid: 'setting-surface', id: 'setting-surface' },
      h('option', { value: 'popup', text: 'Popup' }), h('option', { value: 'sidepanel', text: 'Side panel' }));
    surfaceSel.value = surface;
    surfaceSel.addEventListener('change', () => chrome.storage.local.set({ [SURFACE_KEY]: surfaceSel.value }));

    body.replaceChildren(...[
      h('p', { class: 'lead', text: 'CookieDesk sees a site\'s cookies only after you allow that site. Allowing a site lets CookieDesk read and change its cookies (on the site and its subdomains) and nothing else: no page content, no history.' }),
      allSites,
      h('h3', { class: 'section-title', text: 'Sites you\'ve allowed' }),
      g.allSites && rows.length ? h('p', { class: 'hint', text: 'All-sites access is on, so these entries don\'t matter while it stays on.' }) : null,
      rows.length ? h('ul', { class: 'grants' }, rows) : h('p', { class: 'hint', text: 'None yet.' }),
      h('h3', { class: 'section-title', text: 'Settings' }),
      h('div', { class: 'setting' }, h('label', { htmlFor: 'setting-surface', text: 'Toolbar button opens' }), surfaceSel),
      h('p', { class: 'privacy' },
        'CookieDesk makes no network requests and never writes cookie values to disk. Undo copies are kept in memory only: undo works for 10 minutes, and the copies are deleted when Chrome closes, when the incognito session they belong to ends, or after those 10 minutes once CookieDesk next runs. ',
        h('a', { href: SOURCE_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Source code' })),
    ].filter(Boolean));
  }

  return { el, refresh };
}
